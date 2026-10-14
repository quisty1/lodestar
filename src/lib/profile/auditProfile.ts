import type {
  Observation,
  ProfileAuditBasis,
  ProfileAuditCategory,
  ProfileAuditCategorySummary,
  ProfileAuditItem,
  ProfileAuditResult,
  ProfileAuditSeverity,
  ProfileAuditStatus,
  ProfileSnapshot,
} from './contracts';
import { PROFILE_AUDIT_CATEGORIES, PROFILE_AUDIT_SCHEMA_VERSION } from './contracts';

const PROFILE = 'https://www.linkedin.com/in/me/';
const DETAILS = (section: string) => `${PROFILE}details/${section}/`;
const CATEGORY_LABELS: Record<ProfileAuditCategory, string> = {
  completeness: 'Заполненность',
  discoverability: 'Видимость для рекрутеров',
  consistency: 'Согласованность',
  evidence: 'Доказательства опыта',
};

export function auditProfile(
  snapshot: ProfileSnapshot,
  auditedAt = snapshot.capturedAt,
): ProfileAuditResult {
  const items: ProfileAuditItem[] = [
    booleanRule(
      'photo',
      'Фото профиля',
      'completeness',
      snapshot.photo,
      'high',
      'linkedin',
      'Фото найдено.',
      'Фото не найдено.',
      'Добавь профессиональное фото.',
      PROFILE,
    ),
    booleanRule(
      'banner',
      'Фоновый баннер',
      'completeness',
      snapshot.banner,
      'low',
      'best-practice',
      'Баннер найден.',
      'Баннер не найден.',
      'Добавь баннер с ролью или специализацией.',
      PROFILE,
    ),
    headlineRule(snapshot.headline),
    aboutRule(snapshot.about),
    booleanRule(
      'location',
      'Локация',
      'completeness',
      snapshot.location,
      'high',
      'linkedin',
      'Локация указана.',
      'Локация не указана.',
      'Укажи целевой город или регион.',
      PROFILE,
    ),
    booleanRule(
      'industry',
      'Индустрия',
      'completeness',
      snapshot.industry,
      'medium',
      'linkedin',
      'Индустрия указана.',
      'Индустрия не указана.',
      'Выбери релевантную индустрию.',
      PROFILE,
    ),
    currentPositionRule(snapshot.currentPosition),
    countRule(
      'education',
      'Образование',
      'completeness',
      snapshot.educationCount,
      1,
      'medium',
      'linkedin',
      'Добавь хотя бы одно образование.',
      DETAILS('education'),
    ),
    skillsRule(snapshot.skills),
    booleanRule(
      'publicUrl',
      'Публичный URL',
      'completeness',
      snapshot.publicUrl,
      'low',
      'best-practice',
      'Публичный URL найден.',
      'Публичный URL не подтверждён.',
      'Проверь публичный URL профиля.',
      PROFILE,
    ),
    openToWorkRule(snapshot.openToWork),
    alignmentRule(snapshot),
    booleanRule(
      'featured',
      'Featured',
      'evidence',
      snapshot.featured,
      'medium',
      'best-practice',
      'Featured заполнен.',
      'Featured не найден.',
      'Добавь CV, кейс или лучший материал.',
      DETAILS('featured'),
    ),
    booleanRule(
      'recommendations',
      'Рекомендации',
      'evidence',
      snapshot.recommendations,
      'medium',
      'best-practice',
      'Рекомендации найдены.',
      'Рекомендации не найдены.',
      'Запроси рекомендации у коллег или руководителей.',
      DETAILS('recommendations'),
    ),
    booleanRule(
      'projects',
      'Проекты',
      'evidence',
      snapshot.projects,
      'low',
      'best-practice',
      'Проекты найдены.',
      'Проекты не найдены.',
      'Добавь 1–3 релевантных проекта.',
      DETAILS('projects'),
    ),
    experienceDescriptionRule(snapshot.experience),
    quantifiedOutcomesRule(snapshot.experience),
  ];

  return {
    schemaVersion: PROFILE_AUDIT_SCHEMA_VERSION,
    auditedAt,
    items,
    categories: PROFILE_AUDIT_CATEGORIES.map((key) => summarize(key, items)),
    metrics:
      snapshot.searchAppearances.state === 'known'
        ? { searchAppearances: snapshot.searchAppearances.value }
        : {},
  };
}

function headlineRule(observation: ProfileSnapshot['headline']): ProfileAuditItem {
  if (observation.state === 'unknown')
    return unknownRule('headline', 'Headline', 'completeness', 'high', 'recruiter-search', PROFILE);
  const { present, length } = observation.value;
  if (!present)
    return rule(
      'headline',
      'Headline',
      'completeness',
      'fail',
      'high',
      'recruiter-search',
      'Headline отсутствует.',
      'Добавь целевую роль, специализацию и ключевой стек.',
      PROFILE,
    );
  if (length < 40)
    return rule(
      'headline',
      'Headline',
      'completeness',
      'warn',
      'medium',
      'recruiter-search',
      `Headline короткий: ${length} символов.`,
      'Добавь роль, специализацию и ключевой стек.',
      PROFILE,
    );
  return rule(
    'headline',
    'Headline',
    'completeness',
    'pass',
    'medium',
    'recruiter-search',
    `Headline заполнен: ${length} символов.`,
    'Сохраняй фокус на целевой роли.',
    PROFILE,
  );
}

function aboutRule(observation: ProfileSnapshot['about']): ProfileAuditItem {
  if (observation.state === 'unknown')
    return unknownRule('about', 'About', 'completeness', 'high', 'best-practice', PROFILE);
  const { present, length } = observation.value;
  if (!present)
    return rule(
      'about',
      'About',
      'completeness',
      'fail',
      'high',
      'best-practice',
      'About отсутствует.',
      'Опиши специализацию, опыт, результаты и целевую роль.',
      PROFILE,
    );
  if (length < 300)
    return rule(
      'about',
      'About',
      'completeness',
      'warn',
      'medium',
      'best-practice',
      `About короткий: ${length} символов.`,
      'Добавь результаты, стек и контекст целевой роли.',
      PROFILE,
    );
  return rule(
    'about',
    'About',
    'completeness',
    'pass',
    'medium',
    'best-practice',
    `About заполнен: ${length} символов.`,
    'Поддерживай описание актуальным.',
    PROFILE,
  );
}

function currentPositionRule(observation: ProfileSnapshot['currentPosition']): ProfileAuditItem {
  if (observation.state === 'unknown')
    return unknownRule(
      'currentPosition',
      'Текущая позиция',
      'completeness',
      'high',
      'linkedin',
      DETAILS('experience'),
    );
  return booleanRule(
    'currentPosition',
    'Текущая позиция',
    'completeness',
    { state: 'known', value: observation.value.present },
    'high',
    'linkedin',
    'Текущая позиция найдена.',
    'Текущая позиция не найдена.',
    'Добавь актуальную позицию и описание ответственности.',
    DETAILS('experience'),
  );
}

function skillsRule(observation: ProfileSnapshot['skills']): ProfileAuditItem {
  if (observation.state === 'unknown')
    return unknownRule(
      'skills',
      'Навыки',
      'completeness',
      'high',
      'recruiter-search',
      DETAILS('skills'),
    );
  const count = observation.value.count;
  if (count < 5)
    return rule(
      'skills',
      'Навыки',
      'completeness',
      'fail',
      'high',
      'recruiter-search',
      `Найдено навыков: ${count}.`,
      'Добавь минимум 5 релевантных навыков.',
      DETAILS('skills'),
    );
  if (count < 10)
    return rule(
      'skills',
      'Навыки',
      'completeness',
      'warn',
      'medium',
      'recruiter-search',
      `Найдено навыков: ${count}.`,
      'Расширь список до 10+ навыков по целевой роли.',
      DETAILS('skills'),
    );
  return rule(
    'skills',
    'Навыки',
    'completeness',
    'pass',
    'medium',
    'recruiter-search',
    `Найдено навыков: ${count}.`,
    'Держи наиболее важные навыки наверху.',
    DETAILS('skills'),
  );
}

function openToWorkRule(observation: ProfileSnapshot['openToWork']): ProfileAuditItem {
  if (observation.state === 'unknown')
    return unknownRule(
      'openToWork',
      'Open to Work',
      'discoverability',
      'high',
      'recruiter-search',
      PROFILE,
    );
  return rule(
    'openToWork',
    'Open to Work',
    'discoverability',
    observation.value.enabled ? 'pass' : 'warn',
    'high',
    'recruiter-search',
    observation.value.enabled ? 'Open to Work включён.' : 'Open to Work выключен.',
    'Включи Open to Work и проверь целевые роли.',
    PROFILE,
  );
}

function alignmentRule(snapshot: ProfileSnapshot): ProfileAuditItem {
  const observations = [snapshot.headline, snapshot.currentPosition, snapshot.openToWork];
  if (observations.some((value) => value.state === 'unknown')) {
    return unknownRule(
      'roleAlignment',
      'Фокус целевой роли',
      'consistency',
      'medium',
      'recruiter-search',
      PROFILE,
    );
  }
  if (
    snapshot.headline.state !== 'known' ||
    snapshot.currentPosition.state !== 'known' ||
    snapshot.openToWork.state !== 'known'
  ) {
    return unknownRule(
      'roleAlignment',
      'Фокус целевой роли',
      'consistency',
      'medium',
      'recruiter-search',
      PROFILE,
    );
  }
  const headline = snapshot.headline.value;
  const current = snapshot.currentPosition.value;
  const open = snapshot.openToWork.value;
  if (!headline.present || !current.present || !open.enabled || open.titleTerms.length === 0) {
    return unknownRule(
      'roleAlignment',
      'Фокус целевой роли',
      'consistency',
      'medium',
      'recruiter-search',
      PROFILE,
    );
  }
  const overlap =
    termOverlap(headline.terms, current.titleTerms) +
    termOverlap(headline.terms, open.titleTerms) +
    termOverlap(current.titleTerms, open.titleTerms);
  return overlap > 0
    ? rule(
        'roleAlignment',
        'Фокус целевой роли',
        'consistency',
        'pass',
        'medium',
        'recruiter-search',
        `Совпадающих терминов роли: ${overlap}.`,
        'Сохраняй единый фокус в headline, Experience и Open to Work.',
        PROFILE,
      )
    : rule(
        'roleAlignment',
        'Фокус целевой роли',
        'consistency',
        'warn',
        'medium',
        'recruiter-search',
        'Термины роли не совпадают.',
        'Согласуй headline, текущую позицию и Open to Work.',
        PROFILE,
      );
}

function experienceDescriptionRule(observation: ProfileSnapshot['experience']): ProfileAuditItem {
  if (observation.state === 'unknown' || observation.value.total === 0) {
    return unknownRule(
      'experienceDescriptions',
      'Описания опыта',
      'evidence',
      'high',
      'best-practice',
      DETAILS('experience'),
    );
  }
  const { described, total } = observation.value;
  const status: ProfileAuditStatus =
    described === total ? 'pass' : described === 0 ? 'fail' : 'warn';
  return rule(
    'experienceDescriptions',
    'Описания опыта',
    'evidence',
    status,
    'high',
    'best-practice',
    `С описанием: ${described} из ${total}.`,
    'Добавь ответственность и результаты к каждой релевантной позиции.',
    DETAILS('experience'),
  );
}

function quantifiedOutcomesRule(observation: ProfileSnapshot['experience']): ProfileAuditItem {
  if (observation.state === 'unknown' || observation.value.total === 0) {
    return unknownRule(
      'quantifiedOutcomes',
      'Измеримые результаты',
      'evidence',
      'medium',
      'best-practice',
      DETAILS('experience'),
    );
  }
  const count = observation.value.quantified;
  return rule(
    'quantifiedOutcomes',
    'Измеримые результаты',
    'evidence',
    count > 0 ? 'pass' : 'warn',
    'medium',
    'best-practice',
    `Позиций с цифрами: ${count}.`,
    'Добавь конкретный масштаб, проценты, сроки или бизнес-результат.',
    DETAILS('experience'),
  );
}

function countRule(
  key: string,
  label: string,
  category: ProfileAuditCategory,
  observation: Observation<number>,
  minimum: number,
  severity: ProfileAuditSeverity,
  basis: ProfileAuditBasis,
  recommendation: string,
  editUrl: string,
): ProfileAuditItem {
  if (observation.state === 'unknown')
    return unknownRule(key, label, category, severity, basis, editUrl);
  return rule(
    key,
    label,
    category,
    observation.value >= minimum ? 'pass' : 'warn',
    severity,
    basis,
    `Найдено: ${observation.value}.`,
    recommendation,
    editUrl,
  );
}

function booleanRule(
  key: string,
  label: string,
  category: ProfileAuditCategory,
  observation: Observation<boolean>,
  severity: ProfileAuditSeverity,
  basis: ProfileAuditBasis,
  passEvidence: string,
  missingEvidence: string,
  recommendation: string,
  editUrl: string,
): ProfileAuditItem {
  if (observation.state === 'unknown')
    return unknownRule(key, label, category, severity, basis, editUrl);
  return rule(
    key,
    label,
    category,
    observation.value ? 'pass' : severity === 'high' ? 'fail' : 'warn',
    severity,
    basis,
    observation.value ? passEvidence : missingEvidence,
    recommendation,
    editUrl,
  );
}

function unknownRule(
  key: string,
  label: string,
  category: ProfileAuditCategory,
  severity: ProfileAuditSeverity,
  basis: ProfileAuditBasis,
  editUrl: string,
): ProfileAuditItem {
  return rule(
    key,
    label,
    category,
    'unknown',
    severity,
    basis,
    'Не удалось надёжно проверить.',
    'Проверь этот пункт вручную.',
    editUrl,
  );
}

function rule(
  key: string,
  label: string,
  category: ProfileAuditCategory,
  status: ProfileAuditStatus,
  severity: ProfileAuditSeverity,
  basis: ProfileAuditBasis,
  evidence: string,
  recommendation: string,
  editUrl: string,
): ProfileAuditItem {
  return { key, label, category, status, severity, basis, evidence, recommendation, editUrl };
}

function summarize(
  category: ProfileAuditCategory,
  items: ProfileAuditItem[],
): ProfileAuditCategorySummary {
  const categoryItems = items.filter((item) => item.category === category);
  const known = categoryItems.filter((item) => item.status !== 'unknown').length;
  const passed = categoryItems.filter((item) => item.status === 'pass').length;
  const unknown = categoryItems.length - known;
  return {
    key: category,
    label: CATEGORY_LABELS[category],
    total: categoryItems.length,
    known,
    passed,
    unknown,
    progress: known === 0 ? null : Math.round((passed / known) * 100),
  };
}

function termOverlap(left: string[], right: string[]): number {
  const rightSet = new Set(right.map(normalizeTerm).filter(Boolean));
  return new Set(left.map(normalizeTerm).filter(Boolean)).size === 0
    ? 0
    : [...new Set(left.map(normalizeTerm).filter(Boolean))].filter((term) => rightSet.has(term))
        .length;
}

function normalizeTerm(value: string): string {
  return value.trim().toLocaleLowerCase();
}
