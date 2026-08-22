import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * Which frame an IPC call is allowed to come from.
 *
 * Every handler sits behind this, and nothing untrusted is loaded into the main
 * window today — so nothing is being kept out right now. That is the point: the
 * guard is in one place so a handler written later cannot be the first one to
 * have forgotten it, and the rule is the *main frame*, because a subframe of
 * the right WebContents is still not the page these handlers answer to.
 */

const mainFrame = { name: 'main' };
let win: { isDestroyed: () => boolean; webContents: { mainFrame: unknown } } | null;
const warnings: string[] = [];

vi.mock('../src/main/window', () => ({ getMainWindow: () => win }));
vi.mock('../src/main/logger', () => ({
  log: {
    warn: (msg: string) => warnings.push(msg),
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

const { assertTrustedSender } = await import('../src/main/security');

const eventFrom = (frame: unknown) => ({ senderFrame: frame }) as unknown as IpcMainInvokeEvent;

beforeEach(() => {
  warnings.length = 0;
  win = { isDestroyed: () => false, webContents: { mainFrame } };
});

describe('assertTrustedSender', () => {
  it('lets the launcher page itself through', () => {
    expect(() => assertTrustedSender(eventFrom(mainFrame), 'profiles:list')).not.toThrow();
  });

  it('refuses a subframe of the same window', () => {
    // An iframe in the launcher page is a different frame, and a handler that
    // deletes a profile should not answer one.
    expect(() => assertTrustedSender(eventFrom({ name: 'iframe' }), 'profiles:delete')).toThrow(
      /did not come from the launcher window/,
    );
  });

  it('refuses a call whose frame has already gone', () => {
    expect(() => assertTrustedSender(eventFrom(null), 'profiles:delete')).toThrow();
  });

  it('refuses everything once the window is destroyed', () => {
    win = { isDestroyed: () => true, webContents: { mainFrame } };
    expect(() => assertTrustedSender(eventFrom(mainFrame), 'profiles:list')).toThrow();
  });

  it('refuses everything when there is no window at all', () => {
    win = null;
    expect(() => assertTrustedSender(eventFrom(mainFrame), 'profiles:list')).toThrow();
  });

  it('records which channel it refused, so the log names the attempt', () => {
    expect(() => assertTrustedSender(eventFrom(null), 'game:launch')).toThrow();
    expect(warnings.join('\n')).toContain('game:launch');
  });
});
