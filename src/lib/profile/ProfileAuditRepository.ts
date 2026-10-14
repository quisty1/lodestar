import type { KeyValueStore } from '@lib/ports';
import { isProfileAuditResult, type ProfileAuditResult } from './contracts';

const LATEST_KEY = 'profileAudit:lastResult';

/** Persists only the normalized audit result; the transient profile snapshot never enters storage. */
export class ProfileAuditRepository {
  constructor(private readonly store: KeyValueStore) {}

  async save(result: ProfileAuditResult): Promise<void> {
    if (!isProfileAuditResult(result)) throw new Error('Invalid profile audit result');
    await this.store.set(LATEST_KEY, result);
  }

  async latest(): Promise<ProfileAuditResult | null> {
    const stored = await this.store.get<unknown>(LATEST_KEY);
    return isProfileAuditResult(stored) ? stored : null;
  }
}
