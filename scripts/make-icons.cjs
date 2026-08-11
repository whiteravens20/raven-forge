/**
 * Rasterise assets/icons/icon.svg into the bitmaps electron-builder needs.
 *
 * Run with Electron, not node: `npm run icons`. There is no image toolchain on
 * the build machines, but Electron already ships a browser engine, so it is the
 * rasteriser — an offscreen window renders the SVG once at 1024 and `nativeImage`
 * downscales from there, which is sharper than re-rendering per size.
 *
 * CommonJS on purpose: Electron 41 does not execute a `.mjs` entry point — the
 * module is silently never run, with no error and no output.
 *
 * Outputs:
 *   assets/icons/icon.png          — 512×512, used by the Linux targets
 *   assets/icons/icon.ico          — 16/24/32/48/64/128/256, used by NSIS
 *   build/installer-sidebar.bmp    — 164×314, the NSIS welcome panel
 */
const { app, BrowserWindow } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const SOURCE = path.join(root, 'assets', 'icons', 'icon.svg');
const RENDER_SIZE = 1024;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Pack PNGs into an .ico. Every entry is a full PNG rather than a BMP —
 * Windows has accepted that since Vista and it keeps the alpha channel without
 * the AND-mask dance the old BMP form requires.
 */
function buildIco(pngs) {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = HEADER + ENTRY * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(ENTRY);
    // 256 is stored as 0 — the field is a single byte.
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/**
 * Encode a NativeImage as a 24-bit BMP. NSIS will not take a PNG for the
 * welcome panel, and `nativeImage` cannot emit BMP — but `toBitmap()` hands
 * back raw BGRA, and BMP is just a header in front of bottom-up BGR rows, so
 * the conversion is a few lines rather than an image dependency.
 */
function toBmp(image) {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  const rowSize = Math.ceil((width * 3) / 4) * 4; // rows are 4-byte aligned
  const pixels = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    // BMP rows run bottom-to-top.
    const src = (height - 1 - y) * width * 4;
    let dst = y * rowSize;
    for (let x = 0; x < width; x++) {
      pixels[dst++] = bgra[src + x * 4]; // B
      pixels[dst++] = bgra[src + x * 4 + 1]; // G
      pixels[dst++] = bgra[src + x * 4 + 2]; // R
    }
  }

  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + pixels.length, 2); // file size
  header.writeUInt32LE(54, 10); // pixel data offset
  header.writeUInt32LE(40, 14); // DIB header size
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26); // planes
  header.writeUInt16LE(24, 28); // bits per pixel
  header.writeUInt32LE(pixels.length, 34); // image size
  header.writeInt32LE(2835, 38); // 72 DPI horizontal
  header.writeInt32LE(2835, 42); // 72 DPI vertical

  return Buffer.concat([header, pixels]);
}

/** Render arbitrary HTML offscreen at a fixed size and hand back the frame. */
async function render(html, width, height) {
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  // Take the frame from the offscreen compositor's own `paint` event rather
  // than `capturePage()`: on a window that is never shown, capturePage has
  // nothing to resolve against and simply hangs.
  const painted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no paint event within 30s')), 30_000);
    win.webContents.on('paint', (_event, _dirty, image) => {
      if (image.isEmpty()) return;
      clearTimeout(timer);
      resolve(image);
    });
  });

  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  const frame = await painted;
  const sized =
    frame.getSize().width === width ? frame : frame.resize({ width, height, quality: 'best' });
  win.destroy();
  return sized;
}

async function main() {
  const svg = await readFile(SOURCE, 'utf8');
  const page = `<!doctype html><html><body style="margin:0;background:transparent">
<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"
     style="width:${RENDER_SIZE}px;height:${RENDER_SIZE}px;display:block">
</body></html>`;

  const shot = await render(page, RENDER_SIZE, RENDER_SIZE);

  const master =
    shot.getSize().width === RENDER_SIZE
      ? shot
      : shot.resize({ width: RENDER_SIZE, height: RENDER_SIZE, quality: 'best' });

  const pngPath = path.join(root, 'assets', 'icons', 'icon.png');
  await writeFile(pngPath, master.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  console.log(`[make-icons] wrote ${path.relative(root, pngPath)} (512x512)`);

  const pngs = ICO_SIZES.map((size) => ({
    size,
    data: master.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));
  const icoPath = path.join(root, 'assets', 'icons', 'icon.ico');
  await writeFile(icoPath, buildIco(pngs));
  console.log(`[make-icons] wrote ${path.relative(root, icoPath)} (${ICO_SIZES.join(', ')})`);

  // NSIS welcome panel: brand gradient with the mark centred in the upper half,
  // which is where the installer's own text does not sit.
  const sidebar = `<!doctype html><html><body style="margin:0;width:164px;height:314px;
background:linear-gradient(160deg,#2b1a55 0%,#170f2e 55%,#0d0916 100%);
display:flex;align-items:flex-start;justify-content:center;padding-top:56px;box-sizing:border-box">
<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="width:104px;height:104px">
</body></html>`;
  const sidebarImage = await render(sidebar, 164, 314);
  const bmpPath = path.join(root, 'build', 'installer-sidebar.bmp');
  await writeFile(bmpPath, toBmp(sidebarImage));
  console.log(`[make-icons] wrote ${path.relative(root, bmpPath)} (164x314, 24-bit)`);
}

// `render()` destroys each window when it is done, which on Linux would leave
// zero windows open and let the default `window-all-closed` handler quit the
// app mid-run — silently, taking the buffered output with it.
app.on('window-all-closed', () => {});

app
  .whenReady()
  .then(main)
  .then(
    () => app.exit(0),
    (err) => {
      console.error(`[make-icons] ${err.message}`);
      app.exit(1);
    },
  );
