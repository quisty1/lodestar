export interface StorageAccessLevelApi {
  setAccessLevel(options: {
    accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS';
  }): Promise<void>;
}

/** Content scripts can read chrome.storage.local unless the extension opts into trusted contexts only. */
export async function restrictStorageToTrustedContexts(
  local: StorageAccessLevelApi,
): Promise<void> {
  await local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
