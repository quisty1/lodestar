import { SsiParser } from './SsiParser';
import { DomSelectorStrategy } from './strategies/DomSelectorStrategy';
import { TextScanStrategy } from './strategies/TextScanStrategy';
import type { Clock } from '../ports';

/**
 * Composition root for the SSI parser: wires the strategy order
 * (precise selectors first, resilient text-scan fallback).
 */
export function createSsiParser(clock: Clock): SsiParser {
  return new SsiParser([new DomSelectorStrategy(), new TextScanStrategy()], clock);
}
