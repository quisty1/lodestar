import type { ContentRunSession } from './runSession';

/** Applies an async response only while the same page-local run still owns the session. */
export async function settleRunResult<T, R>(
  session: ContentRunSession,
  runId: string,
  pending: Promise<T>,
  apply: (value: T) => R | Promise<R>,
): Promise<R | undefined> {
  const value = await pending;
  if (!session.isActive(runId)) return undefined;
  return apply(value);
}

/**
 * MAY_ACT stop decisions carry the authoritative natural stop reason. Preserve
 * that response even when the worker's STOP broadcast closes the local session
 * before the request promise resolves; all non-stop late responses stay stale.
 */
export async function settleRunDecision<T extends { action: string }>(
  session: ContentRunSession,
  runId: string,
  pending: Promise<T | undefined>,
): Promise<T | undefined> {
  const value = await pending;
  if (value?.action === 'stop') return value;
  return session.isActive(runId) ? value : undefined;
}
