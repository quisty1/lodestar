export const ACCOUNT_KEY = 'linkedin:account';
export const MIGRATED_ACCOUNT_KEY = 'linkedin:migratedTo';

export interface LinkedInAccount {
  id: string;
  publicId: string;
  capturedAt: string;
}

const SCOPED_KEYS = [
  'content:drafts',
  'connect:history',
  'connect:history:effect-ids',
  'connects:sent',
  'connects:budget',
  'connects:daily',
  'views:history',
  'views:history:effect-ids',
  'views:seen',
  'views:daily',
  'comments:journal',
  'comments:budget',
  'comments:acted',
  'posts:budget',
  'autopilot:reports',
  'autopilot:state',
] as const;

export const ACCOUNT_SCOPED_KEYS: ReadonlySet<string> = new Set(SCOPED_KEYS);

export function accountStorageKey(accountId: string, key: string): string {
  return `acct:${accountId}:${key}`;
}

export function isLinkedInAccount(value: unknown): value is LinkedInAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as Partial<LinkedInAccount>;
  return (
    typeof account.id === 'string' &&
    account.id.length > 0 &&
    typeof account.publicId === 'string' &&
    account.publicId.length > 0 &&
    typeof account.capturedAt === 'string'
  );
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Reads a stable member id and public vanity from the shapes Voyager `/me` has used. */
export function readLinkedInAccount(payload: unknown, capturedAt: string): LinkedInAccount | null {
  const root = record(payload);
  if (!root) return null;
  const data = record(root.data) ?? root;
  const mini = record(data.miniProfile) ?? record(root.miniProfile);
  const publicId =
    text(data.publicIdentifier) ?? text(mini?.publicIdentifier) ?? text(root.publicIdentifier);
  const urn = text(data.entityUrn) ?? text(mini?.entityUrn) ?? text(root.entityUrn);
  const plainId =
    typeof data.plainId === 'number' || typeof data.plainId === 'string'
      ? String(data.plainId)
      : null;
  const id = urn ?? plainId ?? publicId;
  if (!id || !publicId) return null;
  return { id, publicId, capturedAt };
}
