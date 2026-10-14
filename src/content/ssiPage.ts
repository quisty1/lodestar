import type { SsiParser } from '@lib/ssi/SsiParser';
import type { DomSsiSource } from '@/adapters/DomSsiSource';
import { send } from './contentTiming';

const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 25;

export function parseAndReport(parser: SsiParser, source: DomSsiSource): void {
  const root = source.getRoot();
  const snapshot = root ? parser.parse(root) : null;
  send(
    snapshot
      ? { type: 'SSI_SNAPSHOT', payload: snapshot }
      : { type: 'SSI_PARSE_FAILED', reason: 'No SSI data on this page' },
  );
}

export function parseWhenReady(parser: SsiParser, source: DomSsiSource, attempt = 0): void {
  const root = source.getRoot();
  const snapshot = root ? parser.parse(root) : null;
  if (snapshot) {
    send({ type: 'SSI_SNAPSHOT', payload: snapshot });
    return;
  }
  if (attempt >= MAX_POLLS) {
    send({
      type: 'SSI_PARSE_FAILED',
      reason: 'SSI numbers did not render in time',
    });
    return;
  }
  setTimeout(() => {
    parseWhenReady(parser, source, attempt + 1);
  }, POLL_INTERVAL_MS);
}

export function watchSsiDashboard(parser: SsiParser, source: DomSsiSource): void {
  if (location.pathname.startsWith('/sales/ssi')) parseWhenReady(parser, source);
}
