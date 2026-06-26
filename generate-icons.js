import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function convertSVGtoPNG() {
  const svgPath = path.join(__dirname, 'public', 'favicon.svg');
  const sizes = [192, 512];

  for (const size of sizes) {
    const outputPath = path.join(__dirname, 'public', `favicon-${size}x${size}.png`);
    
    try {
      await sharp(svgPath)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated ${outputPath}`);
    } catch (error) {
      console.error(`✗ Error generating ${size}x${size}:`, error.message);
    }
  }
}

convertSVGtoPNG().catch(console.error);
