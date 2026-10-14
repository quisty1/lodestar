// Non-blocking, static run indicator. Reference counting and countdown semantics
// are unchanged; only the status label is visible on the LinkedIn page.

const OVERLAY_ID = 'lodestar-activity-overlay';
const LABEL_ID = 'lodestar-activity-label';
const STYLE_ID = 'lodestar-activity-style';

// Module-level ref count: each start increments, each end decrements; the
// overlay is visible while > 0. Overlapping spans (e.g. an engagement run that
// itself triggers actions) therefore can't switch it off prematurely.
let active = 0;

function ensureInjected(doc: Document): HTMLElement {
  // Each part is ensured independently and idempotently: a stale overlay from a
  // prior build (the page DOM survives an extension reload) might be missing the
  // label child, so we must (re)add it rather than return early.
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} { display: none; pointer-events: none; }
      #${OVERLAY_ID}[data-on="1"] { display: block; }
      #${LABEL_ID} {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        max-width: min(360px, calc(100vw - 32px)); pointer-events: none;
        background: #222222; color: #f2f2f2; border: 1px solid #383838;
        font: 500 12px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        padding: 8px 12px; border-radius: 6px; overflow-wrap: anywhere;
      }
      #${LABEL_ID}:empty { display: none; }
    `;
    (doc.head ?? doc.documentElement).appendChild(style);
  }

  let el = doc.getElementById(OVERLAY_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('aria-hidden', 'true');
    (doc.body ?? doc.documentElement).appendChild(el);
  }
  if (!doc.getElementById(LABEL_ID)) {
    const label = doc.createElement('div');
    label.id = LABEL_ID;
    el.appendChild(label);
  }
  return el;
}

/** Begin one activity span — show the status indicator (idempotent, ref-counted). */
export function showActivity(doc: Document = document, label = ''): void {
  active += 1;
  ensureInjected(doc).setAttribute('data-on', '1');
  setActivityLabel(label, doc);
}

/** Update the status pill text (no-op if the overlay was never injected). */
export function setActivityLabel(text: string, doc: Document = document): void {
  const label = doc.getElementById(LABEL_ID);
  if (label) label.textContent = text;
}

/**
 * Count `ms` down on the pill once per second (so an anti-ban pause/break reads as a LIVE
 * timer, not frozen text), then resolve after the full duration — a drop-in for `await sleep(ms)`.
 * A backgrounded tab throttles this interval AND the real pacing identically, so the visible
 * countdown stays in sync with the actual wait; docked next to a foreground tab it ticks at 1 Hz.
 *
 * `shouldAbort` (optional): if it returns true on a tick, resolve immediately. Used by the
 * autopilot loop to break out of an 8–45s pause/break the instant the user presses STOP —
 * without it the overlay stays up counting down while the run is already halted.
 */
export function countdownActivity(
  ms: number,
  label: (remainingMs: number) => string,
  shouldAbort?: () => boolean,
  doc: Document = document,
): Promise<void> {
  setActivityLabel(label(ms), doc);
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = setInterval(() => {
      if (shouldAbort?.()) {
        clearInterval(tick);
        clearTimeout(timer);
        resolve();
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) setActivityLabel(label(remaining), doc);
    }, 1000);
    const timer = setTimeout(() => {
      clearInterval(tick);
      resolve();
    }, ms);
  });
}

/** End one activity span — hide the border (and clear the label) once every span has ended. */
export function hideActivity(doc: Document = document): void {
  active = Math.max(0, active - 1);
  if (active === 0) {
    doc.getElementById(OVERLAY_ID)?.setAttribute('data-on', '0');
    setActivityLabel('', doc);
  }
}

/** End every run-owned activity span and reset the next run's balance. */
export function clearActivity(doc: Document = document): void {
  active = 0;
  doc.getElementById(OVERLAY_ID)?.setAttribute('data-on', '0');
  setActivityLabel('', doc);
}

/** Test seam: reset the module-level ref count between cases. */
export function __resetActivity(): void {
  active = 0;
}
