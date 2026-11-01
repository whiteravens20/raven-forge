// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

import { isNetworkFailure } from '../auth/auth-errors';

/**
 * Chromium's words for the same thing, from what goes through its network stack
 * and not through Node's: the updater, above all. They come as a message and
 * with no code to read.
 */
const CHROMIUM_NO_CONNECTION =
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE|CONNECTION_\w+|NETWORK_\w+|PROXY_\w+|TIMED_OUT|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION_\w+)/;

/** Whether what stopped something is that nothing could be reached. */
export function isConnectionFailure(err: unknown): boolean {
  if (isNetworkFailure(err)) return true;
  return err instanceof Error && CHROMIUM_NO_CONNECTION.test(err.message);
}
