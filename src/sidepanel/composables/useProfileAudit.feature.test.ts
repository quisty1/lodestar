import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ChromeStorageStore } from '../../adapters/ChromeStorageStore';
import { readProfile } from '../../content/readProfile';
import { registerProfileAuditContentRuntime } from '../../content/profileAuditRuntime';
import { ProfileAuditRepository } from '@lib/profile/ProfileAuditRepository';
import { WORKER_PROTOCOL_VERSION } from '@lib/runtimeProtocol';
import {
  registerProfileAuditRuntime,
  runProfileAudit,
} from '../../service-worker/profileAuditRuntime';
import ProfileAuditScreen from '../screens/ProfileAuditScreen.vue';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

describe('profile audit production boundary', () => {
  it('runs only after the explicit UI action and stores no raw profile copy', async () => {
    const workerListeners: Listener[] = [];
    const contentListeners: Listener[] = [];
    const memory = new Map<string, unknown>();
    const profileUrl = 'https://www.linkedin.com/in/example/?isSelfProfile=true';
    const document = profileDocument('PRIVATE ABOUT COPY 12345');
    const store = new ChromeStorageStore();
    const repository = new ProfileAuditRepository(store);
    const start = vi.fn((requestId: string) =>
      runProfileAudit(requestId, {
        prepare: async () => ({ ok: true, tabId: 7, profileUrl }),
        read: (_tabId, id) =>
          dispatch(contentListeners, { type: 'READ_PROFILE_AUDIT', requestId: id }),
        save: (result) => repository.save(result),
        now: () => new Date('2026-08-15T12:01:00.000Z'),
      }),
    );

    registerProfileAuditContentRuntime(
      { addListener: (listener) => contentListeners.push(listener) },
      { read: async () => readProfile(document, profileUrl, '2026-08-15T12:00:00.000Z') },
    );
    registerProfileAuditRuntime(
      { addListener: (listener) => workerListeners.push(listener) },
      { start },
    );
    installChrome(memory, async (message) => {
      if ((message as { type?: string }).type === 'PING') {
        return { type: 'PONG', protocolVersion: WORKER_PROTOCOL_VERSION };
      }
      return dispatch(workerListeners, message);
    });

    const wrapper = mount(ProfileAuditScreen);
    await flushPromises();

    expect(start).not.toHaveBeenCalled();
    expect(memory.has('profileAudit:lastResult')).toBe(false);

    await wrapper.get('[data-testid="start-profile-audit"]').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="audit-categories"]').text()).toContain('Заполненность');
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(await repository.latest()).not.toBeNull();
    expect(JSON.stringify(memory.get('profileAudit:lastResult'))).not.toContain(
      'PRIVATE ABOUT COPY 12345',
    );
    wrapper.unmount();
  });
});

function installChrome(
  memory: Map<string, unknown>,
  sendMessage: (message: unknown) => Promise<unknown>,
): void {
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
}

async function dispatch(listeners: Listener[], message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    for (const listener of listeners) {
      try {
        if (listener(message, {}, resolve)) return;
      } catch (error) {
        reject(error instanceof Error ? error : new Error('listener failed'));
        return;
      }
    }
    resolve(undefined);
  });
}

function profileDocument(about: string): Document {
  return new DOMParser().parseFromString(
    `
    <main>
      <section>
        <a href="/edit/intro/">Edit intro</a>
        <img componentkey="topcard-logo-image-referencekey" alt="Example profile photo">
        <button componentkey="example_cover_edit_button">Edit cover</button>
        <svg aria-label="Profile background banner"></svg>
        <div><h2>Example Person</h2><p>Senior Frontend Developer Vue TypeScript</p><p>Example company</p><div><p>Chisinau</p></div></div>
        <a href="/opportunities/job-opportunities/edit/">Open to Work</a>
      </section>
      <section>
        <a href="/edit/forms/summary/">Edit About</a>
        <div data-testid="expandable-text-box">${about}</div>
      </section>
      <section>
        <a componentkey="profile_experience_top_anchor_example" href="/details/experience/">Experience</a>
        <div componentkey="entity-collection-item-1">Jan 2020 - Present
          <a href="/edit/forms/position/"><p>Frontend Lead</p></a>
          <div data-testid="expandable-text-box">Raised conversion by 20 percent.</div>
        </div>
      </section>
      <section><a componentkey="profile_education_top_anchor_example" href="/details/education/">Education</a>
        <a href="/details/education/edit/forms/1">School</a></section>
      <section><a componentkey="profile_skills_top_anchor_example" href="/details/skills/">Skills (12)</a>
        <div componentkey="profile.skill.vue"><p>Vue TypeScript</p></div></section>
      <a href="/details/recommendations/">Recommendations</a>
      <a href="/details/featured/">Featured</a>
      <a href="/details/projects/">Projects</a>
      <aside componentkey="SupportedLocales"></aside>
      <a href="/analytics/search-appearances">10 search appearances</a>
    </main>
  `,
    'text/html',
  );
}
