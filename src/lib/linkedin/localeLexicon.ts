export const REACTION_LABEL_PREFIXES = [
  'Reaction button state',
  'Состояние кнопки реакции',
  'Starea butonului de reacție',
] as const;

export const NO_REACTION_LABELS = [
  'Reaction button state: no reaction',
  'Состояние кнопки реакции: нет реакции',
  'Starea butonului de reacție: nicio reacție',
] as const;

export const CONTROL_MENU_AUTHOR_PREFIXES = [
  'Open control menu for post by ',
  'Открыть меню управления публикацией автора ',
  'Deschide meniul de control pentru postarea lui ',
] as const;

export const COMMENT_OPEN_LABELS = ['Comment', 'Комментировать', 'Comentează'] as const;
export const COMMENT_SUBMIT_LABELS = [
  'Comment',
  'Post',
  'Reply',
  'Комментировать',
  'Опубликовать',
  'Ответить',
  'Comentează',
  'Postează',
  'Răspunde',
] as const;

export const PEOPLE_EMPTY_LABELS = [
  'No results found',
  'Результаты не найдены',
  'Nu s-au găsit rezultate',
] as const;

export const FEED_EMPTY_LABELS = [
  'No posts yet',
  'Публикаций пока нет',
  'Nicio postare încă',
] as const;

export const CANCEL_LABELS = ['Cancel', 'Отмена', 'Anulează'] as const;

const CONNECT_PATTERNS = [
  /^Invite (.+) to connect$/u,
  /^Пригласить пользователя (.+) установить контакт$/u,
  /^Invită pe (.+) să vă conectați$/u,
] as const;

const PAGE_PATTERNS = [/^Page (\d+)$/u, /^Страница (\d+)$/u, /^Pagina (\d+)$/u] as const;

const WVMP_PATTERNS = [
  /^Profile viewers in the past (\d+) days$/iu,
  /^Просмотров профиля за последние (\d+) (?:день|дня|дней)$/iu,
  /^Vizualizări ale profilului în ultimele (\d+) (?:zile|de zile)$/iu,
] as const;

export const SSI_PAGE_MARKERS = [
  'your social selling index',
  'ваш индекс социальных продаж',
  'indicele dvs. de vânzări sociale',
] as const;

export const SSI_PILLAR_MATCHERS = {
  brand: [
    'establish your professional brand',
    'создание профессионального бренда',
    'construiește-ți brandul profesional',
  ],
  people: ['find the right people', 'поиск нужных людей', 'găsește persoanele potrivite'],
  insights: [
    'engage with insights',
    'взаимодействие с аналитическими материалами',
    'interacționează cu informații',
  ],
  relationships: ['build relationships', 'установление отношений', 'construiește relații'],
} as const;

export function isExactLabel(value: string | null | undefined, labels: readonly string[]): boolean {
  const normalized = normalizeText(value);
  return labels.some((label) => normalizeText(label) === normalized);
}

export function hasExactPrefix(
  value: string | null | undefined,
  prefixes: readonly string[],
): boolean {
  const normalized = normalizeText(value);
  return prefixes.some((prefix) => normalized.startsWith(normalizeText(prefix)));
}

export function authorFromControlLabel(value: string | null | undefined): string | null {
  return stripPrefix(value, CONTROL_MENU_AUTHOR_PREFIXES);
}

export function nameFromConnectLabel(value: string | null | undefined): string | null {
  return capture(value, CONNECT_PATTERNS);
}

export function pageNumberFromLabel(value: string | null | undefined): number | null {
  const captured = capture(value, PAGE_PATTERNS);
  if (!captured) return null;
  const parsed = Number(captured);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function wvmpWindowDays(value: string): number | null {
  const captured = capture(value, WVMP_PATTERNS);
  return captured ? Number(captured) : null;
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function stripPrefix(value: string | null | undefined, prefixes: readonly string[]): string | null {
  const normalized = normalizeText(value);
  for (const prefix of prefixes) {
    const compact = normalizeText(prefix);
    if (normalized.startsWith(compact)) return normalized.slice(compact.length).trim() || null;
  }
  return null;
}

function capture(value: string | null | undefined, patterns: readonly RegExp[]): string | null {
  const normalized = normalizeText(value);
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}
