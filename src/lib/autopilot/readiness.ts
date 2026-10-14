export interface ReadinessInput {
  modulesOn: boolean;
  hasKeywords: boolean;
  hasExpertise: boolean;
  llmRequired: boolean;
  hasLlmKey: boolean;
  linkedInTab: boolean | null;
  paused: boolean;
}

export interface ReadinessItem {
  id: string;
  ok: boolean;
  label: string;
}

/** What must be true before «Запустить» does useful work. Unknown tab is not a failure. */
export function readinessItems(input: ReadinessInput): ReadinessItem[] {
  const items: ReadinessItem[] = [
    { id: 'modules', ok: input.modulesOn, label: 'Включён хотя бы один модуль' },
    { id: 'keywords', ok: input.hasKeywords, label: 'Задано, кого искать' },
    { id: 'expertise', ok: input.hasExpertise, label: 'Заполнена экспертиза для текстов' },
    {
      id: 'linkedin',
      ok: input.linkedInTab !== false,
      label:
        input.linkedInTab === null ? 'Вкладка LinkedIn не проверена' : 'Открыта вкладка LinkedIn',
    },
  ];
  if (input.llmRequired) {
    items.push({ id: 'llm', ok: input.hasLlmKey, label: 'LLM-ключ для комментариев и постов' });
  }
  if (input.paused) {
    items.push({ id: 'paused', ok: false, label: 'Пауза до завтра — запуск закрыт' });
  }
  return items;
}
