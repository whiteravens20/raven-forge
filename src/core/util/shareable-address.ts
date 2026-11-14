// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

/**
 * An address as it can be shown to somebody else — in the log, in a crash
 * report attached to a public issue.
 *
 * A pack's address is whatever its server handed out, and a private one can
 * carry what lets a player in: a token in the query, a name and a password
 * before the host. Those parts are replaced and the rest is kept, because which
 * server and which file is most of what a reader needs from an address. The
 * whole query goes, names and all: a bare `?abc123` is a token with no name.
 *
 * Anything that is not a web address is replaced entirely, since there is no
 * telling which part of it is the secret: `raven:hunter22` is an address to
 * `URL`, with the password for its path.
 */
export function shareableAddress(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return '<redacted>';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '<redacted>';
  const login = url.username || url.password ? '<redacted>@' : '';
  const query = url.search ? '?<redacted>' : '';
  const fragment = url.hash ? '#<redacted>' : '';
  return `${url.protocol}//${login}${url.host}${url.pathname}${query}${fragment}`;
}
