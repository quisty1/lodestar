export type AttachContentRunResult = 'attached' | 'duplicate' | 'busy';
export type BeginContentRunResult = 'started' | 'duplicate' | 'busy' | 'missing';
type ContentRunPhase = 'reserved' | 'looping';

/** Owns the page-local loop identity so stale worker messages cannot cross runs. */
export class ContentRunSession {
  private currentRunId: string | null = null;
  private phase: ContentRunPhase | null = null;
  private closedRunId: string | null = null;

  get activeRunId(): string | null {
    return this.currentRunId;
  }

  attach(runId: string): AttachContentRunResult {
    if (this.currentRunId === runId) return 'duplicate';
    if (this.currentRunId === null && this.closedRunId === runId) return 'duplicate';
    if (this.currentRunId !== null) return 'busy';
    this.currentRunId = runId;
    this.phase = 'reserved';
    return 'attached';
  }

  beginLoop(runId: string): BeginContentRunResult {
    if (this.currentRunId === runId) {
      if (this.phase === 'looping') return 'duplicate';
      this.phase = 'looping';
      return 'started';
    }
    if (this.currentRunId !== null) return 'busy';
    if (this.closedRunId === runId) return 'duplicate';
    return 'missing';
  }

  /** Legacy/test seam: attach and enter the loop in one call. Runtime traffic uses both phases. */
  begin(runId: string): BeginContentRunResult {
    const attached = this.attach(runId);
    if (attached === 'busy') return 'busy';
    if (attached === 'duplicate' && this.currentRunId !== runId) return 'duplicate';
    return this.beginLoop(runId);
  }

  isActive(runId: string): boolean {
    return this.currentRunId === runId;
  }

  isLooping(runId: string): boolean {
    return this.currentRunId === runId && this.phase === 'looping';
  }

  finish(runId: string): boolean {
    if (this.currentRunId !== runId) return false;
    this.currentRunId = null;
    this.phase = null;
    this.closedRunId = runId;
    return true;
  }

  stop(runId?: string): boolean {
    if (this.currentRunId === null) return false;
    if (runId !== undefined && runId !== this.currentRunId) return false;
    this.closedRunId = this.currentRunId;
    this.currentRunId = null;
    this.phase = null;
    return true;
  }
}
