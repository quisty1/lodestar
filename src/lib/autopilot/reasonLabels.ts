import type { ModuleId } from '../types';

const MODULE_LABEL: Record<ModuleId, string> = {
  engagement: 'Лайки',
  smart_connect: 'Коннекты',
  content: 'Посты',
  profile_views: 'Просмотры',
};

// Machine reason code → short Russian hint shown in the run report. Keeps a zero-action
// run honest: the user sees WHY (disabled / empty search / not a publish day / …).
const REASON_LABEL: Record<string, string> = {
  disabled: 'модуль выключен',
  no_keywords: 'не задан поиск',
  budget: 'дневной лимит исчерпан',
  nav_failed: 'страница не открылась',
  empty_search: 'поиск без результатов',
  not_ready: 'страница не успела загрузиться',
  none_fresh: 'все уже обработаны',
  pool_pending: 'все в этом поиске уже приглашены — расширь ключи',
  pymk_dry: 'поиск исчерпан (расширь ключи), рекомендации LinkedIn тоже пусты — попробуй позже',
  pool_dry: 'свежих профилей меньше лимита',
  not_publish_day: 'сегодня не день публикации',
  no_approved_draft: 'нет одобренного черновика',
  account_unknown: 'аккаунт LinkedIn не определён',
  wrong_account: 'черновик другого аккаунта',
  needs_media: 'одобренный пост ждёт картинку или другое медиа',
  weekly_cap: 'недельный лимит исчерпан',
  uncertain: 'отправлено, но не подтверждено',
  error: 'ошибка шага',
};

export function moduleLabel(id: ModuleId): string {
  return MODULE_LABEL[id] ?? id;
}

/**
 * Human hint for a module's run outcome. Returns '' for a clean run (`done` or no reason)
 * so the UI shows just the count; otherwise the Russian explanation (falls back to the raw
 * code for an unknown reason, so a new code is visible rather than swallowed).
 */
export function reasonHint(reason: string | undefined): string {
  if (!reason || reason === 'done') return '';
  return REASON_LABEL[reason] ?? reason;
}
