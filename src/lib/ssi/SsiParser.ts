import type { SsiSnapshot } from '../types';
import type { Clock, SsiParseStrategy } from '../ports';

/**
 * Orchestrates a list of SSI parse strategies (Strategy pattern + OCP).
 * SRP: it only sequences strategies and stamps the capture time — no DOM knowledge.
 * DIP: strategies and clock are injected; nothing here imports document/chrome.
 */
export class SsiParser {
  constructor(
    private readonly strategies: readonly SsiParseStrategy[],
    private readonly clock: Clock,
  ) {
    if (strategies.length === 0) {
      throw new Error('SsiParser requires at least one strategy');
    }
  }

  /** Parse the first strategy that succeeds; returns null if all fail. */
  parse(root: ParentNode): SsiSnapshot | null {
    for (const strategy of this.strategies) {
      const partial = strategy.parse(root);
      if (partial) {
        return { ...partial, capturedAt: this.clock.now().toISOString() };
      }
    }
    return null;
  }
}
