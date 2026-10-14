import type { LodestarMessage } from '@lib/types';

export function send(message: LodestarMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepUntilCancelled(ms: number, shouldAbort: () => boolean): Promise<void> {
  if (shouldAbort()) return Promise.resolve();
  return new Promise((resolve) => {
    const abortPoll = setInterval(() => {
      if (!shouldAbort()) return;
      clearInterval(abortPoll);
      clearTimeout(done);
      resolve();
    }, 100);
    const done = setTimeout(() => {
      clearInterval(abortPoll);
      resolve();
    }, ms);
  });
}

export async function ask<T>(message: LodestarMessage): Promise<T | undefined> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return undefined;
  }
}
