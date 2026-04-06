import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const projectRoot = process.cwd();
const buildDir = path.join(projectRoot, 'build');
const iconsetDir = path.join(buildDir, 'icon.iconset');
const sourceIcon = path.join(projectRoot, 'public', 'dr-claw.png');

const macIconSizes = [
  16, 32, 64, 128, 256, 512, 1024,
];

const winIconSizes = [16, 24, 32, 48, 64, 128, 256];

await fs.promises.rm(iconsetDir, { recursive: true, force: true });
await fs.promises.mkdir(iconsetDir, { recursive: true });
await fs.promises.mkdir(buildDir, { recursive: true });

for (const size of macIconSizes) {
  const baseName = `icon_${size}x${size}`;
  const outputPath = path.join(iconsetDir, `${baseName}.png`);
  await sharp(sourceIcon).resize(size, size).png().toFile(outputPath);

  if (size <= 512) {
    const retinaPath = path.join(iconsetDir, `${baseName}@2x.png`);
    await sharp(sourceIcon).resize(size * 2, size * 2).png().toFile(retinaPath);
  }
}

await sharp(sourceIcon).resize(512, 512).png().toFile(path.join(buildDir, 'icon.png'));

const icoBuffer = await pngToIco(
  await Promise.all(
    winIconSizes.map(async (size) => sharp(sourceIcon).resize(size, size).png().toBuffer()),
  ),
);

await fs.promises.writeFile(path.join(buildDir, 'icon.ico'), icoBuffer);
