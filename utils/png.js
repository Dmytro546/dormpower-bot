'use strict';

const zlib = require('zlib');

// Л19: валідний PNG на чистому zlib + Buffer (без графічних бібліотек).
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const kind = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([kind, data])), 0);
  return Buffer.concat([length, kind, data, crc]);
}

function createCanvas(width, height, color) {
  const bg = color || [255, 255, 255, 255];
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = bg[0];
    pixels[i * 4 + 1] = bg[1];
    pixels[i * 4 + 2] = bg[2];
    pixels[i * 4 + 3] = bg[3] === undefined ? 255 : bg[3];
  }
  return pixels;
}

function setPixel(pixels, width, height, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3] === undefined ? 255 : color[3];
}

// Алгоритм Брезенхема.
function drawLine(pixels, width, height, x0, y0, x1, y1, color) {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const sx = ax < bx ? 1 : -1;
  const dy = -Math.abs(by - ay);
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPixel(pixels, width, height, ax, ay, color);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
}

// Растровий шрифт 3×5 для підписів осей.
const FONT = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '.': ['000', '000', '000', '000', '010'],
  ',': ['000', '000', '000', '010', '100'],
  '-': ['000', '000', '111', '000', '000'],
  ':': ['000', '010', '000', '010', '000'],
  ' ': ['000', '000', '000', '000', '000'],
};

function drawText(pixels, width, height, x, y, text, color) {
  let cursor = x;
  for (const char of String(text).toUpperCase()) {
    const glyph = FONT[char] || FONT[' '];
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        if (glyph[row][col] === '1') setPixel(pixels, width, height, cursor + col, y + row, color);
      }
    }
    cursor += 4;
  }
}

function encodePng(width, height, pixels) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Некоректні розміри PNG');
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bit depth
  header[9] = 6;  // RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = {
  crc32, chunk, createCanvas, setPixel, drawLine, drawText, encodePng, FONT,
};
