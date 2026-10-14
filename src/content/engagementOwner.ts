import { ownerCardPresent, waitForOwnerName, type WaitForOwnerNameOptions } from './readOwner';

export interface EngagementOwnerDependencies {
  required: boolean;
  shouldAbort(): boolean;
  waitOptions?: Omit<WaitForOwnerNameOptions, 'shouldAbort'>;
}

/** Starts likes even when the self-card is missing. Own posts are skipped only when the name is known. */
export async function runWithEngagementOwner(
  root: ParentNode,
  dependencies: EngagementOwnerDependencies,
  execute: (ownerName?: string) => Promise<void>,
): Promise<void> {
  if (!dependencies.required) {
    await execute(undefined);
    return;
  }
  if (!ownerCardPresent(root)) {
    if (dependencies.shouldAbort()) return;
    await execute(undefined);
    return;
  }
  const ownerName = await waitForOwnerName(root, {
    ...dependencies.waitOptions,
    shouldAbort: () => dependencies.shouldAbort(),
  });
  if (dependencies.shouldAbort()) return;
  await execute(ownerName ?? undefined);
}
