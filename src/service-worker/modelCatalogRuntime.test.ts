import { describe, expect, it, vi } from 'vitest';
import { FALLBACK_MODELS } from '@lib/llm/models';
import { registerModelCatalogRuntime } from './modelCatalogRuntime';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

function setup(
  handler = vi.fn(async () => ({
    models: [{ id: 'openai/gpt-4o-mini' }],
    source: 'live' as const,
    keyStatus: 'valid' as const,
  })),
) {
  let listener: Listener | undefined;
  registerModelCatalogRuntime(
    {
      addListener: (next) => {
        listener = next;
      },
    },
    handler,
  );
  return { listener: listener!, handler };
}

describe('registered model catalog runtime boundary', () => {
  it('keeps the channel open and returns the typed handler result exactly once', async () => {
    const { listener, handler } = setup();
    const sendResponse = vi.fn();

    expect(
      listener(
        { type: 'LIST_MODELS', provider: 'openrouter', apiKey: 'sk-live' },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledOnce();
    });

    expect(handler).toHaveBeenCalledWith('openrouter', 'sk-live');
    expect(sendResponse).toHaveBeenCalledWith({
      models: [{ id: 'openai/gpt-4o-mini' }],
      source: 'live',
      keyStatus: 'valid',
    });
  });

  it('turns a handler rejection into an unknown fallback result', async () => {
    const { listener } = setup(
      vi.fn(async () => {
        throw new Error('worker failure');
      }),
    );
    const sendResponse = vi.fn();

    expect(
      listener({ type: 'LIST_MODELS', provider: 'gemini', apiKey: 'AIza' }, {}, sendResponse),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledOnce();
    });

    expect(sendResponse).toHaveBeenCalledWith({
      models: FALLBACK_MODELS.gemini,
      source: 'fallback',
      keyStatus: 'unknown',
      reason: 'runtime_error',
    });
  });

  it('rejects malformed messages synchronously without calling the handler', () => {
    const { listener, handler } = setup();
    const sendResponse = vi.fn();

    expect(
      listener({ type: 'LIST_MODELS', provider: 'unknown', apiKey: 7 }, {}, sendResponse),
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
