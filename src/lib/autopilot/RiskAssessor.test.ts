import { describe, it, expect } from 'vitest';
import { RiskAssessor } from './RiskAssessor';

describe('RiskAssessor', () => {
  const assessor = new RiskAssessor();

  it('is ok with no markers', () => {
    expect(assessor.classify([])).toBe('ok');
  });

  it('stops on any hard risk marker', () => {
    expect(assessor.classify(['captcha'])).toBe('stop');
    expect(assessor.classify(['challenge'])).toBe('stop');
    expect(assessor.classify(['http_429'])).toBe('stop');
    expect(assessor.classify(['moving_too_fast'])).toBe('stop');
  });
});
