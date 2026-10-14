import type { SsiSource } from '@lib/ports';

/**
 * Yields the live document as the parse root. Thin edge adapter — the only
 * place the SSI pipeline touches the global `document`.
 */
export class DomSsiSource implements SsiSource {
  getRoot(): ParentNode | null {
    return typeof document !== 'undefined' ? document : null;
  }
}
