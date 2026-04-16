import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const projectRoot = process.cwd();
const buildDir = path.join(projectRoot, 'build');
const iconsetDir = path.join(buildDir, 'icon.iconset');
const sourceIcon = path.join(projectRoot, 'public', 'dr-claw.png');
const isMac = process.platform === 'darwin';

// iconutil requires exactly these base sizes — each gets a @2x retina variant.
// 512@2x = 1024x1024, which is the largest size in the .iconset.
const macIconSizes = [16, 32, 128, 256, 512];
const winIconSizes = [16, 24, 32, 48, 64, 128, 256];

// macOS squircle corner radius ≈ 22.37% of icon size (Apple HIG continuous curve).
const MAC_CORNER_RATIO = 0.2237;

/**
 * Create a rounded-rectangle (squircle) mask as an SVG buffer.
 * When composited with `dest-in`, the source image is clipped to this shape.
 */
function squircleMask(size) {
  const r = Math.round(size * MAC_CORNER_RATIO);
  return Buffer.from(
    `<svg width="${size}" height="${size}">` +
    `<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/>` +
    `</svg>`,
  );
}

await fs.promises.rm(iconsetDir, { recursive: true, force: true });
await fs.promises.mkdir(iconsetDir, { recursive: true });
await fs.promises.mkdir(buildDir, { recursive: true });

// --- macOS .iconset (raw squares — macOS applies its own mask to .icns) -------
for (const size of macIconSizes) {
  const baseName = `icon_${size}x${size}`;
  await sharp(sourceIcon).resize(size, size).png().toFile(path.join(iconsetDir, `${baseName}.png`));
  await sharp(sourceIcon).resize(size * 2, size * 2).png().toFile(path.join(iconsetDir, `${baseName}@2x.png`));
}

// --- macOS .icns via iconutil (macOS only) ------------------------------------
if (isMac) {
  const icnsPath = path.join(buildDir, 'icon.icns');
  try {
    execFileSync('iconutil', ['--convert', 'icns', iconsetDir, '--output', icnsPath]);
  } catch (err) {
    console.warn('iconutil failed (non-macOS host?) — skipping .icns generation:', err.message);
  }
}

// --- Generic icon.png for BrowserWindow (Windows/Linux taskbar) ---------------
await sharp(sourceIcon).resize(512, 512).png().toFile(path.join(buildDir, 'icon.png'));

// --- macOS dock icon with squircle corners (used by app.dock.setIcon) ---------
// Native macOS icons have ~18% padding around the artwork inside the dock tile.
// We resize the artwork to ~82% of the canvas and center it on a transparent
// background so the icon matches the visual weight of Finder, Safari, etc.
const dockCanvas = 512;
const dockArtwork = Math.round(dockCanvas * 0.82);
const dockOffset = Math.round((dockCanvas - dockArtwork) / 2);

const artwork = await sharp(sourceIcon).resize(dockArtwork, dockArtwork).png().toBuffer();
const maskedArtwork = await sharp(artwork)
  .composite([{ input: squircleMask(dockArtwork), blend: 'dest-in' }])
  .png()
  .toBuffer();

await sharp({
  create: { width: dockCanvas, height: dockCanvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: maskedArtwork, left: dockOffset, top: dockOffset }])
  .png()
  .toFile(path.join(buildDir, 'icon-dock.png'));

// --- Windows .ico -------------------------------------------------------------
const icoBuffer = await pngToIco(
  await Promise.all(
    winIconSizes.map(async (size) => sharp(sourceIcon).resize(size, size).png().toBuffer()),
  ),
);
await fs.promises.writeFile(path.join(buildDir, 'icon.ico'), icoBuffer);

console.log('Electron icons built → build/{icon.png, icon-dock.png, icon.ico, icon.icns, icon.iconset/}');
