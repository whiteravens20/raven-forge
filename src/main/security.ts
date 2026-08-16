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
 * `style-src` needs `unsafe-inline` because React sets inline styles;
 * `script-src` deliberately does not, so there is no `eval` and no inline
 * script. `img-src https:` is for mod icons
 * and news images, which come from wherever a project hosts them. Fonts are
 * `'self'` since the launcher serves its own.
 *
 * The dev server gets one directive relaxed — see `contentSecurityPolicy`.
 */
function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    // `@vitejs/plugin-react` serves its react-refresh preamble as an inline
    // module script, prepended *ahead* of the `<meta>` copy in index.html — so
    // this header is the only policy that sees it, and blocking it leaves
    // `npm run dev` on a black window with "can't detect preamble" in the
    // console. The relaxation is reachable only while VITE_DEV_SERVER_URL is
    // set, and only for documents the dev server itself served.
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
  ].join('; ');
}

export const CONTENT_SECURITY_POLICY = contentSecurityPolicy(false);

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

  const devPolicy = contentSecurityPolicy(true);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const fromDevServer = devServer ? details.url.startsWith(devServer) : false;
    if (!details.url.startsWith('file://') && !fromDevServer) {
      callback({});
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [fromDevServer ? devPolicy : CONTENT_SECURITY_POLICY],
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
