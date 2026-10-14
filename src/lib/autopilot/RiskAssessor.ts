export type RiskMarker = 'captcha' | 'challenge' | 'http_429' | 'moving_too_fast';

/**
 * Classifies reported risk markers into a go/stop verdict (kill-switch). Any hard marker → stop. Pure. Marker detection itself is the
 * content script's job; this only judges.
 */
export class RiskAssessor {
  classify(markers: RiskMarker[]): 'ok' | 'stop' {
    return markers.length > 0 ? 'stop' : 'ok';
  }
}
