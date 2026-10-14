import { describe, expect, it } from 'vitest';
import {
  runtimeError,
  runtimeOk,
  type RuntimeResult,
  type StartAutopilotResponse,
} from './runtimeProtocol';

describe('runtimeProtocol', () => {
  it('builds discriminated success and error envelopes', () => {
    expect(runtimeOk({ value: 1 })).toEqual({ ok: true, data: { value: 1 } });
    expect(runtimeError('transport-error', 'worker slept', true)).toEqual({
      ok: false,
      error: { code: 'transport-error', message: 'worker slept', retryable: true },
    });
  });

  it('narrows a typed start response without nullable transport ambiguity', () => {
    const response: StartAutopilotResponse = runtimeError('already-running', 'Already active');
    const read = (result: RuntimeResult<{ runId: string }>) =>
      result.ok ? result.data.runId : result.error.code;

    expect(read(response)).toBe('already-running');
  });
});
