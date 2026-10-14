import type { KeyValueStore } from '@lib/ports';
import { bootstrapModuleState } from '@lib/modules/moduleState';

export interface InstalledEvent {
  addListener(listener: () => void): void;
}

/** Registers install/update module migration without coupling the lifecycle to chrome globals. */
export function registerModuleStateBootstrap(
  onInstalled: InstalledEvent,
  store: KeyValueStore,
  onError: (error: unknown) => void = (error) => {
    console.error('[Lodestar] Module storage bootstrap failed', error);
  },
): void {
  onInstalled.addListener(() => {
    void bootstrapModuleState(store).catch(onError);
  });
}
