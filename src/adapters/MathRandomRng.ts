import type { Rng } from '@lib/ports';

/** Real randomness for jitter/delays. Thin edge over Math.random (tests inject a fake Rng). */
export class MathRandomRng implements Rng {
  next(): number {
    return Math.random();
  }
}
