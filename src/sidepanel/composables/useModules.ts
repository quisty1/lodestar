import { ref, onMounted } from 'vue';
import type { ModuleId, ModuleState } from '@lib/types';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { MODULES_STATE_KEY, bootstrapModuleState, defaultModules } from '@lib/modules/moduleState';
import { panelBus } from '../lib/panelBus';

export { defaultModules } from '@lib/modules/moduleState';

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/** Owns module enable + per-module daily limit with persistence. SRP: module config. */
export function useModules() {
  const modules = ref<ModuleState[]>(defaultModules());
  const store = new ChromeStorageStore();
  let queueTail = Promise.resolve();
  let initialized = !panelBus.available();
  let bootstrapFailure: unknown = null;
  let writeFailure: unknown = null;
  let dirty = false;

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = queueTail.then(operation);
    // Keep later operations runnable, while the caller still receives this
    // operation's rejection and can surface it.
    queueTail = result.catch(() => {});
    return result;
  };

  const bootstrap = (): Promise<void> =>
    enqueue(async () => {
      try {
        modules.value = await bootstrapModuleState(store);
        initialized = true;
        bootstrapFailure = null;
      } catch (error) {
        initialized = false;
        bootstrapFailure = error;
        throw toError(error, 'Module settings failed');
      }
    });

  onMounted(() => {
    if (!panelBus.available()) return;
    void bootstrap().catch((error: unknown) => {
      console.error('[Lodestar] Failed to load module settings', error);
    });
  });

  const find = (id: ModuleId) => modules.value.find((m) => m.id === id);

  const persist = (): Promise<void> =>
    panelBus.available()
      ? store.set(
          MODULES_STATE_KEY,
          modules.value.map((module) => ({ ...module })),
        )
      : Promise.resolve();

  const saveCurrent = async (): Promise<void> => {
    try {
      await persist();
      dirty = false;
      writeFailure = null;
    } catch (error) {
      writeFailure = error;
      throw toError(error, 'Module settings failed');
    }
  };

  const assertInitialized = (): void => {
    if (!initialized) throw toError(bootstrapFailure, 'Module settings are not loaded');
  };

  const toggle = (id: ModuleId): Promise<void> =>
    enqueue(async () => {
      assertInitialized();
      const module = find(id);
      if (!module || !module.available) return;
      module.enabled = !module.enabled;
      dirty = true;
      await saveCurrent();
    });

  const setLimit = (id: ModuleId, n: number): Promise<void> =>
    enqueue(async () => {
      assertInitialized();
      const module = find(id);
      if (!module) return;
      module.dailyLimit = Math.max(0, Math.round(n));
      dirty = true;
      await saveCurrent();
    });

  /** Barrier for consumers that must observe every bootstrap/config write. */
  const flush = async (): Promise<void> => {
    await queueTail;

    if (bootstrapFailure !== null) {
      const error = bootstrapFailure;
      bootstrapFailure = null;
      throw toError(error, 'Module settings failed');
    }
    if (!initialized) {
      try {
        await bootstrap();
      } catch (error) {
        bootstrapFailure = null; // this foreground attempt already surfaced it
        throw toError(error, 'Module settings failed');
      }
    }

    await queueTail;
    if (writeFailure !== null) {
      const error = writeFailure;
      writeFailure = null;
      throw toError(error, 'Module settings failed');
    }
    if (dirty) {
      try {
        await enqueue(saveCurrent);
      } catch (error) {
        writeFailure = null; // this foreground attempt already surfaced it
        throw toError(error, 'Module settings failed');
      }
    }
  };

  return { modules, toggle, setLimit, flush };
}
