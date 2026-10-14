// Content-script DOM action executors — the ONLY code that mutates LinkedIn.
// Thin edge over FeedReader (locate) + validated techniques (see
// docs/linkedin-dom-anchors.md). Real like-toggle / comment-submit acceptance is
// confirmed in field tests; the locate + skip-if-liked logic is unit-tested.

import { FeedReader } from '@lib/feed/FeedReader';
import type { HumanDelay } from '@lib/engagement/HumanDelay';
import {
  findCommentControl,
  findCommentSubmit,
  findReactionControl,
  reactionState,
} from '@lib/linkedin/domContract';
import { isExactLabel } from '@lib/linkedin/localeLexicon';

const EDITOR = '[data-testid="ui-core-tiptap-text-editor-wrapper"] [contenteditable="true"]';

// ── Post composer (share box). Lives in a SHADOW DOM; editor is Quill, which
// commits its model ASYNCHRONOUSLY. See docs/linkedin-dom-anchors.md "Post composer". ──
const POST_TRIGGER = '[aria-label="Start a post"]';
const SHADOW_HOST = '#interop-outlet';
const QL_EDITOR = '[data-test-ql-editor-contenteditable="true"]';
const POST_SUBMIT = 'button.share-actions__primary-action';
const DISMISS = 'button[aria-label="Dismiss"]';

export type ActionResult =
  { ok: true; already?: boolean } | { ok: false; reason: string; uncertain?: true };
export type ShouldAbort = () => boolean;
export type CommitEffect = () => Promise<boolean>;

const reader = new FeedReader();

/**
 * The comment editor SCOPED to the post matching `urn`. The editor renders INSIDE the post's
 * (visible/expanded) [componentkey] node — verified live 2026-06-29 — so we re-find the post
 * and query within it. A global `document.querySelector(EDITOR)` returns the FIRST open editor
 * on the page, so once one post's composer was open every later comment piled onto it (the
 * "all 5 comments under one post" bug). Re-finds the post each call → robust to re-render.
 */
export function findPostEditor(root: ParentNode, urn: string): HTMLElement | null {
  return reader.findByUrn(root, urn)?.querySelector<HTMLElement>(EDITOR) ?? null;
}

/** Like a post by urn. No-op (success) if already liked — like dedup. */
export function executeLike(root: ParentNode, urn: string): ActionResult {
  const post = reader.findByUrn(root, urn);
  if (!post) return { ok: false, reason: 'post_not_found' };
  const button = findReactionControl(post);
  if (!button) return { ok: false, reason: 'like_button_not_found' };
  const state = reactionState(button);
  if (state === 'reacted') return { ok: true, already: true };
  if (state === 'unknown') return { ok: false, reason: 'like_state_unknown' };
  button.click();
  return { ok: true };
}

/** Persist ownership immediately before the reaction click, then confirm the DOM transition. */
export async function executeLikeEffect(
  root: ParentNode,
  urn: string,
  commit: CommitEffect,
  _shouldAbort: ShouldAbort = () => false,
): Promise<ActionResult> {
  const post = reader.findByUrn(root, urn);
  if (!post) return { ok: false, reason: 'post_not_found' };
  const button = findReactionControl(post);
  if (!button) return { ok: false, reason: 'like_button_not_found' };
  const state = reactionState(button);
  if (state === 'reacted') return { ok: true, already: true };
  if (state === 'unknown') return { ok: false, reason: 'like_state_unknown' };
  if (!(await commit())) return { ok: false, reason: 'commit_rejected' };
  button.click();
  const confirmed = await waitForCond(() => {
    const currentPost = reader.findByUrn(root, urn);
    const current = currentPost ? findReactionControl(currentPost) : null;
    return current !== null && reactionState(current) === 'reacted';
  }, 4000);
  return confirmed
    ? { ok: true }
    : { ok: false, reason: 'like_confirmation_timeout', uncertain: true };
}

/**
 * Comment on a post: open the editor, type the text char-by-char (ProseMirror
 * accepts execCommand insertText — validated live), then submit. Human-paced via
 * the injected HumanDelay. Edge — exercised in field tests, not jsdom.
 */
export async function executeComment(
  root: ParentNode,
  urn: string,
  text: string,
  delay: HumanDelay,
  shouldAbort: ShouldAbort,
  commit?: CommitEffect,
): Promise<ActionResult> {
  if (shouldAbort()) return cancelledResult();
  const post = reader.findByUrn(root, urn);
  if (!post) return { ok: false, reason: 'post_not_found' };
  const open = findCommentControl(post);
  if (!open) return { ok: false, reason: 'comment_button_not_found' };
  open.click();

  // Scope the editor to THIS post (re-found each poll) — never a global query, which would
  // grab the first open composer on the page and pile every comment onto one post.
  const editor = await waitForValue<HTMLElement>(() => findPostEditor(root, urn), 5000);
  if (shouldAbort()) {
    cancelCommentEditor(editor, open);
    return cancelledResult();
  }
  if (!editor) return { ok: false, reason: 'editor_not_found' };
  editor.focus();
  placeCaretAtEnd(editor);

  // Paste the whole comment at once (same fix as the post composer): faster + no newline bug.
  // LinkedIn's editor commits text only when it arrives through execCommand.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  document.execCommand('insertText', false, text);
  await sleep(delay.nextMs(300, 900));
  if (shouldAbort()) {
    cancelCommentEditor(editor, open);
    return cancelledResult();
  }

  // ProseMirror commits the pasted text into its model ASYNCHRONOUSLY (MutationObserver), so
  // the Comment button stays disabled for a few ticks. Poll findSubmit (re-query each poll —
  // artdeco may REPLACE the button node on the disabled→enabled re-render, so a captured
  // reference would read stale `disabled=true` forever) until it enables, like executeComposerPost.
  // Scope from the editor: the submit lives in the editor's comment-box block, NOT in the post node.
  const submit = await waitForValue(() => findSubmit(editor), 4000);
  if (shouldAbort()) {
    cancelCommentEditor(editor, open);
    return cancelledResult();
  }
  if (!submit) return { ok: false, reason: 'submit_not_found' };
  if (commit && !(await commit())) {
    cancelCommentEditor(editor, open);
    return { ok: false, reason: 'commit_rejected' };
  }
  submit.click();
  if (!commit) return { ok: true };
  const confirmed = await waitForCond(
    () => !editor.isConnected || findPostEditor(root, urn) === null,
    12000,
  );
  return confirmed
    ? { ok: true }
    : { ok: false, reason: 'comment_confirmation_timeout', uncertain: true };
}

/** Clear this post's draft and toggle only its own comment editor closed. */
function cancelCommentEditor(editor: HTMLElement | null, opener: HTMLElement): void {
  if (editor) {
    editor.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    editor.ownerDocument.execCommand('selectAll', false);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    editor.ownerDocument.execCommand('delete', false);
    editor.replaceChildren();
    editor.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
    );
  }
  opener.click();
}

/**
 * Find the comment submit button, scoped from the open tiptap editor.
 *
 * LinkedIn renders the submit OUTSIDE the [componentkey] post node, in the comment-box
 * block that also holds the editor — so a `post.querySelector` never sees it (the comment
 * "was typed but never sent" bug). The submit has NO aria-label, only `textContent`
 * "Comment"; the OPENER is `button[aria-label="Comment"]` whose textContent is the comment
 * COUNT. We walk up from the editor to the block, match by textContent, and prefer the
 * button WITHOUT aria-label — otherwise we'd grab the opener and re-toggle the editor
 * instead of posting. Filters `disabled` (ProseMirror commits the pasted text async).
 */
export function findSubmit(editor: Element): HTMLElement | null {
  return findCommentSubmit(editor);
}

export interface ComposerHandle {
  editor: HTMLElement;
  post: HTMLButtonElement;
  shadow: ShadowRoot;
}

/**
 * Locate the composer editor + Post button STRICTLY inside #interop-outlet's open
 * shadow root. A plain document query would grab the decoy `.ql-editor` in the hidden
 * `/preload` iframe — so we never query globally. Returns null if the modal isn't open.
 */
export function findComposer(root: ParentNode): ComposerHandle | null {
  const host = root.querySelector<HTMLElement>(SHADOW_HOST);
  const shadow = host?.shadowRoot ?? null;
  if (!shadow) return null;
  const editor = shadow.querySelector<HTMLElement>(QL_EDITOR);
  const post = shadow.querySelector<HTMLButtonElement>(POST_SUBMIT);
  if (!editor || !post) return null;
  return { editor, post, shadow };
}

/**
 * Publish a post: open the composer, type the text char-by-char (Quill accepts
 * execCommand insertText, but commits its model ASYNCHRONOUSLY — so we POLL the Post
 * button until it enables before clicking), submit, confirm the modal closed. On any
 * failure → Dismiss → Discard (never leave a half-draft). Edge — the typing path is
 * exercised live, not in jsdom.
 */
export async function executeComposerPost(
  root: Document,
  text: string,
  delay: HumanDelay,
  shouldAbort: ShouldAbort,
  commit?: CommitEffect,
): Promise<ActionResult> {
  if (shouldAbort()) return cancelledResult();
  if (!text.trim()) return { ok: false, reason: 'empty_text' };
  const trigger = root.querySelector<HTMLElement>(POST_TRIGGER);
  if (!trigger) return { ok: false, reason: 'composer_trigger_not_found' };
  trigger.click();

  const handle = await waitForValue(() => findComposer(root), 6000);
  if (shouldAbort()) {
    if (handle) await dismissComposer(handle.shadow);
    return cancelledResult();
  }
  if (!handle) return { ok: false, reason: 'composer_not_found' };
  const { editor, shadow } = handle;

  editor.focus();
  placeCaretAtEnd(editor, shadow);
  // Paste the whole text at once (like pasting from a draft), NOT char-by-char. Faster, and
  // avoids the newline bug where per-char insertText pushed a new paragraph ABOVE the old one.
  // Quill/ProseMirror accept execCommand('insertText') with multi-line text in one shot.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  root.execCommand('insertText', false, text);
  await sleep(delay.nextMs(300, 900)); // brief human pause before the Post button enables
  if (shouldAbort()) {
    await dismissComposer(shadow);
    return cancelledResult();
  }

  // Quill registers via MutationObserver → the Post button enables on a later tick.
  // Re-query the button each poll/click via findComposer: artdeco/Ember may REPLACE
  // the button node on the disabled→enabled re-render, so a captured reference would
  // read a stale `disabled=true` forever (a false post_button_disabled failure).
  const ready = await waitForCond(() => findComposer(root)?.post.disabled === false, 4000);
  if (shouldAbort()) {
    await dismissComposer(shadow);
    return cancelledResult();
  }
  if (!ready) {
    await dismissComposer(shadow);
    return { ok: false, reason: 'post_button_disabled' };
  }
  if (commit && !(await commit())) {
    await dismissComposer(shadow);
    return { ok: false, reason: 'commit_rejected' };
  }
  findComposer(root)?.post.click();

  // Generous close-detection: a slow network can delay the modal teardown; too short a
  // window yields a false-negative (post landed, we report failure → draft kept → re-post).
  const closed = await waitForCond(() => findComposer(root) === null, 12000);
  if (!closed) {
    if (!commit) await dismissComposer(shadow);
    return commit
      ? { ok: false, reason: 'modal_did_not_close', uncertain: true }
      : { ok: false, reason: 'modal_did_not_close' };
  }
  return { ok: true };
}

/** Abandon the composer cleanly: Dismiss → confirm Discard (NOT "Save as draft"). */
async function dismissComposer(shadow: ShadowRoot): Promise<void> {
  shadow.querySelector<HTMLElement>(DISMISS)?.click();
  const discard = await waitForValue(
    () =>
      [...shadow.querySelectorAll<HTMLElement>('button')].find(
        (b) => (b.textContent ?? '').trim().toLowerCase() === 'discard',
      ) ?? null,
    2000,
  );
  discard?.click();
}

/** Caret at the end of `el`; selection scoped to `shadow` when the editor lives in one. */
function placeCaretAtEnd(el: HTMLElement, shadow?: ShadowRoot): void {
  const selection =
    (
      shadow as unknown as { getSelection?: () => Selection | null } | undefined
    )?.getSelection?.() ?? window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll a predicate until true or timeout. Returns whether it became true. */
async function waitForCond(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await sleep(100);
  }
  return false;
}

/** Poll a factory until it returns non-null or timeout. */
async function waitForValue<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = find();
    if (v) return v;
    await sleep(100);
  }
  return null;
}

// ── Smart Connect: people-search invite. Connect control is an <a>; the invite
// modal renders ASYNC in the #interop-outlet shadow root (same host as composer).
// See docs/linkedin-dom-anchors.md "Smart Connect". ──
const VERIFIED_SEND_NO_NOTE_LABELS = ['Send without a note'] as const;
const INVITE_DISMISS = 'button[aria-label="Dismiss"]';
const SEND_NO_NOTE_STRUCTURAL = [
  'button[data-view-name="send-invite-without-note"]',
  'button[data-testid="send-invite-without-note"]',
].join(',');

/** The live invite-modal's "Send without a note" button (re-queried each poll). */
function findSendNoNote(root: ParentNode): HTMLButtonElement | null {
  const shadow = root.querySelector<HTMLElement>(SHADOW_HOST)?.shadowRoot ?? null;
  if (!shadow) return null;
  const dialogs = [
    ...shadow.querySelectorAll<HTMLElement>('[role="dialog"], .artdeco-modal'),
  ].filter((dialog) => !dialog.hidden && dialog.getAttribute('aria-hidden') !== 'true');
  if (dialogs.length) {
    const structural = collectButtons(dialogs, SEND_NO_NOTE_STRUCTURAL);
    if (structural.length) return structural.length === 1 ? structural[0] : null;
    const exact = collectButtons(dialogs, 'button[aria-label]').filter((button) =>
      isExactLabel(button.getAttribute('aria-label'), VERIFIED_SEND_NO_NOTE_LABELS),
    );
    return exact.length === 1 ? exact[0] : null;
  }
  const wrapperless = [...shadow.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
    .filter((button) => !button.closest('[role="dialog"], .artdeco-modal'))
    .filter((button) =>
      isExactLabel(button.getAttribute('aria-label'), VERIFIED_SEND_NO_NOTE_LABELS),
    );
  return wrapperless.length === 1 ? wrapperless[0] : null;
}

function collectButtons(scopes: readonly ParentNode[], selector: string): HTMLButtonElement[] {
  const buttons = new Set<HTMLButtonElement>();
  for (const scope of scopes) {
    for (const button of scope.querySelectorAll<HTMLButtonElement>(selector)) buttons.add(button);
  }
  return [...buttons];
}

/**
 * Send a bare connection request to a harvested candidate by clicking the Connect control
 * (an `<a>` on people-search, a `<button>` on PYMK — located by member id). TWO flows exist
 * (both verified live):
 *  - people-search: the click opens the "Send without a note" shadow invite modal → we click
 *    it and confirm the modal closed.
 *  - PYMK (/mynetwork/): the click sends the invite DIRECTLY (no modal) and flips the control
 *    to Pending — we detect that flip and treat it as sent, so the send IS recorded (else the
 *    ban-safety cap silently leaks, re-invites, misreports).
 * Edge — the real send is exercised live, not in jsdom.
 */
export async function executeConnect(
  root: Document,
  candidate: { memberId: string; name: string },
  delay: HumanDelay,
  shouldAbort: ShouldAbort,
  commit?: CommitEffect,
): Promise<ActionResult> {
  if (shouldAbort()) return cancelledResult();
  const anchor = root.querySelector<HTMLElement>(
    `[componentkey*="member:${candidate.memberId}_"][componentkey$="_connect"]`,
  );
  if (!anchor) return { ok: false, reason: 'connect_anchor_not_found' };
  const pendingSelector = `[componentkey*="member:${candidate.memberId}_"][componentkey$="_pending"]`;
  const directSendControl = anchor.tagName !== 'A';
  let committed = false;
  const commitEdge = async () => {
    if (!commit) return true;
    if (committed) return true;
    committed = await commit();
    return committed;
  };
  if (directSendControl && !(await commitEdge())) return { ok: false, reason: 'commit_rejected' };
  anchor.click();

  // Race the two flows: whichever appears first wins. The modal (people-search) needs a
  // second click to send; a Pending flip (PYMK direct-send) means the invite already went out.
  const outcome = await waitForValue(() => {
    const send = findSendNoNote(root);
    if (send && !send.disabled) return { kind: 'modal' as const };
    if (root.querySelector(pendingSelector)) return { kind: 'sent' as const };
    return null;
  }, 6000);
  if (!outcome) {
    if (!committed && shouldAbort()) return cancelledResult();
    return committed
      ? { ok: false, reason: 'send_button_not_found', uncertain: true }
      : { ok: false, reason: 'send_button_not_found' };
  }
  if (outcome.kind === 'sent') {
    return commit && !committed
      ? { ok: false, reason: 'unexpected_direct_send', uncertain: true }
      : { ok: true };
  }
  if (!committed && shouldAbort()) {
    const send = findSendNoNote(root);
    if (send) dismissInvite(send);
    return cancelledResult();
  }

  await sleep(delay.nextMs(300, 900)); // brief human pause before sending
  if (!committed && shouldAbort()) {
    const send = findSendNoNote(root);
    if (send) dismissInvite(send);
    return cancelledResult();
  }
  const readySend = await waitForValue(() => {
    const send = findSendNoNote(root);
    return send && !send.disabled ? send : null;
  }, 6000);
  if (!readySend) return { ok: false, reason: 'send_button_not_found' };
  if (!committed && shouldAbort()) {
    dismissInvite(readySend);
    return cancelledResult();
  }
  if (!(await commitEdge())) {
    dismissInvite(readySend);
    return { ok: false, reason: 'commit_rejected' };
  }
  const currentSend = findSendNoNote(root);
  if (!currentSend || currentSend.disabled) {
    return committed
      ? { ok: false, reason: 'send_button_not_found', uncertain: true }
      : { ok: false, reason: 'send_button_not_found' };
  }
  currentSend.click();

  if (!committed) {
    const closed = await waitForCond(() => findSendNoNote(root) === null, 6000);
    return closed ? { ok: true } : { ok: false, reason: 'modal_did_not_close' };
  }

  const connectSelector = `[componentkey*="member:${candidate.memberId}_"][componentkey$="_connect"]`;
  const confirmed = await waitForCond(
    () =>
      root.querySelector(pendingSelector) !== null || root.querySelector(connectSelector) === null,
    6000,
  );
  return confirmed
    ? { ok: true }
    : { ok: false, reason: 'connect_confirmation_timeout', uncertain: true };
}

function dismissInvite(send: HTMLElement): void {
  const dialog = send.closest<HTMLElement>('[role="dialog"], .artdeco-modal');
  const scope = dialog ?? send.parentElement ?? (send.getRootNode() as ParentNode);
  scope.querySelector<HTMLElement>(INVITE_DISMISS)?.click();
}

function cancelledResult(): ActionResult {
  return { ok: false, reason: 'cancelled' };
}
