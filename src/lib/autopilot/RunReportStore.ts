import type { KeyValueStore } from '../ports';
import type { RunReport } from '../types';

export const REPORTS_KEY = 'autopilot:reports';

/** Persists autopilot run reports, newest first, capped. */
export class RunReportStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: KeyValueStore,
    private readonly cap = 50,
  ) {}

  async add(report: RunReport): Promise<void> {
    await this.serialize(async () => {
      const next = [report, ...(await this.read())].slice(0, this.cap);
      await this.store.set(REPORTS_KEY, next);
    });
  }

  /** Adds a report exactly once by run id, including concurrent retry calls. */
  async addOnce(report: RunReport): Promise<boolean> {
    return this.serialize(async () => {
      const current = await this.read();
      if (current.some((item) => item.id === report.id)) return false;
      await this.store.set(REPORTS_KEY, [report, ...current].slice(0, this.cap));
      return true;
    });
  }

  async list(): Promise<RunReport[]> {
    await this.tail;
    return this.read();
  }

  private async read(): Promise<RunReport[]> {
    const stored = await this.store.get<RunReport[]>(REPORTS_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  private serialize<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(mutation, mutation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
