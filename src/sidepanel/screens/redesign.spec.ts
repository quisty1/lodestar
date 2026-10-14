import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ModuleCard from '../components/ModuleCard.vue';
import SettingsScreen from './SettingsScreen.vue';
import ContentScreen from './ContentScreen.vue';
import ReportsScreen from './ReportsScreen.vue';
import InboxScreen from './InboxScreen.vue';
import ModulesScreen from './ModulesScreen.vue';
import { defaultModules } from '../composables/useModules';
import App from '../App.vue';
import { RUN_PAUSE_KEY, tomorrowKey } from '@lib/autopilot/runPause';

let memory: Map<string, unknown>;
let storageSet: ReturnType<typeof vi.fn>;
beforeEach(() => {
  memory = new Map();
  storageSet = vi.fn(async (items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) memory.set(key, value);
  });
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test',
      sendMessage: vi.fn(async () => ({})),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: memory.get(key) })),
        set: storageSet,
      },
    },
  });
});

describe('redesigned working flows', () => {
  it('disables settings writes until stored values are loaded', async () => {
    let release!: () => void;
    chrome.storage.local.get = vi.fn(
      () =>
        new Promise((done) => {
          release = () => {
            done({});
          };
        }),
    );
    const w = mount(SettingsScreen);
    expect(w.get('[data-testid="llm-save"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="llm-save"]').trigger('click');
    expect(storageSet).not.toHaveBeenCalled();
    release();
    w.unmount();
  });

  it('distinguishes pending content from an empty idea bank', async () => {
    chrome.storage.local.get = vi.fn(() => new Promise(() => {}));
    const w = mount(ContentScreen);
    expect(w.get('[role="status"]').text()).toContain('Загружаю');
    expect(w.find('.empty').exists()).toBe(false);
    w.unmount();
  });

  it('distinguishes pending history from an empty contact list', async () => {
    chrome.storage.local.get = vi.fn(() => new Promise(() => {}));
    const w = mount(ReportsScreen, { props: { reports: [] } });
    await w.get('[data-testid="subtab-contacts"]').trigger('click');
    expect(w.get('[role="status"]').text()).toContain('Загружаю');
    expect(w.find('.empty').exists()).toBe(false);
    w.unmount();
  });

  it('reports an inbox storage read failure without claiming no results', async () => {
    chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('read failed'));
    const w = mount(InboxScreen, { props: { pvHistory: [], pvIsReal: false } });
    await flushPromises();
    expect(w.get('[data-testid="inbox-error"]').text()).toContain('загрузить');
    expect(w.find('.empty').exists()).toBe(false);
    w.unmount();
  });

  it('offers an accessible switch and collapsible module parameters', async () => {
    const w = mount(ModuleCard, {
      props: {
        module: {
          id: 'engagement',
          enabled: true,
          available: true,
          dailyLimit: 35,
          automationLevel: 'auto_guardrails',
        },
        title: 'Лента',
        desc: 'Описание',
        limitLabel: 'Лайков в день',
      },
      slots: { default: '<p>Параметры ленты</p>' },
    });
    const toggle = w.get('[data-testid="toggle-engagement"]');
    expect(toggle.element.tagName).toBe('BUTTON');
    expect(toggle.attributes('role')).toBe('switch');
    expect(toggle.attributes('aria-checked')).toBe('true');
    await toggle.trigger('click');
    expect(w.emitted('toggle')).toHaveLength(1);
    expect(w.get('details').attributes('open')).toBeUndefined();
    expect(w.get('summary').text()).toContain('Параметры');
  });

  it('groups settings without losing edits when switching groups', async () => {
    const w = mount(SettingsScreen);
    await flushPromises();
    expect(w.findAll('[role="tab"]')).toHaveLength(4);
    await w.get('[data-testid="llm-key"]').setValue('local-key');
    await w.get('[data-testid="subtab-style"]').trigger('click');
    await w.get('[data-testid="exp-headline"]').setValue('Инженер');
    await w.get('[data-testid="subtab-connection"]').trigger('click');
    expect((w.get('[data-testid="llm-key"]').element as HTMLInputElement).value).toBe('local-key');
    await w.get('[data-testid="llm-save"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="save-ok"]').text()).toContain('Сохранено');
    expect(memory.get('content:settings')).toBeDefined();
  });

  it('does not announce a settings save before storage resolves', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((done) => {
      resolve = done;
    });
    storageSet.mockImplementation(() => gate);
    const w = mount(SettingsScreen);
    await flushPromises();
    await w.get('[data-testid="llm-save"]').trigger('click');
    expect(w.find('[data-testid="save-ok"]').exists()).toBe(false);
    expect(w.get('[data-testid="llm-save"]').attributes('disabled')).toBeDefined();
    // All parallel writes share one promise so the test observes every save.
    resolve();
    await flushPromises();
    expect(w.get('[data-testid="save-ok"]').text()).toBe('Сохранено');
    w.unmount();
  });

  it('prevents saving defaults after a settings read failure', async () => {
    chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('read failed'));
    const w = mount(SettingsScreen);
    await flushPromises();
    expect(w.get('[data-testid="llm-save"]').attributes('disabled')).toBeDefined();
    await w.get('[data-testid="llm-save"]').trigger('click');
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('waits for audience persistence before leaving automation', async () => {
    const w = mount(ModulesScreen, { props: { modules: defaultModules() } });
    await flushPromises();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    storageSet.mockImplementation(() => gate);
    await w.get('[data-testid="audience-keywords"]').setValue('Designer');
    await w.get('[data-testid="audience-keywords"]').trigger('change');
    expect(w.vm).toHaveProperty('beforeLeave');
    let left = false;
    const leaving = Reflect.get(w.vm, 'beforeLeave')().then((ok: boolean) => {
      left = ok;
    });
    await flushPromises();
    expect(left).toBe(false);
    expect(w.find('[data-testid="connect-saved"]').exists()).toBe(false);
    release();
    await leaving;
    await flushPromises();
    expect(left).toBe(true);
    expect(w.get('[data-testid="connect-saved"]').text()).toContain('сохранена');
  });

  it('opens a draft in an editor and keeps unsaved text after a failed exit', async () => {
    memory.set('content:drafts', [
      {
        id: 'one',
        ideaTopic: 'Тема',
        ideaAngle: 'Угол',
        text: 'Старый текст',
        createdAt: '2026-10-08T10:00:00Z',
        approved: false,
      },
    ]);
    const w = mount(ContentScreen);
    await flushPromises();
    await w.get('[data-testid="subtab-drafts"]').trigger('click');
    expect(w.find('textarea').exists()).toBe(false);
    await w.get('[data-testid="open-draft-one"]').trigger('click');
    await w.get('[data-testid="draft-text"]').setValue('Новая редакция');
    storageSet.mockRejectedValue(new Error('storage unavailable'));
    await w.get('[data-testid="close-editor"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="editor-error"]').text()).toContain('сохранить');
    expect((w.get('[data-testid="draft-text"]').element as HTMLTextAreaElement).value).toBe(
      'Новая редакция',
    );
    storageSet.mockImplementation(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) memory.set(key, value);
    });
    await w.get('[data-testid="close-editor"]').trigger('click');
    await flushPromises();
    expect(w.find('textarea').exists()).toBe(false);
    expect((memory.get('content:drafts') as { text: string }[])[0].text).toBe('Новая редакция');
  });

  it('makes history types selectable instead of one long screen', async () => {
    const w = mount(ReportsScreen, { props: { reports: [] } });
    await flushPromises();
    expect(w.findAll('[role="tab"]')).toHaveLength(4);
    await w.get('[data-testid="subtab-comments"]').trigger('click');
    expect(w.text()).toContain('Комментариев пока нет');
    expect(w.text()).not.toContain('Прогонов пока нет');
  });

  it('shows the incomplete inbox sample and its age when people are listed', async () => {
    memory.set('inbox:snapshot', {
      capturedAt: '2026-10-08T10:00:00.000Z',
      viewers: [{ id: '1', name: 'Ada', kind: 'viewed' }],
      viewersStatus: 'unknown',
      messages: [],
      messagesStatus: 'known',
      accepted: [],
      acceptedStatus: 'known',
    });
    const w = mount(InboxScreen, { props: { pvHistory: [], pvIsReal: false } });
    await flushPromises();
    expect(w.get('[data-testid="inbox-partial"]').text()).toContain('не предоставил');
    expect(w.get('[data-testid="inbox-age"]').text()).toContain('данные от');
    expect(w.text()).toContain('Ada');
    w.unmount();
  });

  it('shows the incomplete-sample banner for an empty unknown list', async () => {
    memory.set('inbox:snapshot', {
      capturedAt: '2026-10-08T10:00:00.000Z',
      viewers: [],
      viewersStatus: 'unknown',
      messages: [],
      messagesStatus: 'unknown',
      accepted: [],
      acceptedStatus: 'unknown',
    });
    const w = mount(InboxScreen, { props: { pvHistory: [], pvIsReal: false } });
    await flushPromises();
    expect(w.get('[data-testid="inbox-partial"]').text()).toContain('не предоставил');
    expect(w.get('[data-testid="inbox-age"]').text()).toContain('данные от');
    expect(w.text()).not.toContain('Имена посетителей');
    w.unmount();
  });

  it('keeps the editor open when main navigation cannot save, then retries', async () => {
    memory.set('content:drafts', [
      {
        id: 'one',
        ideaTopic: 'Тема',
        ideaAngle: 'Угол',
        text: 'Исходный',
        createdAt: '2026-10-08T10:00:00Z',
      },
    ]);
    const w = mount(App);
    await flushPromises();
    await w.get('[data-testid="nav-v-content"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="subtab-drafts"]').trigger('click');
    await w.get('[data-testid="open-draft-one"]').trigger('click');
    await w.get('[data-testid="draft-text"]').setValue('Новый текст');
    storageSet.mockRejectedValue(new Error('write failed'));
    await w.get('[data-testid="nav-v-inbox"]').trigger('click');
    await flushPromises();
    expect(w.find('#v-inbox').exists()).toBe(false);
    expect(w.get('[data-testid="editor-error"]').text()).toContain('сохранить');
    storageSet.mockImplementation(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) memory.set(key, value);
    });
    await w.get('[data-testid="nav-v-inbox"]').trigger('click');
    await flushPromises();
    expect(w.find('#v-inbox').exists()).toBe(true);
    await w.get('[data-testid="nav-v-content"]').trigger('click');
    await flushPromises();
    expect((w.get('[data-testid="draft-text"]').element as HTMLTextAreaElement).value).toBe(
      'Новый текст',
    );
    w.unmount();
  });

  it('refreshes the cached draft queue and publication allowance on return', async () => {
    const draft = {
      id: 'one',
      ideaTopic: 'Тема',
      ideaAngle: 'Угол',
      text: 'Исходный',
      createdAt: '2026-10-08T10:00:00Z',
    };
    memory.set('content:drafts', [draft]);
    memory.set('content:settings', { postsPerWeek: 2 });
    const w = mount(App);
    await flushPromises();
    await w.get('[data-testid="nav-v-content"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="subtab-drafts"]').trigger('click');
    await w.get('[data-testid="nav-v-inbox"]').trigger('click');
    await flushPromises();
    memory.set('content:drafts', [draft, { ...draft, id: 'two', ideaTopic: 'Новая тема' }]);
    memory.set('content:settings', { postsPerWeek: 6 });
    await w.get('[data-testid="nav-v-content"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="open-draft-two"]').exists()).toBe(true);
    expect(w.get('[data-testid="posts-left"]').text()).toContain('6');
    w.unmount();
  });

  it('retries an audience read without overwriting stored targeting defaults', async () => {
    memory.set('connect:settings', {
      searchKeywords: 'Designer',
      targetRegions: ['GE'],
      excludeKeywords: ['agency'],
      excludeIndia: false,
      pymkMode: 'search_only',
      notesPerMonth: 2,
    });
    chrome.storage.local.get = vi.fn(async (key: string) => {
      if (key === 'connect:settings') throw new Error('read failed');
      return { [key]: memory.get(key) };
    }) as unknown as typeof chrome.storage.local.get;
    const w = mount(ModulesScreen, { props: { modules: defaultModules() } });
    await flushPromises();
    expect(w.get('[data-testid="audience-keywords"]').attributes('disabled')).toBeDefined();
    chrome.storage.local.get = vi.fn(async (key: string) => ({
      [key]: memory.get(key),
    })) as unknown as typeof chrome.storage.local.get;
    await w.get('[data-testid="retry-audience"]').trigger('click');
    await flushPromises();
    expect((w.get('[data-testid="audience-keywords"]').element as HTMLInputElement).value).toBe(
      'Designer',
    );
    expect((memory.get('connect:settings') as { targetRegions: string[] }).targetRegions).toEqual([
      'GE',
    ]);
    expect(
      (memory.get('connect:settings') as { excludeKeywords: string[] }).excludeKeywords,
    ).toEqual(['agency']);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('retains the editor and reports failed draft regeneration transport', async () => {
    memory.set('content:drafts', [
      {
        id: 'one',
        ideaTopic: 'Тема',
        ideaAngle: 'Угол',
        text: 'Исходный',
        createdAt: '2026-10-08T10:00:00Z',
      },
    ]);
    const w = mount(ContentScreen);
    await flushPromises();
    await w.get('[data-testid="subtab-drafts"]').trigger('click');
    await w.get('[data-testid="open-draft-one"]').trigger('click');
    chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('transport failed'));
    const button = w.findAll('button').find((item) => item.text() === 'Создать новую версию')!;
    await button.trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="draft-text"]').exists()).toBe(true);
    expect(w.get('[data-testid="editor-error"]').text()).toContain('Не удалось');
    expect(memory.get('content:drafts') as { id: string }[]).toHaveLength(1);
  });

  it('updates an expired pause when returning to overview', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T09:00:00Z'));
    memory.set(RUN_PAUSE_KEY, tomorrowKey(new Date()));
    const w = mount(App);
    try {
      await flushPromises();
      expect(w.get('[data-testid="pause-until"]').text()).toBe('Снять паузу');
      await w.get('[data-testid="nav-v-inbox"]').trigger('click');
      await flushPromises();
      vi.setSystemTime(new Date('2026-10-10T09:00:00Z'));
      await w.get('[data-testid="nav-v-dash"]').trigger('click');
      await flushPromises();
      expect(w.get('[data-testid="pause-until"]').text()).toBe('Пауза до завтра');
    } finally {
      w.unmount();
      vi.useRealTimers();
    }
  });
});
