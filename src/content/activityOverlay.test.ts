import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  showActivity,
  hideActivity,
  clearActivity,
  setActivityLabel,
  countdownActivity,
  __resetActivity,
} from './activityOverlay';
import { pauseLabel } from '@lib/autopilot/statusLabels';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  __resetActivity();
});

describe('activityOverlay', () => {
  it('injects the overlay and turns it on when shown', () => {
    showActivity(document);
    const el = document.getElementById('lodestar-activity-overlay');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('data-on')).toBe('1');
  });

  it('turns off only when every activity span has ended (ref-counted)', () => {
    showActivity(document);
    showActivity(document);
    hideActivity(document);
    expect(document.getElementById('lodestar-activity-overlay')!.getAttribute('data-on')).toBe('1');
    hideActivity(document);
    expect(document.getElementById('lodestar-activity-overlay')!.getAttribute('data-on')).toBe('0');
  });

  it('force-clears leaked run spans and resets the next span balance', () => {
    showActivity(document, 'SEARCHING');
    showActivity(document, 'CONNECTING');
    showActivity(document, 'CONNECTING');

    clearActivity(document);

    expect(document.getElementById('lodestar-activity-overlay')!.getAttribute('data-on')).toBe('0');
    expect(document.getElementById('lodestar-activity-label')!.textContent).toBe('');

    showActivity(document, 'next run');
    hideActivity(document);
    expect(document.getElementById('lodestar-activity-overlay')!.getAttribute('data-on')).toBe('0');
  });

  it('injects a single overlay + style node and declares pointer-events:none (never blocks the user)', () => {
    showActivity(document);
    showActivity(document);
    expect(document.querySelectorAll('#lodestar-activity-overlay')).toHaveLength(1);
    expect(document.querySelectorAll('#lodestar-activity-style')).toHaveLength(1);
    expect(document.getElementById('lodestar-activity-style')!.textContent).toContain(
      'pointer-events: none',
    );
  });

  it('does not underflow the ref count below zero on an extra hide', () => {
    hideActivity(document);
    showActivity(document);
    expect(document.getElementById('lodestar-activity-overlay')!.getAttribute('data-on')).toBe('1');
  });

  it('shows the status label passed to showActivity', () => {
    showActivity(document, 'Сканирую ленту…');
    expect(document.getElementById('lodestar-activity-label')!.textContent).toBe('Сканирую ленту…');
  });

  it('updates the label via setActivityLabel while active', () => {
    showActivity(document);
    setActivityLabel('Пауза 22с');
    expect(document.getElementById('lodestar-activity-label')!.textContent).toBe('Пауза 22с');
  });

  it('clears the label when the overlay hides', () => {
    showActivity(document, 'Ставлю лайк…');
    hideActivity(document);
    expect(document.getElementById('lodestar-activity-label')!.textContent).toBe('');
  });

  it('adds the label child to a stale overlay left over from a prior build', () => {
    // Simulate a label-less overlay persisted in the page DOM across an extension reload.
    const stale = document.createElement('div');
    stale.id = 'lodestar-activity-overlay';
    document.body.appendChild(stale);
    showActivity(document, 'Сканирую ленту…');
    expect(document.getElementById('lodestar-activity-label')!.textContent).toBe('Сканирую ленту…');
  });

  it('countdownActivity ticks the pill down each second and resolves after the full duration', async () => {
    vi.useFakeTimers();
    try {
      showActivity(document);
      const label = () => document.getElementById('lodestar-activity-label')!.textContent;
      const done = countdownActivity(3000, pauseLabel);
      expect(label()).toBe('Пауза 3с'); // set immediately, not frozen on the initial value only
      await vi.advanceTimersByTimeAsync(1000);
      expect(label()).toBe('Пауза 2с');
      await vi.advanceTimersByTimeAsync(1000);
      expect(label()).toBe('Пауза 1с');
      let resolved = false;
      void done.then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(1000);
      await done;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('countdownActivity resolves immediately when shouldAbort returns true (STOP mid-pause)', async () => {
    vi.useFakeTimers();
    try {
      showActivity(document);
      const label = () => document.getElementById('lodestar-activity-label')!.textContent;
      let stopped = false;
      const done = countdownActivity(45000, pauseLabel, () => stopped);
      expect(label()).toBe('Пауза 45с');
      await vi.advanceTimersByTimeAsync(1000);
      expect(label()).toBe('Пауза 44с');
      stopped = true; // user pressed STOP
      let resolved = false;
      void done.then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(1000); // next tick sees abort → resolves
      expect(resolved).toBe(true);
      // advancing well past the original 45s deadline must NOT fire again (timer cleared)
      await vi.advanceTimersByTimeAsync(60000);
    } finally {
      vi.useRealTimers();
    }
  });
});
