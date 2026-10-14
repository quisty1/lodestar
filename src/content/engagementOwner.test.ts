import { describe, expect, it, vi } from 'vitest';
import { runWithEngagementOwner } from './engagementOwner';

describe('runWithEngagementOwner', () => {
  it('waits for the self-card identity before executing engagement', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div id="shareboxProfilePictureComponentRef">
        <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
      </div>`;
    const execute = vi.fn(async () => undefined);
    let waits = 0;

    await runWithEngagementOwner(
      root,
      {
        required: true,
        shouldAbort: () => false,
        waitOptions: {
          attempts: 2,
          wait: async () => {
            waits += 1;
            root
              .querySelector('a')!
              .insertAdjacentHTML(
                'beforeend',
                '<svg role="img" aria-label="Alex  Morgan "></svg>',
              );
          },
        },
      },
      execute,
    );

    expect(waits).toBe(1);
    expect(execute).toHaveBeenCalledExactlyOnceWith('Alex Morgan');
  });

  it('starts likes without an owner filter when the self-card never appears', async () => {
    const root = document.createElement('div');
    const execute = vi.fn(async () => undefined);
    const wait = vi.fn(async () => undefined);

    await runWithEngagementOwner(
      root,
      {
        required: true,
        shouldAbort: () => false,
        waitOptions: { attempts: 2, wait },
      },
      execute,
    );

    expect(wait).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('starts likes without a name when the self-card never exposes one', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div id="shareboxProfilePictureComponentRef">
        <a href="https://www.linkedin.com/in/example-owner/"><img alt="" /></a>
      </div>`;
    const execute = vi.fn(async () => undefined);

    await runWithEngagementOwner(
      root,
      {
        required: true,
        shouldAbort: () => false,
        waitOptions: { attempts: 2, wait: async () => undefined },
      },
      execute,
    );

    expect(execute).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('does not start likes after the run was cancelled', async () => {
    const root = document.createElement('div');
    const execute = vi.fn(async () => undefined);

    await runWithEngagementOwner(
      root,
      {
        required: true,
        shouldAbort: () => true,
        waitOptions: { attempts: 2, wait: async () => undefined },
      },
      execute,
    );

    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute when the run is cancelled after identity resolves', async () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div id="shareboxProfilePictureComponentRef">
        <a href="https://www.linkedin.com/in/example-owner/"><img alt="Alex Morgan" /></a>
      </div>`;
    const shouldAbort = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const execute = vi.fn(async () => undefined);

    await runWithEngagementOwner(
      root,
      {
        required: true,
        shouldAbort,
      },
      execute,
    );

    expect(execute).not.toHaveBeenCalled();
  });

  it('runs content-only work without waiting for an owner identity', async () => {
    const execute = vi.fn(async () => undefined);
    const wait = vi.fn(async () => undefined);

    await runWithEngagementOwner(
      document.createElement('div'),
      {
        required: false,
        shouldAbort: () => false,
        waitOptions: { wait },
      },
      execute,
    );

    expect(wait).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(undefined);
  });
});
