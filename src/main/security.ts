import { session, type IpcMainInvokeEvent } from 'electron';
import { log } from './logger';
import { getMainWindow } from './window';

/**
 * The renderer's Content-Security-Policy.
 *
 * Kept identical to the `<meta http-equiv>` copy in `index.html`. Both are
 * enforced — a document under several policies must satisfy all of them — so
 * they must agree, or the intersection would be something neither file
 * describes.
 *
 * The header is the one that matters: a `<meta>` policy only takes effect from
 * the point in the document where it is parsed, so anything that manages to get
 * markup in ahead of it is unconstrained. Confirmed to apply to `file://`
 * documents on Electron 41, which is how the packaged renderer is loaded.
 *
 * `style-src` needs `unsafe-inline` because React sets inline styles and
 * framer-motion animates through them; `script-src` deliberately does not, so
 * there is no `eval` and no inline script. `img-src https:` is for mod icons
 * and news images, which come from wherever a project hosts them. Fonts are
 * `'self'` since the launcher serves its own.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https:",
  "connect-src 'self' https:",
].join('; ');

/**
 * Serve the CSP as a response header, for the launcher's own documents only.
 *
 * The scope matters. The Microsoft login window shares this session — it has to,
 * or the proxy settings would not apply to it — and it loads Microsoft's pages,
 * which this policy would break outright. So the header goes on what the
 * launcher itself serves and on nothing else.
 */
export function installContentSecurityPolicy(): void {
  const devServer = process.env.VITE_DEV_SERVER_URL;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const ours =
      details.url.startsWith('file://') || (devServer ? details.url.startsWith(devServer) : false);
    if (!ours) {
      callback({});
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
}

/**
 * Whether an IPC call came from the launcher's own page.
 *
 * Every handler is behind this. Nothing untrusted is loaded into the main
 * window today, so nothing is being kept out right now — the point is that a
 * handler written later cannot be the first one to have forgotten. `senderFrame`
 * rather than `sender`, because a subframe of the right WebContents is still
 * not the page these handlers answer to.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return false;
  const frame = event.senderFrame;
  return frame !== null && frame === win.webContents.mainFrame;
}

/** Thrown back to the renderer when a call did not come from the launcher's page. */
export function assertTrustedSender(event: IpcMainInvokeEvent, channel: string): void {
  if (isTrustedSender(event)) return;
  log.warn(`Refused an IPC call to ${channel} from an untrusted frame`);
  throw new Error('This call did not come from the launcher window');
}
