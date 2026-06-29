import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { access, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sourceCandidates = [
  path.join(rootDir, '341007890_1169413207083095_7978995066125363840_n.jpg'),
  path.join(rootDir, 'public', 'favicon-512x512.png'),
  path.join(rootDir, 'public', 'favicon.png'),
  path.join(rootDir, 'public', 'favicon-192x192.png'),
];

const sizes = [16, 32, 48, 64, 180, 192, 256, 512];

const outputs = [
  ...sizes.map((size) => ({
    size,
    files: [path.join(rootDir, 'public', `favicon-${size}x${size}.png`)],
  })),
  {
    size: 512,
    files: [path.join(rootDir, 'public', 'favicon.png')],
  },
];

async function main() {
  let sourceImage = '';
  for (const candidate of sourceCandidates) {
    try {
      await access(candidate);
      sourceImage = candidate;
      break;
    } catch {
      // Try next candidate.
    }
  }

  if (!sourceImage) {
    throw new Error('No source image found for icon generation. Add the JPG logo or an existing favicon PNG in public/.');
  }

  console.log(`Using source image: ${sourceImage}`);

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

  console.log(`Generated ${path.join(rootDir, 'public', 'favicon.ico')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
