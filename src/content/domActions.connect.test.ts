// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { executeConnect } from './domActions';
import { HumanDelay } from '@lib/engagement/HumanDelay';

const delay = new HumanDelay({ next: () => 0 }); // zero waits in tests

/** Build a search card + a pre-rendered invite modal in the interop shadow root. */
function setup() {
  document.body.innerHTML = '';
  const a = document.createElement('a');
  a.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:123_connect');
  a.setAttribute('aria-label', 'Invite Test User to connect');
  document.body.appendChild(a);
  const host = document.createElement('div');
  host.id = 'interop-outlet';
  const sr = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  // Real LinkedIn JS opens the modal on click; jsdom can't, so attach the Send button
  // when the anchor is clicked (simulating the async modal render).
  a.addEventListener('click', () => {
    const send = document.createElement('button');
    send.setAttribute('aria-label', 'Send without a note');
    send.addEventListener('click', () => {
      send.remove();
    }); // sending closes the modal
    sr.appendChild(send);
  });
  return { sr };
}

describe('executeConnect (shadow-DOM boundary)', () => {
  it('clicks Connect, then Send without a note, and confirms the modal closed', async () => {
    setup();
    const res = await executeConnect(
      document,
      { memberId: '123', name: 'Test User' },
      delay,
      () => false,
    );
    expect(res).toEqual({ ok: true });
  });

  it('fails cleanly when the connect anchor is missing', async () => {
    document.body.innerHTML = '';
    const res = await executeConnect(document, { memberId: '999', name: 'X' }, delay, () => false);
    expect(res).toEqual({ ok: false, reason: 'connect_anchor_not_found' });
  });

  it('does not click a different member whose id only shares the requested prefix', async () => {
    document.body.innerHTML = '';
    const wrong = document.createElement('a');
    wrong.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:1234_connect');
    const click = vi.spyOn(wrong, 'click');
    document.body.appendChild(wrong);
    const host = document.createElement('div');
    host.id = 'interop-outlet';
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    wrong.addEventListener('click', () => {
      const send = document.createElement('button');
      send.setAttribute('aria-label', 'Send without a note');
      send.addEventListener('click', () => {
        send.remove();
      });
      shadow.appendChild(send);
    });

    await expect(
      executeConnect(document, { memberId: '123', name: 'Test User' }, delay, () => false),
    ).resolves.toEqual({ ok: false, reason: 'connect_anchor_not_found' });
    expect(click).not.toHaveBeenCalled();
  });

  it('uses a locale-independent structural hook for the irreversible modal send', async () => {
    document.body.innerHTML = '';
    const connect = document.createElement('a');
    connect.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:123_connect');
    document.body.appendChild(connect);
    const host = document.createElement('div');
    host.id = 'interop-outlet';
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    connect.addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      const send = document.createElement('button');
      send.setAttribute('data-view-name', 'send-invite-without-note');
      send.setAttribute('aria-label', 'Localized copy unavailable');
      send.addEventListener('click', () => {
        dialog.remove();
      });
      dialog.appendChild(send);
      shadow.appendChild(dialog);
    });

    await expect(
      executeConnect(document, { memberId: '123', name: 'Test User' }, delay, () => false),
    ).resolves.toEqual({ ok: true });
  });

  it('waits for an enabled replacement and never clicks the stale disabled send node', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '';
      const connect = document.createElement('a');
      connect.setAttribute(
        'componentkey',
        'ConnectButtonstate:invitation:urn:li:member:123_connect',
      );
      document.body.appendChild(connect);
      const host = document.createElement('div');
      host.id = 'interop-outlet';
      const shadow = host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);
      const disabled = document.createElement('button');
      disabled.disabled = true;
      disabled.setAttribute('data-view-name', 'send-invite-without-note');
      const disabledClick = vi.spyOn(disabled, 'click');
      const enabled = document.createElement('button');
      enabled.setAttribute('data-view-name', 'send-invite-without-note');
      const enabledClick = vi.spyOn(enabled, 'click');

      connect.addEventListener('click', () => {
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.appendChild(disabled);
        shadow.appendChild(dialog);
        setTimeout(() => {
          disabled.replaceWith(enabled);
        }, 150);
      });
      enabled.addEventListener('click', () => {
        connect.setAttribute(
          'componentkey',
          'ConnectButtonstate:invitation:urn:li:member:123_pending',
        );
        enabled.closest('[role="dialog"]')?.remove();
      });

      const result = executeConnect(
        document,
        { memberId: '123', name: 'Test User' },
        delay,
        () => false,
        async () => true,
      );
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ ok: true });
      expect(disabledClick).not.toHaveBeenCalled();
      expect(enabledClick).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a structural decoy outside the active invite dialog', async () => {
    document.body.innerHTML = '';
    const connect = document.createElement('a');
    connect.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:123_connect');
    document.body.appendChild(connect);
    const host = document.createElement('div');
    host.id = 'interop-outlet';
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    const decoy = document.createElement('button');
    decoy.setAttribute('data-view-name', 'send-invite-without-note');
    const decoyClick = vi.spyOn(decoy, 'click');
    shadow.appendChild(decoy);
    const realClick = vi.fn();
    connect.addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      const real = document.createElement('button');
      real.setAttribute('data-view-name', 'send-invite-without-note');
      real.addEventListener('click', () => {
        realClick();
        dialog.remove();
      });
      dialog.appendChild(real);
      shadow.appendChild(dialog);
    });

    await expect(
      executeConnect(document, { memberId: '123', name: 'Test User' }, delay, () => false),
    ).resolves.toEqual({ ok: true });
    expect(decoyClick).not.toHaveBeenCalled();
    expect(realClick).toHaveBeenCalledOnce();
  });

  it('fails closed when a wrapper-less exact-label fallback is ambiguous', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '';
      const connect = document.createElement('a');
      connect.setAttribute(
        'componentkey',
        'ConnectButtonstate:invitation:urn:li:member:123_connect',
      );
      document.body.appendChild(connect);
      const host = document.createElement('div');
      host.id = 'interop-outlet';
      const shadow = host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);
      const clicks = [vi.fn(), vi.fn()];
      connect.addEventListener('click', () => {
        clicks.forEach((click) => {
          const send = document.createElement('button');
          send.setAttribute('aria-label', 'Send without a note');
          send.addEventListener('click', click);
          shadow.appendChild(send);
        });
      });

      const result = executeConnect(
        document,
        { memberId: '123', name: 'Test User' },
        delay,
        () => false,
      );
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ ok: false, reason: 'send_button_not_found' });
      expect(clicks.every((click) => click.mock.calls.length === 0)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Same shadow-modal setup as `setup()`, but the Connect control is a `<button>` — the shape
 * PYMK (`/mynetwork/`) renders, vs. the `<a>` people-search uses. Tracks whether the invite
 * "Send without a note" button was actually clicked, not just that the modal appeared.
 */
function setupButtonControl(confirmsCandidate = true) {
  document.body.innerHTML = '';
  const button = document.createElement('button');
  button.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:42_connect');
  button.setAttribute('aria-label', 'Invite Test User to connect');
  document.body.appendChild(button);
  const host = document.createElement('div');
  host.id = 'interop-outlet';
  const sr = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  let sendClicked = false;
  let dismissed = false;
  const unrelatedDismiss = vi.fn();
  const unrelated = document.createElement('button');
  unrelated.setAttribute('aria-label', 'Dismiss');
  unrelated.addEventListener('click', unrelatedDismiss);
  sr.appendChild(unrelated);
  button.addEventListener('click', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const send = document.createElement('button');
    send.setAttribute('aria-label', 'Send without a note');
    send.addEventListener('click', () => {
      sendClicked = true;
      if (confirmsCandidate) {
        button.setAttribute(
          'componentkey',
          'ConnectButtonstate:invitation:urn:li:member:42_pending',
        );
      }
      send.remove(); // sending closes the modal
    });
    const dismiss = document.createElement('button');
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.addEventListener('click', () => {
      dismissed = true;
      dialog.remove();
    });
    dialog.append(send, dismiss);
    sr.appendChild(dialog);
  });
  return {
    wasSendClicked: () => sendClicked,
    wasDismissed: () => dismissed,
    unrelatedDismiss,
    shadow: sr,
  };
}

describe('executeConnect (PYMK button control)', () => {
  it('clicks a button Connect control, then Send without a note, and confirms the modal closed', async () => {
    const { wasSendClicked } = setupButtonControl();
    const res = await executeConnect(
      document,
      { memberId: '42', name: 'Test User' },
      delay,
      () => false,
    );
    expect(res).toEqual({ ok: true });
    expect(wasSendClicked()).toBe(true);
  });
});

describe('executeConnect cancellation', () => {
  it('does not click Send without a note when STOP arrives after the modal opens', async () => {
    vi.useFakeTimers();
    try {
      const { wasSendClicked, wasDismissed, unrelatedDismiss, shadow } = setupButtonControl();
      let cancelled = false;

      const result = executeConnect(
        document,
        { memberId: '42', name: 'Test User' },
        delay,
        () => cancelled,
      );
      await Promise.resolve();
      await Promise.resolve();

      cancelled = true;
      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' });
      expect(wasSendClicked()).toBe(false);
      expect(wasDismissed()).toBe(true);
      expect(unrelatedDismiss).not.toHaveBeenCalled();
      expect(shadow.querySelector('[aria-label="Send without a note"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an anchor opener reversible and never commits Send after STOP', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '';
      const anchor = document.createElement('a');
      anchor.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:77_connect');
      document.body.appendChild(anchor);
      const host = document.createElement('div');
      host.id = 'interop-outlet';
      const shadow = host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);
      let stopped = false;
      const sendClick = vi.fn();
      anchor.addEventListener('click', () => {
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        const send = document.createElement('button');
        send.setAttribute('aria-label', 'Send without a note');
        send.addEventListener('click', sendClick);
        const dismiss = document.createElement('button');
        dismiss.setAttribute('aria-label', 'Dismiss');
        dismiss.addEventListener('click', () => {
          dialog.remove();
        });
        dialog.append(send, dismiss);
        shadow.appendChild(dialog);
        stopped = true;
      });
      const commit = vi.fn(async () => true);

      const pending = executeConnect(
        document,
        { memberId: '77', name: 'Test User' },
        delay,
        () => stopped,
        commit,
      );
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toEqual({ ok: false, reason: 'cancelled' });
      expect(commit).not.toHaveBeenCalled();
      expect(sendClick).not.toHaveBeenCalled();
      expect(shadow.querySelector('[aria-label="Send without a note"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * PYMK (/mynetwork/) DIRECT-SEND flow (verified live 2026-07-14): clicking the Connect button
 * sends the invite immediately with NO "Send without a note" modal, and the control flips to
 * `…_pending`. executeConnect must detect that flip and report ok — else the send is real but
 * never recorded (ban-cap leak, re-invites, misreport).
 */
function setupDirectSend() {
  document.body.innerHTML = '';
  const button = document.createElement('button');
  button.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:55_connect');
  button.setAttribute('aria-label', 'Invite Test User to connect');
  document.body.appendChild(button);
  const host = document.createElement('div');
  host.id = 'interop-outlet';
  host.attachShadow({ mode: 'open' }); // present, but NO invite modal ever renders
  document.body.appendChild(host);
  // The click sends directly: the connect control is replaced by a Pending one, no modal.
  button.addEventListener('click', () => {
    button.setAttribute('componentkey', 'ConnectButtonstate:invitation:urn:li:member:55_pending');
    button.setAttribute('aria-label', 'Pending, click to withdraw invitation sent to Test User');
  });
}

describe('executeConnect (PYMK direct-send, no modal)', () => {
  it('reports ok when the click flips the control to Pending with no modal', async () => {
    setupDirectSend();
    const res = await executeConnect(
      document,
      { memberId: '55', name: 'Test User' },
      delay,
      () => false,
    );
    expect(res).toEqual({ ok: true });
  });

  it('does not touch the direct-send control when commit is rejected', async () => {
    setupDirectSend();
    const control = document.querySelector<HTMLElement>('[componentkey*="member:55_connect"]')!;
    const click = vi.fn();
    control.addEventListener('click', click);

    const res = await executeConnect(
      document,
      { memberId: '55', name: 'Test User' },
      delay,
      () => false,
      async () => false,
    );

    expect(res).toEqual({ ok: false, reason: 'commit_rejected' });
    expect(click).not.toHaveBeenCalled();
  });

  it('finishes modal send after STOP once the first click was committed', async () => {
    const { wasSendClicked } = setupButtonControl();
    let stopped = false;

    const res = await executeConnect(
      document,
      { memberId: '42', name: 'Test User' },
      delay,
      () => stopped,
      async () => {
        stopped = true;
        return true;
      },
    );

    expect(res).toEqual({ ok: true });
    expect(wasSendClicked()).toBe(true);
  });

  it('is uncertain when the modal closes without candidate-specific Pending state', async () => {
    vi.useFakeTimers();
    try {
      setupButtonControl(false);
      const unrelated = document.createElement('button');
      unrelated.setAttribute(
        'componentkey',
        'ConnectButtonstate:invitation:urn:li:member:999_pending',
      );
      document.body.appendChild(unrelated);

      const result = executeConnect(
        document,
        { memberId: '42', name: 'Test User' },
        delay,
        () => false,
        async () => true,
      );
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({
        ok: false,
        reason: 'connect_confirmation_timeout',
        uncertain: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
