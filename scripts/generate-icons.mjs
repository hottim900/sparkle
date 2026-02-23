/**
 * Generate minimal valid PNG icon files for PWA.
 * Creates a dark background (#0f172a) with the letter "C" for "Capture Hub".
 * Uses raw binary PNG generation without external dependencies.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "public", "icons");

mkdirSync(iconsDir, { recursive: true });

function crc32(buf) {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, typeBytes, data, crcVal]);
}

function generatePNG(size) {
  // Background color: #0f172a (dark slate)
  const bgR = 0x0f, bgG = 0x17, bgB = 0x2a;
  // Letter color: white
  const fgR = 0xff, fgG = 0xff, fgB = 0xff;

  // Create raw pixel data (RGBA)
  const rawRows = [];

  // Draw a simple "C" shape
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.35;
  const innerR = size * 0.22;
  // Rounded corner radius for background
  const cornerR = size * 0.125;

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte + RGB
    row[0] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const offset = 1 + x * 3;

      // Check if pixel is in rounded rectangle
      let inRect = true;
      // Top-left corner
      if (x < cornerR && y < cornerR) {
        const dx = cornerR - x;
        const dy = cornerR - y;
        if (dx * dx + dy * dy > cornerR * cornerR) inRect = false;
      }
      // Top-right corner
      if (x > size - cornerR && y < cornerR) {
        const dx = x - (size - cornerR);
        const dy = cornerR - y;
        if (dx * dx + dy * dy > cornerR * cornerR) inRect = false;
      }
      // Bottom-left corner
      if (x < cornerR && y > size - cornerR) {
        const dx = cornerR - x;
        const dy = y - (size - cornerR);
        if (dx * dx + dy * dy > cornerR * cornerR) inRect = false;
      }
      // Bottom-right corner
      if (x > size - cornerR && y > size - cornerR) {
        const dx = x - (size - cornerR);
        const dy = y - (size - cornerR);
        if (dx * dx + dy * dy > cornerR * cornerR) inRect = false;
      }

      if (!inRect) {
        // Transparent pixels outside rounded rect - use white since PNG is RGB
        row[offset] = 0xff;
        row[offset + 1] = 0xff;
        row[offset + 2] = 0xff;
        continue;
      }

      // Distance from center
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Angle from center (0 = right, PI/2 = down)
      const angle = Math.atan2(dy, dx);

      // "C" shape: ring with opening on the right side
      const isRing = dist >= innerR && dist <= outerR;
      // Opening angle: roughly -45deg to +45deg on the right side
      const openingAngle = Math.PI / 4;
      const isInOpening = angle > -openingAngle && angle < openingAngle;

      const isC = isRing && !isInOpening;

      if (isC) {
        row[offset] = fgR;
        row[offset + 1] = fgG;
        row[offset + 2] = fgB;
      } else {
        row[offset] = bgR;
        row[offset + 1] = bgG;
        row[offset + 2] = bgB;
      }
    }
    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);   // width
  ihdr.writeUInt32BE(size, 4);   // height
  ihdr[8] = 8;                    // bit depth
  ihdr[9] = 2;                    // color type: RGB
  ihdr[10] = 0;                   // compression
  ihdr[11] = 0;                   // filter
  ihdr[12] = 0;                   // interlace

  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Generate both icon sizes
const icon192 = generatePNG(192);
const icon512 = generatePNG(512);

writeFileSync(join(iconsDir, "icon-192.png"), icon192);
writeFileSync(join(iconsDir, "icon-512.png"), icon512);

console.log(`Generated icon-192.png (${icon192.length} bytes)`);
console.log(`Generated icon-512.png (${icon512.length} bytes)`);
