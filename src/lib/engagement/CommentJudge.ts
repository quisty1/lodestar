import type { Guardrails } from '../types';

export interface JudgeVerdict {
  ok: boolean;
  /** Machine-readable violation codes; empty when ok. */
  reasons: string[];
}

/**
 * Quality gate for a generated comment in auto_guardrails mode:
 * length range, banned phrases, and a confidence floor. Pure — confidence is an
 * input (produced upstream by an LLM judge / the generator), so this decision unit
 * is deterministic and reports *all* violations at once.
 */
export class CommentJudge {
  judge(comment: string, guardrails: Guardrails, confidence?: number): JudgeVerdict {
    const reasons: string[] = [];

    const length = comment.trim().length;
    const [min, max] = guardrails.lenRange;
    if (length < min) reasons.push('too_short');
    if (length > max) reasons.push('too_long');

    const lower = comment.toLowerCase();
    const hasBanned = guardrails.bannedPhrases.some(
      (p) => p.length > 0 && lower.includes(p.toLowerCase()),
    );
    if (hasBanned) reasons.push('banned_phrase');

    if (confidence !== undefined && confidence < guardrails.minConfidence) {
      reasons.push('low_confidence');
    }

    return { ok: reasons.length === 0, reasons };
  }
}
