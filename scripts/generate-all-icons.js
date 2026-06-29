import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sourceImage = path.join(rootDir, '341007890_1169413207083095_7978995066125363840_n.jpg');

const sizes = [16, 32, 48, 64, 180, 192, 256, 512];

const outputs = [
  ...sizes.map((size) => ({
    size,
    files: [
      path.join(rootDir, 'public', `favicon-${size}x${size}.png`),
      path.join(rootDir, `favicon-${size}x${size}.png`),
    ],
  })),
  {
    size: 512,
    files: [
      path.join(rootDir, 'public', 'favicon.png'),
      path.join(rootDir, 'favicon.png'),
    ],
  },
];

async function main() {
  for (const output of outputs) {
    const buffer = await sharp(sourceImage)
      .resize(output.size, output.size, {
        fit: 'cover',
        position: 'center',
      })
      .png()
      .toBuffer();

    for (const file of output.files) {
      await sharp(buffer).toFile(file);
      console.log(`Generated ${file}`);
    }
  }

  const icoSource = path.join(rootDir, 'public', 'favicon-48x48.png');
  const icoBuffer = await pngToIco(icoSource);

  await writeFile(path.join(rootDir, 'public', 'favicon.ico'), icoBuffer);
  await writeFile(path.join(rootDir, 'favicon.ico'), icoBuffer);

  console.log(`Generated ${path.join(rootDir, 'public', 'favicon.ico')}`);
  console.log(`Generated ${path.join(rootDir, 'favicon.ico')}`);

  // Keep SVG reference filename alive by generating a PNG and writing to .svg path is invalid,
  // so we don't touch favicon.svg here; HTML/config will point to PNG files.
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
