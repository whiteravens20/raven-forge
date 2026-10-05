// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { vi, type Mock } from 'vitest';
import type { IpcResult } from '../../src/shared/ipc-types';

type Listener = (...args: unknown[]) => void;
type Call = Mock<(...args: unknown[]) => Promise<IpcResult<unknown>>>;

/**
 * A stand-in for the preload API, so a store can be loaded in Node.
 *
 * The stores are where the renderer decides what a result means — whether a
 * launch that came back had failed, whether a cancel stopped anything — and
 * that is logic with no pixels in it, so it can be pinned without a browser.
 * They read `window.ravenforge` once, while being imported, which is why this
 * is installed first and why each test imports its store afresh.
 *
 * Every method is a mock made the first time it is asked for, answering
 * `{ success: true }` until a test says otherwise. None is listed here, so a
 * channel added to the API needs nothing added to this.
 */
export function installRendererApi() {
  const listeners = new Map<string, Set<Listener>>();
  const calls = new Map<string, Call>();

  /** The mock behind `window.ravenforge.<group>.<method>`. */
  const call = (group: string, method: string): Call => {
    const key = `${group}.${method}`;
    let found = calls.get(key);
    if (!found) {
      found = vi.fn(async () => ({ success: true }));
      calls.set(key, found);
    }
    return found;
  };

  const on = (channel: string, listener: Listener) => {
    const subscribed = listeners.get(channel) ?? new Set<Listener>();
    subscribed.add(listener);
    listeners.set(channel, subscribed);
    return () => subscribed.delete(listener);
  };

  const api = new Proxy(
    {},
    {
      get: (_target, group: string) =>
        group === 'on'
          ? on
          : new Proxy({}, { get: (_methods, method: string) => call(group, method) }),
    },
  );
  vi.stubGlobal('window', { ravenforge: api });

  return {
    call,
    /** Deliver an event from the main process to whatever subscribed to it. */
    emit: (channel: string, ...args: unknown[]) => {
      for (const listener of listeners.get(channel) ?? []) listener(...args);
    },
  };
}
