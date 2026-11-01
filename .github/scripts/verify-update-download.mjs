// Copyright (C) 2026 White Ravens. AGPL-3.0-only with an additional term; see LICENSE and NOTICE.

// The launcher's own update, on the packaged build, from a feed kept here.
//
// electron-updater downloads by a different road on each platform, and what is
// left of a cancelled download depends on what the system does with a file that
// is still open. So a copy of the build is used the way a player uses it: the
// question at a start, on and off; the download started, cancelled, started
// again at once, cut off by the server, and finished, with the bytes checked.
// The copy has the inspector's fuse put back, which is how it is driven. A button
// is pressed only where it is really on top, since a script's click goes through
// anything drawn over it.
//
//   node .github/scripts/verify-update-download.mjs <the unpacked build> <where to leave what was seen>
//
// Exit codes: 0 everything was as it should be, 1 something was not, 2 the check
// itself could not be made.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses');

const [unpacked, evidence] = process.argv.slice(2);
if (!unpacked || !evidence) {
  console.error(
    'usage: verify-update-download.mjs <the unpacked build> <where to leave what was seen>',
  );
  process.exit(2);
}

const WINDOWS = process.platform === 'win32';
const PROGRAM = WINDOWS ? 'Raven Forge Launcher.exe' : 'raven-forge-launcher';
const FEED_FILE = WINDOWS ? 'latest.yml' : 'latest-linux.yml';
const UPDATE_FILE = WINDOWS
  ? 'Raven-Forge-Launcher-Setup-99.0.0.exe'
  : 'Raven-Forge-Launcher-99.0.0.AppImage';
/** One a launcher: what is left of the last one can hold its port for a moment. */
let inspectorPort = 9339;
const SLOW = 2 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let misses = 0;
function expect(held, what, otherwise = '') {
  if (held) {
    console.log(`  ok    ${what}`);
  } else {
    misses += 1;
    console.log(`::error::${what}${otherwise ? `: ${otherwise}` : ''}`);
  }
}

// ── The feed ──────────────────────────────────────────────────────────────────

function startFeed() {
  const update = crypto.randomBytes(30 * 1024 * 1024);
  const sha512 = crypto.createHash('sha512').update(update).digest('base64');
  const info = [
    'version: 99.0.0',
    'files:',
    `  - url: ${UPDATE_FILE}`,
    `    sha512: ${sha512}`,
    `    size: ${update.length}`,
    `path: ${UPDATE_FILE}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-01-01T00:00:00.000Z'",
    '',
  ].join('\n');

  const feed = { update, asked: 0, bytesPerSecond: SLOW, cutAfter: 0, server: null };
  feed.server = http.createServer((req, res) => {
    const name = path.posix.basename(new URL(req.url, 'http://feed').pathname);
    if (name === FEED_FILE) {
      feed.asked += 1;
      res.end(info);
      return;
    }
    if (name !== UPDATE_FILE) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.writeHead(200, { 'content-length': update.length });
    const cutAfter = feed.cutAfter;
    feed.cutAfter = 0;
    let sent = 0;
    const pump = () => {
      if (res.destroyed) return;
      if (cutAfter && sent >= cutAfter) {
        req.socket.destroy();
        return;
      }
      if (sent >= update.length) {
        res.end();
        return;
      }
      const piece = update.subarray(sent, sent + 64 * 1024);
      sent += piece.length;
      const next = () => setTimeout(pump, (piece.length / feed.bytesPerSecond) * 1000);
      if (res.write(piece)) next();
      else res.once('drain', next);
    };
    pump();
  });
  return new Promise((resolve) => feed.server.listen(0, '127.0.0.1', () => resolve(feed)));
}

// ── The launcher ──────────────────────────────────────────────────────────────

/** Its main process through the inspector, and the page through that. */
async function inspect(child, port) {
  let target;
  const end = Date.now() + 90000;
  while (!target) {
    if (child.exitCode !== null) throw new Error(`the launcher ended with ${child.exitCode}`);
    if (Date.now() > end)
      throw new Error('the launcher is running and its inspector never answered');
    // With a time limit of its own: what a crashed launcher leaves behind can
    // hold the port open with nobody answering, and on Windows a port nobody
    // holds takes two seconds to say so.
    target = await fetch(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => r.json())
      .then((list) => list[0])
      .catch(() => undefined);
    if (!target) await sleep(200);
  }
  console.log('  ...   its inspector answers');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('its inspector refused the connection'));
  });
  let id = 0;
  const waiting = new Map();
  socket.onmessage = (message) => {
    const answer = JSON.parse(message.data);
    waiting.get(answer.id)?.(answer);
    waiting.delete(answer.id);
  };
  const main = (expression) =>
    new Promise((resolve, reject) => {
      id += 1;
      const asked = id;
      // A launcher stopped on a dialog of its own answers nothing, for ever.
      const limit = setTimeout(() => {
        waiting.delete(asked);
        reject(new Error(`its main process did not answer: ${expression.slice(0, 60)}`));
      }, 30000);
      waiting.set(asked, ({ result }) => {
        clearTimeout(limit);
        if (result?.exceptionDetails) {
          reject(new Error(result.exceptionDetails.exception?.description ?? 'it threw'));
        } else {
          resolve(result?.result?.value);
        }
      });
      socket.send(
        JSON.stringify({
          id: asked,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
            includeCommandLineAPI: true,
          },
        }),
      );
    });
  const window = `require('electron').BrowserWindow.getAllWindows()[0]`;
  const page = (code) =>
    main(`${window}.webContents.executeJavaScript(${JSON.stringify(code)}, true)`);
  const text = () => page('document.body.innerText');
  const waitFor = async (what, seen, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) {
      const now = await text();
      if (seen(now)) return now;
      if (Date.now() > end)
        throw new Error(`no ${what} after ${ms} ms; the page ends: ${now.slice(-300)}`);
      await sleep(150);
    }
  };
  const press = (within, label) =>
    page(`(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(`${within} button`)})]
        .find((b) => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled);
      if (!button) return 'there is no such button';
      button.scrollIntoView({ block: 'center' });
      const box = button.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (top !== button && !button.contains(top)) {
        return 'something is drawn over it: ' + (top ? top.outerHTML.slice(0, 200) : 'nothing there');
      }
      button.click();
      return 'pressed';
    })()`);
  const shot = (name) =>
    main(`(() => {
      const fs = require('fs');
      return ${window}.webContents.capturePage().then((image) => {
        fs.writeFileSync(${JSON.stringify(path.join(evidence, `${name}.png`))}, image.toPNG());
        return true;
      });
    })()`);
  const windowEnd = Date.now() + 60000;
  while (
    !(await main(`(() => { const w = ${window}; return !!w && !w.webContents.isLoading(); })()`))
  ) {
    if (Date.now() > windowEnd) throw new Error('its window never finished loading');
    await sleep(200);
  }
  console.log('  ...   its window is up');
  return { page, text, waitFor, press, shot, close: () => socket.close() };
}

/** Runs the copy over a home of its own, and hands the test the page. */
async function withLauncher(program, home, settings, test) {
  const data = path.join(home, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      language: 'en',
      launcherBehaviorOnLaunch: 'keep-open',
      downloadConcurrency: 4,
      newsFeedUrl: '',
      announcementFeedUrl: '',
      trustedPublicKeys: [],
      showLiveConsole: false,
      discordRichPresence: false,
      offlineMode: false,
      allowUnverifiedLoaderInstaller: false,
      ...settings,
    }),
  );
  const env = {
    ...process.env,
    RAVENFORGE_DATA_DIR: data,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'roaming'),
    LOCALAPPDATA: path.join(home, 'cache'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'share'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DBUS_SESSION_BUS_ADDRESS;
  if (!WINDOWS) {
    env.APPIMAGE = path.join(home, 'the-running.AppImage');
    fs.writeFileSync(env.APPIMAGE, '');
  }
  inspectorPort += 1;
  const args = [`--inspect=127.0.0.1:${inspectorPort}`, ...(WINDOWS ? [] : ['--no-sandbox'])];
  const name = path.basename(home);
  const said = fs.openSync(path.join(evidence, `${name}-stderr.log`), 'w');
  const child = spawn(program, args, { env, stdio: ['ignore', said, said] });
  const exited = new Promise((resolve) => child.once('exit', resolve));

  let launcher;
  try {
    launcher = await inspect(child, inspectorPort);
    await test(launcher);
  } catch (err) {
    saveTheScreen(name);
    throw err;
  } finally {
    // Not a quit: an update that has finished downloading is installed by one,
    // and this one is random bytes.
    launcher?.close();
    child.kill('SIGKILL');
    await Promise.race([exited, sleep(10000)]);
    fs.closeSync(said);
    const log = path.join(data, 'logs', 'main.log');
    if (fs.existsSync(log)) fs.copyFileSync(log, path.join(evidence, `${name}.log`));
  }
}

/** What was on the screen when it went wrong: a dialog says more than a timeout. */
function saveTheScreen(name) {
  if (!WINDOWS) return;
  const file = path.join(evidence, `${name}-screen.png`);
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
    '$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$image = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height',
    '$drawing = [System.Drawing.Graphics]::FromImage($image)',
    '$drawing.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)',
    `$image.Save('${file}')`,
  ].join('; ');
  spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 30000 });
}

// ── What is checked ───────────────────────────────────────────────────────────

const percentOf = (page) => Number(/Downloading(?: update)?… (\d+)%/.exec(page)?.[1] ?? -1);
const isDownloading = (page) => percentOf(page) >= 0;

const pendingFiles = (home) => {
  const pending = path.join(home, 'cache', 'raven-forge-launcher-updater', 'pending');
  return fs.existsSync(pending) ? fs.readdirSync(pending) : [];
};

/** It may be a moment coming: until the settings arrive, the page is in the system's language. */
async function pressing(launcher, within, label, what) {
  const end = Date.now() + 5000;
  let outcome = await launcher.press(within, label);
  while (outcome === 'there is no such button' && Date.now() < end) {
    await sleep(100);
    outcome = await launcher.press(within, label);
  }
  expect(outcome === 'pressed', what, outcome);
}

async function theQuestionSwitchedOff(program, home, feed) {
  console.log('With the question at a start switched off');
  await withLauncher(program, home, { checkUpdatesOnStart: false }, async (launcher) => {
    await sleep(6000);
    expect(feed.asked === 0, 'the feed is not asked', `asked ${feed.asked} times`);
    expect(!(await launcher.text()).includes('99.0.0'), 'and no update is announced');
    await launcher.page(`location.hash = '#/settings'; 1`);
    await sleep(800);
    await pressing(launcher, 'main', 'Check for updates', '"Check for updates" can be pressed');
    await launcher.waitFor('announcement', (page) => page.includes('99.0.0'));
    expect(feed.asked === 1, 'and asks the feed, once', `asked ${feed.asked} times`);
  });
}

async function theDownload(program, home, feed) {
  console.log('With the question at a start switched on');
  await withLauncher(program, home, {}, async (launcher) => {
    await launcher.waitFor('announcement', (page) => page.includes('99.0.0'));
    expect(feed.asked > 0, 'the feed is asked, and the update announced');

    console.log('Cancelling the download');
    await pressing(launcher, '[role=status]', 'Download', '"Download" can be pressed');
    await launcher.waitFor('progress', (page) => percentOf(page) >= 10);
    await launcher.shot('downloading');
    await pressing(launcher, '[role=status]', 'Cancel', '"Cancel" can be pressed');
    const after = await launcher.waitFor(
      'end of the download',
      (page) => !isDownloading(page),
      10000,
    );
    expect(!after.includes('failed'), 'a cancelled download is not reported as a failure');
    await sleep(1000);
    const left = pendingFiles(home).filter((name) => name.startsWith('temp-'));
    expect(left.length === 0, 'nothing is left of it', left.join(', '));
    await launcher.shot('after-the-cancel');

    console.log('Starting it again at once, and having the server cut it off');
    feed.cutAfter = 4 * 1024 * 1024;
    await pressing(launcher, '[role=status]', 'Download', '"Download" can be pressed again');
    const cut = await launcher.waitFor(
      'failure',
      (page) => !isDownloading(page) && page.includes('failed'),
      60000,
    );
    expect(
      cut.includes('Downloading the update failed'),
      'a download that is cut off is a failure',
    );
    await launcher.shot('after-the-cut');

    console.log('And to the end');
    feed.bytesPerSecond = 200 * 1024 * 1024;
    await pressing(launcher, '[role=status]', 'Download', '"Download" can be pressed after that');
    await launcher.waitFor('finished download', (page) => page.includes('Update ready'), 60000);
    await launcher.shot('ready');
    const pendingDir = path.join(home, 'cache', 'raven-forge-launcher-updater', 'pending');
    const whole = fs.readFileSync(path.join(pendingDir, UPDATE_FILE));
    expect(whole.equals(feed.update), 'what arrived is what was served');
    const others = pendingFiles(home).filter((name) => name.startsWith('temp-'));
    expect(others.length === 0, 'and no partial file is beside it', others.join(', '));
  });
}

// ── The run ───────────────────────────────────────────────────────────────────

fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-update-'));
const copy = path.join(scratch, 'build');
let feed;
try {
  fs.cpSync(unpacked, copy, { recursive: true, verbatimSymlinks: true });
  const program = path.join(copy, PROGRAM);
  await flipFuses(program, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableNodeCliInspectArguments]: true,
  });
  feed = await startFeed();
  fs.writeFileSync(
    path.join(copy, 'resources', 'app-update.yml'),
    `provider: generic\nurl: http://127.0.0.1:${feed.server.address().port}\nupdaterCacheDirName: raven-forge-launcher-updater\n`,
  );

  await theQuestionSwitchedOff(program, path.join(scratch, 'switched-off'), feed);
  feed.asked = 0;
  await theDownload(program, path.join(scratch, 'download'), feed);
} catch (err) {
  console.log(`::error::the check stopped: ${err instanceof Error ? err.message : String(err)}`);
  misses += 1;
} finally {
  feed?.server.close();
  feed?.server.closeAllConnections();
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
if (misses > 0) process.exit(1);
console.log('The update did what it should.');
