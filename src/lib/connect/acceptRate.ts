export interface SentInvite {
  memberId: string;
  sentAt: string;
  name?: string;
  profileUrl?: string;
}

export interface AcceptRate {
  sent: number;
  /** Null until a scan has actually looked for acceptances. */
  accepted: number | null;
  /** Null when acceptance is still unknown. Never a fake 0%. */
  rate: number | null;
  windowDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Accept-rate over a recent window. `acceptedIds === null` means we have not checked yet. */
export function acceptRate(
  sent: SentInvite[],
  acceptedIds: ReadonlySet<string> | null,
  now: Date,
  windowDays = 28,
): AcceptRate {
  const from = now.getTime() - windowDays * DAY_MS;
  const recent = sent.filter((invite) => {
    const at = Date.parse(invite.sentAt);
    return Number.isFinite(at) && at >= from && at <= now.getTime();
  });
  if (acceptedIds === null) {
    return { sent: recent.length, accepted: null, rate: null, windowDays };
  }
  const accepted = recent.filter((invite) => acceptedIds.has(invite.memberId)).length;
  return {
    sent: recent.length,
    accepted,
    rate: recent.length ? accepted / recent.length : null,
    windowDays,
  };
}

/** Match a scanned connection back to an invite we sent, by id, profile URL, or name. */
export function matchAcceptedIds(
  sent: SentInvite[],
  seen: { id?: string; name?: string; profileUrl?: string }[],
): string[] {
  const ids = new Set<string>();
  for (const invite of sent) {
    const name = invite.name?.trim().toLowerCase();
    const url = normalizeUrl(invite.profileUrl);
    const hit = seen.some((person) => {
      if (person.id && person.id === invite.memberId) return true;
      if (url && normalizeUrl(person.profileUrl) === url) return true;
      return Boolean(name) && person.name?.trim().toLowerCase() === name;
    });
    if (hit) ids.add(invite.memberId);
  }
  return [...ids];
}

function normalizeUrl(url: string | undefined): string {
  return (url ?? '').replace(/\/$/, '').toLowerCase();
}
