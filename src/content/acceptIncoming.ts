const ACCEPT = /^(accept|принять)(\s|$)/i;
const ACCEPT_ALL = /(accept all|принять все)/i;

export interface AcceptIncomingDependencies {
  sleep(ms: number, shouldAbort: () => boolean): Promise<void>;
  nextDelay(): number;
  shouldAbort(): boolean;
}

export interface AcceptIncomingResult {
  accepted: number;
  cancelled?: true;
}

/** Click individual Accept buttons. Never the "accept all" control. */
export async function acceptIncoming(
  root: ParentNode,
  cap: number,
  dependencies: AcceptIncomingDependencies,
): Promise<AcceptIncomingResult> {
  let accepted = 0;
  const seen = new Set<HTMLButtonElement>();
  while (accepted < cap) {
    if (dependencies.shouldAbort()) return { accepted, cancelled: true };
    const button = acceptButtons(root).find(
      (candidate) => !seen.has(candidate) && !candidate.disabled,
    );
    if (!button) break;
    seen.add(button);
    button.click();
    accepted += 1;
    if (accepted >= cap) break;
    await dependencies.sleep(dependencies.nextDelay(), () => dependencies.shouldAbort());
    if (dependencies.shouldAbort()) return { accepted, cancelled: true };
  }
  return { accepted };
}

export function acceptButtons(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter((button) => {
    const label = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`
      .replace(/\s+/g, ' ')
      .trim();
    return ACCEPT.test(label) && !ACCEPT_ALL.test(label);
  });
}
