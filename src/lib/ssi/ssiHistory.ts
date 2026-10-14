/**
 * SSI day-bucketed history. The mechanics are shared, payload-agnostic logic in
 * `../history/dailyHistory` — re-exported here so existing SSI callers keep their
 * import path while profile-views (and future metrics) reuse the same engine.
 */
export { dayKey, upsertDailySnapshot } from '../history/dailyHistory';
