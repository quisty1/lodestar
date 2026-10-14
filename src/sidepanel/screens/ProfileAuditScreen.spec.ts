import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKER_PROTOCOL_VERSION, runtimeOk } from '@lib/runtimeProtocol';
import { profileAuditFixture } from '@lib/profile/profileAudit.test-fixture';
import ProfileAuditScreen from './ProfileAuditScreen.vue';

const result = profileAuditFixture({
  photo: { state: 'known', value: false },
  featured: { state: 'known', value: false },
});

function installChrome() {
  const memory = new Map<string, unknown>();
  const sendMessage = vi.fn(async (message: unknown) => {
    const type = (message as { type?: string }).type;
    if (type === 'PING') return { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION };
    if (type === 'START_PROFILE_AUDIT') {
      return runtimeOk({ requestId: (message as { requestId: string }).requestId, result });
    }
    return undefined;
  });
  (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome = {
    runtime: { id: 'test-extension', sendMessage },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: memory.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) memory.set(key, value);
        }),
      },
    },
  } as unknown as typeof chrome;
  return { sendMessage };
}

describe('ProfileAuditScreen', () => {
  beforeEach(() => installChrome());

  it('does not scan on open and starts only from its own explicit button', async () => {
    const { sendMessage } = installChrome();
    const wrapper = mount(ProfileAuditScreen);
    await flushPromises();

    expect(
      sendMessage.mock.calls.some(
        ([message]) => (message as { type?: string }).type === 'START_PROFILE_AUDIT',
      ),
    ).toBe(false);
    expect(wrapper.get('[data-testid="start-profile-audit"]').text()).toContain('Запустить аудит');

    await wrapper.get('[data-testid="start-profile-audit"]').trigger('click');
    await flushPromises();

    expect(
      sendMessage.mock.calls.some(
        ([message]) => (message as { type?: string }).type === 'START_PROFILE_AUDIT',
      ),
    ).toBe(true);
  });

  it('renders priority groups, category progress, timestamp and repeat action', async () => {
    const wrapper = mount(ProfileAuditScreen);
    await flushPromises();
    await wrapper.get('[data-testid="start-profile-audit"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="audit-categories"]').text()).toContain('Заполненность');
    expect(wrapper.get('[data-testid="audit-fail"]').text()).toContain('Фото профиля');
    expect(wrapper.get('[data-testid="audit-warn"]').text()).toContain('Избранное');
    expect(wrapper.get('[data-testid="audit-pass"]')).toBeDefined();
    expect(wrapper.get('[data-testid="audit-unknown"]').text()).toContain('Индустрия');
    expect(wrapper.get('[data-testid="start-profile-audit"]').text()).toContain('Повторить аудит');
    expect(wrapper.text()).toMatch(/Проверено:/);
  });
});
