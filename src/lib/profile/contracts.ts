import { isSupportedLinkedInUrl } from '@lib/linkedin/urls';

export const PROFILE_AUDIT_SCHEMA_VERSION = 1 as const;
export const PROFILE_AUDIT_CATEGORIES = [
  'completeness',
  'discoverability',
  'consistency',
  'evidence',
] as const;
export const PROFILE_AUDIT_STATUSES = ['pass', 'warn', 'fail', 'unknown'] as const;
export const PROFILE_AUDIT_SEVERITIES = ['high', 'medium', 'low'] as const;
export const PROFILE_AUDIT_BASES = ['linkedin', 'recruiter-search', 'best-practice'] as const;

export type ProfileAuditCategory = (typeof PROFILE_AUDIT_CATEGORIES)[number];
export type ProfileAuditStatus = (typeof PROFILE_AUDIT_STATUSES)[number];
export type ProfileAuditSeverity = (typeof PROFILE_AUDIT_SEVERITIES)[number];
export type ProfileAuditBasis = (typeof PROFILE_AUDIT_BASES)[number];

export type Observation<T> = { state: 'known'; value: T } | { state: 'unknown' };

export interface HeadlineObservation {
  present: boolean;
  length: number;
  terms: string[];
}

export interface AboutObservation {
  present: boolean;
  length: number;
}

export interface CurrentPositionObservation {
  present: boolean;
  titleTerms: string[];
}

export interface ExperienceObservation {
  total: number;
  past: number;
  described: number;
  quantified: number;
}

export interface SkillsObservation {
  count: number;
  terms: string[];
}

export interface OpenToWorkObservation {
  enabled: boolean;
  titleTerms: string[];
}

/** Normalized, transient read of the signed-in user's profile. No HTML or long copy. */
export interface ProfileSnapshot {
  capturedAt: string;
  profileUrl: string;
  photo: Observation<boolean>;
  banner: Observation<boolean>;
  headline: Observation<HeadlineObservation>;
  about: Observation<AboutObservation>;
  location: Observation<boolean>;
  industry: Observation<boolean>;
  currentPosition: Observation<CurrentPositionObservation>;
  educationCount: Observation<number>;
  experience: Observation<ExperienceObservation>;
  skills: Observation<SkillsObservation>;
  recommendations: Observation<boolean>;
  featured: Observation<boolean>;
  projects: Observation<boolean>;
  publicUrl: Observation<boolean>;
  openToWork: Observation<OpenToWorkObservation>;
  searchAppearances: Observation<number>;
}

export interface ProfileAuditItem {
  key: string;
  label: string;
  category: ProfileAuditCategory;
  status: ProfileAuditStatus;
  severity: ProfileAuditSeverity;
  basis: ProfileAuditBasis;
  evidence: string;
  recommendation: string;
  editUrl: string;
}

export interface ProfileAuditCategorySummary {
  key: ProfileAuditCategory;
  label: string;
  total: number;
  known: number;
  passed: number;
  unknown: number;
  /** Pass share among known checks; null means the category could not be checked. */
  progress: number | null;
}

export interface ProfileAuditResult {
  schemaVersion: typeof PROFILE_AUDIT_SCHEMA_VERSION;
  auditedAt: string;
  items: ProfileAuditItem[];
  categories: ProfileAuditCategorySummary[];
  metrics: { searchAppearances?: number };
}

export function isProfileSnapshot(value: unknown): value is ProfileSnapshot {
  if (
    !isRecord(value) ||
    !isTimestamp(value.capturedAt) ||
    !isSupportedLinkedInUrl(value.profileUrl as string)
  )
    return false;
  return (
    isObservation(value.photo, isBoolean) &&
    isObservation(value.banner, isBoolean) &&
    isObservation(value.headline, isHeadline) &&
    isObservation(value.about, isAbout) &&
    isObservation(value.location, isBoolean) &&
    isObservation(value.industry, isBoolean) &&
    isObservation(value.currentPosition, isCurrentPosition) &&
    isObservation(value.educationCount, isCount) &&
    isObservation(value.experience, isExperience) &&
    isObservation(value.skills, isSkills) &&
    isObservation(value.recommendations, isBoolean) &&
    isObservation(value.featured, isBoolean) &&
    isObservation(value.projects, isBoolean) &&
    isObservation(value.publicUrl, isBoolean) &&
    isObservation(value.openToWork, isOpenToWork) &&
    isObservation(value.searchAppearances, isCount)
  );
}

export function isProfileAuditResult(value: unknown): value is ProfileAuditResult {
  if (
    !isRecord(value) ||
    value.schemaVersion !== PROFILE_AUDIT_SCHEMA_VERSION ||
    !isTimestamp(value.auditedAt)
  )
    return false;
  const items = value.items;
  if (!Array.isArray(items) || !items.every(isAuditItem)) return false;
  const auditItems = items;
  if (new Set(auditItems.map((item) => item.key)).size !== auditItems.length) return false;
  const categories = value.categories;
  if (!Array.isArray(categories) || categories.length !== PROFILE_AUDIT_CATEGORIES.length)
    return false;
  if (!categories.every(isCategorySummary)) return false;
  const summaries = categories;
  const categoryKeys = new Set(summaries.map((category) => category.key));
  if (!PROFILE_AUDIT_CATEGORIES.every((category) => categoryKeys.has(category))) return false;
  if (!summaries.every((category) => summaryMatchesItems(category, auditItems))) return false;
  if (!isRecord(value.metrics)) return false;
  return value.metrics.searchAppearances === undefined || isCount(value.metrics.searchAppearances);
}

function isAuditItem(value: unknown): value is ProfileAuditItem {
  if (!isRecord(value)) return false;
  return (
    nonEmpty(value.key) &&
    nonEmpty(value.label) &&
    PROFILE_AUDIT_CATEGORIES.includes(value.category as ProfileAuditCategory) &&
    PROFILE_AUDIT_STATUSES.includes(value.status as ProfileAuditStatus) &&
    PROFILE_AUDIT_SEVERITIES.includes(value.severity as ProfileAuditSeverity) &&
    PROFILE_AUDIT_BASES.includes(value.basis as ProfileAuditBasis) &&
    typeof value.evidence === 'string' &&
    nonEmpty(value.recommendation) &&
    typeof value.editUrl === 'string' &&
    isSupportedLinkedInUrl(value.editUrl)
  );
}

function isCategorySummary(value: unknown): value is ProfileAuditCategorySummary {
  if (!isRecord(value) || !PROFILE_AUDIT_CATEGORIES.includes(value.key as ProfileAuditCategory))
    return false;
  if (!(
    nonEmpty(value.label) &&
    isCount(value.total) &&
    isCount(value.known) &&
    isCount(value.passed) &&
    isCount(value.unknown) &&
    (value.progress === null || isPercent(value.progress))
  ))
    return false;
  if (value.known + value.unknown !== value.total || value.passed > value.known) return false;
  const expected = value.known === 0 ? null : Math.round((value.passed / value.known) * 100);
  return value.progress === expected;
}

function summaryMatchesItems(
  summary: ProfileAuditCategorySummary,
  items: ProfileAuditItem[],
): boolean {
  const matching = items.filter((item) => item.category === summary.key);
  const known = matching.filter((item) => item.status !== 'unknown').length;
  return (
    summary.total === matching.length &&
    summary.known === known &&
    summary.passed === matching.filter((item) => item.status === 'pass').length &&
    summary.unknown === matching.length - known
  );
}

function isObservation<T>(
  value: unknown,
  validate: (input: unknown) => input is T,
): value is Observation<T> {
  return (
    isRecord(value) &&
    (value.state === 'unknown' || (value.state === 'known' && validate(value.value)))
  );
}

function isHeadline(value: unknown): value is HeadlineObservation {
  return (
    isRecord(value) && isBoolean(value.present) && isCount(value.length) && isTerms(value.terms)
  );
}

function isAbout(value: unknown): value is AboutObservation {
  return isRecord(value) && isBoolean(value.present) && isCount(value.length);
}

function isCurrentPosition(value: unknown): value is CurrentPositionObservation {
  return isRecord(value) && isBoolean(value.present) && isTerms(value.titleTerms);
}

function isExperience(value: unknown): value is ExperienceObservation {
  return (
    isRecord(value) &&
    ['total', 'past', 'described', 'quantified'].every((key) => isCount(value[key]))
  );
}

function isSkills(value: unknown): value is SkillsObservation {
  return isRecord(value) && isCount(value.count) && isTerms(value.terms);
}

function isOpenToWork(value: unknown): value is OpenToWorkObservation {
  return isRecord(value) && isBoolean(value.enabled) && isTerms(value.titleTerms);
}

function isTerms(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((term) => nonEmpty(term) && term.length <= 80);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}
function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function isPercent(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 100;
}
function isTimestamp(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
