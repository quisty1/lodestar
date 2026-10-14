export type InboundKind = 'viewed' | 'accepted' | 'messaged';

export interface InboundPerson {
  id: string;
  name: string;
  role: string;
  kind: InboundKind;
  profileUrl?: string;
}

export interface PeopleRead {
  status: 'known' | 'unknown';
  people: InboundPerson[];
}

const NAME_KEYS = ['name', 'fullName', 'publicIdentifier'];

/** Pull recognizable people out of a LinkedIn JSON payload. Unknown shape stays unknown. */
export function readPeople(payload: unknown, kind: InboundKind): PeopleRead {
  const people = collect(payload, kind, 0);
  const unique = dedupe(people);
  if (unique.length) return { status: 'known', people: unique.slice(0, 30) };
  if (hasEmptyList(payload)) return { status: 'known', people: [] };
  return { status: 'unknown', people: [] };
}

function collect(node: unknown, kind: InboundKind, depth: number): InboundPerson[] {
  if (depth > 8 || node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item) => collect(item, kind, depth + 1));
  const record = node as Record<string, unknown>;
  const person = asPerson(record, kind);
  const nested = Object.values(record).flatMap((value) => collect(value, kind, depth + 1));
  return person ? [person, ...nested] : nested;
}

function asPerson(record: Record<string, unknown>, kind: InboundKind): InboundPerson | null {
  const first = text(record.firstName);
  const last = text(record.lastName);
  const combined = [first, last].filter(Boolean).join(' ').trim();
  const name = combined || text(record.name) || text(record.fullName);
  if (!name || name.length < 2) return null;
  const role = text(record.headline) || text(record.occupation) || text(record.title) || '';
  const id =
    text(record.entityUrn) || text(record.publicIdentifier) || text(record.memberId) || name;
  const publicId = text(record.publicIdentifier);
  return {
    id,
    name,
    role,
    kind,
    ...(publicId ? { profileUrl: `https://www.linkedin.com/in/${publicId}` } : {}),
  };
}

function hasEmptyList(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  const lists = [record.elements, record.included, record.data];
  return lists.some((list) => Array.isArray(list) && list.length === 0);
}

function dedupe(people: InboundPerson[]): InboundPerson[] {
  const seen = new Set<string>();
  const out: InboundPerson[] = [];
  for (const person of people) {
    const key = person.id || person.name;
    if (seen.has(key)) continue;
    if (NAME_KEYS.includes(person.name)) continue;
    seen.add(key);
    out.push(person);
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
