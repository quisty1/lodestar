import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HumanDelay } from '@lib/engagement/HumanDelay';
import {
  executeComment,
  executeComposerPost,
  executeLike,
  executeLikeEffect,
  findComposer,
  findSubmit,
  findPostEditor,
} from './domActions';

// Same real anchors as FeedReader: post root [componentkey] + reaction button.
const FIXTURE = `
<div componentkey="POST_AAA">
  <button aria-label="Open control menu for post by Jane">⋯</button>
  <button aria-label="Reaction button state: no reaction">React</button>
  <button aria-label="Comment">Comment</button>
</div>
<div componentkey="POST_BBB">
  <button aria-label="Open control menu for post by Acme">⋯</button>
  <button aria-label="Reaction button state: Like">React</button>
  <button aria-label="Comment">Comment</button>
</div>`;

describe('executeLike', () => {
  let root: HTMLElement;
  let clicks: string[];

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = FIXTURE;
    clicks = [];
    root.querySelectorAll('button[aria-label^="Reaction button state"]').forEach((b) => {
      b.addEventListener('click', () => clicks.push(b.getAttribute('aria-label') ?? ''));
    });
  });

  it('clicks the reaction button of a not-yet-liked post', () => {
    const res = executeLike(root, 'POST_AAA');
    expect(res).toEqual({ ok: true });
    expect(clicks).toEqual(['Reaction button state: no reaction']);
  });

  it('skips an already-liked post without clicking (like dedup)', () => {
    const res = executeLike(root, 'POST_BBB');
    expect(res).toEqual({ ok: true, already: true });
    expect(clicks).toEqual([]);
  });

  it('reports when the post is not on the page', () => {
    expect(executeLike(root, 'POST_ZZZ')).toEqual({ ok: false, reason: 'post_not_found' });
  });

  it('does not click when the reaction state is unknown', () => {
    root.innerHTML = `
      <div componentkey="POST_CCC">
        <a data-view-name="feed-author-name" href="/in/jane/">Jane</a>
        <button data-view-name="feed-react-button">Like</button>
      </div>`;
    const button = root.querySelector('button');
    const click = vi.fn();
    button?.addEventListener('click', click);

    expect(executeLike(root, 'POST_CCC')).toEqual({ ok: false, reason: 'like_state_unknown' });
    expect(click).not.toHaveBeenCalled();
  });
});

// The "all 5 comments under one post" bug: executeComment found the editor with a GLOBAL
// document.querySelector, which returns the FIRST open editor on the page — so once one
// post's composer was open, every later comment typed into it. The editor renders INSIDE the
// post's [componentkey] node (verified live 2026-06-29), so findPostEditor scopes to the post.
describe('findPostEditor (scope the comment editor to its own post)', () => {
  const EDITOR_WRAP = 'ui-core-tiptap-text-editor-wrapper';
  const twoOpenEditors = `
    <div componentkey="POST_AAA">
      <button aria-label="Open control menu for post by Jane">⋯</button>
      <button aria-label="Reaction button state: no reaction">React</button>
      <div data-testid="${EDITOR_WRAP}"><div contenteditable="true" data-post="A">a</div></div>
    </div>
    <div componentkey="POST_BBB">
      <button aria-label="Open control menu for post by Acme">⋯</button>
      <button aria-label="Reaction button state: no reaction">React</button>
      <div data-testid="${EDITOR_WRAP}"><div contenteditable="true" data-post="B">b</div></div>
    </div>`;
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = twoOpenEditors;
  });

  it('returns the editor of the REQUESTED post, not the first one on the page', () => {
    expect(findPostEditor(root, 'POST_BBB')?.getAttribute('data-post')).toBe('B');
    expect(findPostEditor(root, 'POST_AAA')?.getAttribute('data-post')).toBe('A');
  });

  it('returns null when the post is not present', () => {
    expect(findPostEditor(root, 'POST_ZZZ')).toBeNull();
  });
});

// Build the real composer shape: an OPEN shadow root on #interop-outlet holding the
// sharebox modal, Quill editor and Post button — plus a DECOY .ql-editor in the light
// DOM (the /preload copy) that the adapter must ignore. (Live recon 2026-06-26.)
function mountComposer(): Document {
  document.body.innerHTML = `
    <div id="decoy"><div class="ql-editor" data-test-ql-editor-contenteditable="true">decoy</div></div>
    <div id="interop-outlet" data-testid="interop-shadowdom"></div>`;
  const host = document.querySelector('#interop-outlet') as HTMLElement;
  const sr = host.attachShadow({ mode: 'open' });
  sr.innerHTML = `
    <div data-test-modal-id="sharebox" role="dialog">
      <div class="ql-editor ql-blank" role="textbox"
           data-test-ql-editor-contenteditable="true"
           aria-label="Text editor for creating content"></div>
      <button class="share-actions__primary-action artdeco-button" disabled>Post</button>
      <button aria-label="Dismiss">x</button>
    </div>`;
  return document;
}

describe('findComposer', () => {
  it('locates the editor + Post button inside the #interop-outlet shadow root', () => {
    const handle = findComposer(mountComposer());
    expect(handle).not.toBeNull();
    expect(handle!.editor.getAttribute('aria-label')).toBe('Text editor for creating content');
    expect(handle!.post.textContent).toBe('Post');
  });

  it('ignores the decoy .ql-editor outside the shadow host', () => {
    const handle = findComposer(mountComposer());
    expect(handle!.editor.classList.contains('ql-blank')).toBe(true);
    expect(handle!.editor.textContent).toBe('');
  });

  it('returns null when the sharebox modal is not open', () => {
    document.body.innerHTML = `<div id="interop-outlet"></div>`;
    (document.querySelector('#interop-outlet') as HTMLElement).attachShadow({ mode: 'open' });
    expect(findComposer(document)).toBeNull();
  });
});

// The comment submit lives in the same block as the tiptap editor, BUT NOT inside the
// [componentkey] post node — and it has NO aria-label (only textContent "Comment"). The
// opener, by contrast, is button[aria-label="Comment"] with textContent = the comment
// COUNT. So findSubmit scopes from the open editor, walks up to the comment-box block,
// and matches by textContent — preferring the button WITHOUT aria-label (the submit) over
// the opener (which would re-toggle the editor instead of posting).
describe('findSubmit', () => {
  // editor + its sibling submit, inside a shared comment-box block (real LinkedIn shape).
  function editorBlock(opts: { submit?: string; opener?: string; editor?: string }): {
    editor: HTMLElement;
    block: HTMLElement;
  } {
    const root = document.createElement('div');
    root.innerHTML = `<div class="comment-box">
      <div class="tiptap ProseMirror" contenteditable="true" data-editor="1">${opts.editor ?? ''}</div>
      <div class="actions">
        ${opts.opener ?? ''}
        ${opts.submit ?? ''}
      </div>
    </div>`;
    return {
      editor: root.querySelector('[data-editor="1"]')!,
      block: root.querySelector('.comment-box')!,
    };
  }

  it('returns null while the submit is still disabled (ProseMirror has not committed the text)', () => {
    const { editor } = editorBlock({ submit: `<button disabled>Comment</button>` });
    expect(findSubmit(editor)).toBeNull();
  });

  it('finds the enabled submit by textContent, walking up from the editor to its block', () => {
    const { editor } = editorBlock({ submit: `<button>Comment</button>` });
    const submit = findSubmit(editor);
    expect(submit).not.toBeNull();
    expect(submit!.textContent.trim()).toBe('Comment');
  });

  it('prefers the submit (no aria-label) over the opener (aria-label="Comment" + count), never clicks the opener', () => {
    // opener = aria-label="Comment", textContent = the count "5"; submit = no aria-label, text "Comment"
    const { editor, block } = editorBlock({
      opener: `<button aria-label="Comment">5</button>`,
      submit: `<button>Comment</button>`,
    });
    const submit = findSubmit(editor);
    expect(submit).not.toBeNull();
    expect(submit!.getAttribute('aria-label')).toBeNull(); // the submit, not the opener
    expect(block.contains(submit)).toBe(true);
  });

  // Two open comment boxes under one feed container: post A's submit is ENABLED (its editor
  // lingered open), post B's is still DISABLED (ProseMirror commit pending). The bug: walking up
  // from editor B skips B's disabled submit, reaches the shared feed ancestor, and grabs A's
  // ENABLED submit — so B's comment posts under A. Over a run this piles many DIFFERENT comments
  // onto ONE post. findSubmit must stay in B's own box: return null (wait for B) — never A's submit.
  const twoBoxes = () => {
    const feed = document.createElement('div');
    feed.innerHTML = `
      <div class="comment-box">
        <div class="tiptap ProseMirror" contenteditable="true" data-editor="A">a</div>
        <div class="actions"><button data-box="A">Comment</button></div>
      </div>
      <div class="comment-box">
        <div class="tiptap ProseMirror" contenteditable="true" data-editor="B">b</div>
        <div class="actions"><button disabled data-box="B">Comment</button></div>
      </div>`;
    return feed;
  };

  it('never escapes to a SIBLING post submit while THIS submit is disabled (no comment-pile-on)', () => {
    const feed = twoBoxes();
    const editorB = feed.querySelector<HTMLElement>('[data-editor="B"]')!;
    const submit = findSubmit(editorB);
    expect(submit?.getAttribute('data-box')).not.toBe('A'); // must NOT grab post A's submit
    expect(submit).toBeNull(); // stays in B's box → waits for B's own submit to enable
  });

  it('returns THIS box submit once it enables, ignoring a sibling box', () => {
    const feed = twoBoxes();
    feed.querySelector<HTMLButtonElement>('[data-box="B"]')!.disabled = false;
    const editorB = feed.querySelector<HTMLElement>('[data-editor="B"]')!;
    expect(findSubmit(editorB)?.getAttribute('data-box')).toBe('B');
  });
});

describe('executeLikeEffect durable edge', () => {
  it('does not click when the persisted commit is rejected', async () => {
    const root = document.createElement('div');
    root.innerHTML = FIXTURE;
    const button = root.querySelector<HTMLElement>(
      '[componentkey="POST_AAA"] [aria-label^="Reaction"]',
    )!;
    const click = vi.fn();
    button.addEventListener('click', click);

    await expect(executeLikeEffect(root, 'POST_AAA', async () => false)).resolves.toEqual({
      ok: false,
      reason: 'commit_rejected',
    });
    expect(click).not.toHaveBeenCalled();
  });

  it('keeps confirming after STOP once commit won', async () => {
    const root = document.createElement('div');
    root.innerHTML = FIXTURE;
    const button = root.querySelector<HTMLElement>(
      '[componentkey="POST_AAA"] [aria-label^="Reaction"]',
    )!;
    let stopped = false;
    button.addEventListener('click', () => {
      button.setAttribute('aria-label', 'Reaction button state: Like');
    });

    const result = await executeLikeEffect(
      root,
      'POST_AAA',
      async () => {
        stopped = true;
        return true;
      },
      () => stopped,
    );

    expect(result).toEqual({ ok: true });
    expect(button.getAttribute('aria-label')).toBe('Reaction button state: Like');
  });

  it('re-finds a reaction control replaced by the LinkedIn rerender', async () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement('div');
      root.innerHTML = FIXTURE;
      const button = root.querySelector<HTMLElement>(
        '[componentkey="POST_AAA"] [aria-label^="Reaction"]',
      )!;
      button.addEventListener('click', () => {
        const replacement = button.cloneNode(true) as HTMLElement;
        replacement.setAttribute('aria-label', 'Reaction button state: Like');
        button.replaceWith(replacement);
      });

      const pending = executeLikeEffect(root, 'POST_AAA', async () => true);
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('irreversible submit cancellation', () => {
  const delay = new HumanDelay({ next: () => 0 });

  it('does not submit a comment when STOP arrives after the editor opens', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <div componentkey="POST_CANCEL">
          <button aria-label="Open control menu for post by Jane">⋯</button>
          <button aria-label="Reaction button state: no reaction">React</button>
          <button aria-label="Comment">Comment</button>
          <div class="comment-box">
            <div data-testid="ui-core-tiptap-text-editor-wrapper">
              <div contenteditable="true"></div>
            </div>
            <button data-submit>Comment</button>
          </div>
        </div>`;
      const submit = document.querySelector<HTMLButtonElement>('[data-submit]')!;
      const opener = document.querySelector<HTMLButtonElement>('button[aria-label="Comment"]')!;
      const commentBox = document.querySelector<HTMLElement>('.comment-box')!;
      const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
      const submitClick = vi.fn();
      submit.addEventListener('click', submitClick);
      let openerClicks = 0;
      opener.addEventListener('click', () => {
        openerClicks += 1;
        if (openerClicks > 1) commentBox.remove();
      });
      const execCommand = vi.fn((command: string, _ui?: boolean, value?: string) => {
        if (command === 'insertText') editor.textContent = value ?? '';
        if (command === 'delete') editor.textContent = '';
        return true;
      });
      Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
      let cancelled = false;

      const result = executeComment(
        document,
        'POST_CANCEL',
        'Draft comment',
        delay,
        () => cancelled,
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(execCommand).toHaveBeenCalled();

      cancelled = true;
      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' });
      expect(submitClick).not.toHaveBeenCalled();
      expect(editor.textContent).toBe('');
      expect(document.querySelector('.comment-box')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not publish when STOP arrives after the composer opens', async () => {
    vi.useFakeTimers();
    try {
      const root = mountComposer();
      const trigger = document.createElement('button');
      trigger.setAttribute('aria-label', 'Start a post');
      document.body.prepend(trigger);
      const post = findComposer(root)!.post;
      const shadow = findComposer(root)!.shadow;
      post.disabled = false;
      const postClick = vi.fn(() => post.closest('[role="dialog"]')?.remove());
      post.addEventListener('click', postClick);
      const execCommand = vi.fn(() => true);
      Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
      const dismissed = vi.fn();
      const discarded = vi.fn();
      shadow
        .querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!
        .addEventListener('click', () => {
          dismissed();
          const discard = document.createElement('button');
          discard.textContent = 'Discard';
          discard.addEventListener('click', () => {
            discarded();
            shadow.querySelector('[role="dialog"]')?.remove();
          });
          shadow.appendChild(discard);
        });
      let cancelled = false;

      const result = executeComposerPost(root, 'Draft post', delay, () => cancelled);
      await Promise.resolve();
      await Promise.resolve();
      expect(execCommand).toHaveBeenCalled();

      cancelled = true;
      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' });
      expect(postClick).not.toHaveBeenCalled();
      expect(dismissed).toHaveBeenCalledOnce();
      expect(discarded).toHaveBeenCalledOnce();
      expect(findComposer(root)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('submits and confirms a prepared comment after commit even when STOP follows commit', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <div componentkey="POST_COMMIT">
          <button aria-label="Open control menu for post by Jane">⋯</button>
          <button aria-label="Reaction button state: no reaction">React</button>
          <button aria-label="Comment">Comment</button>
          <div class="comment-box">
            <div data-testid="ui-core-tiptap-text-editor-wrapper"><div contenteditable="true"></div></div>
            <button data-submit>Comment</button>
          </div>
        </div>`;
      const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
      const submit = document.querySelector<HTMLButtonElement>('[data-submit]')!;
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn((_command: string, _ui: boolean, value: string) => {
          editor.textContent = value;
          return true;
        }),
      });
      let stopped = false;
      submit.addEventListener('click', () => document.querySelector('.comment-box')?.remove());

      const result = executeComment(
        document,
        'POST_COMMIT',
        'Durable comment',
        delay,
        () => stopped,
        async () => {
          stopped = true;
          return true;
        },
      );
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ ok: true });
      expect(document.querySelector('.comment-box')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not publish when commit is rejected at the Post button', async () => {
    vi.useFakeTimers();
    try {
      const root = mountComposer();
      const trigger = document.createElement('button');
      trigger.setAttribute('aria-label', 'Start a post');
      document.body.prepend(trigger);
      const post = findComposer(root)!.post;
      post.disabled = false;
      const click = vi.fn();
      post.addEventListener('click', click);
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => true),
      });

      const result = executeComposerPost(
        root,
        'Draft post',
        delay,
        () => false,
        async () => false,
      );
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ ok: false, reason: 'commit_rejected' });
      expect(click).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
