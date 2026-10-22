// A tiny PNG encoder and pixel canvas, written from scratch on top of node:zlib.
//
// This exists so the project can generate its own placeholder art without
// pulling in an image library. It writes 8-bit RGBA PNGs, which is all the
// sprite pipeline needs.

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  out.writeUInt32BE(crc32(crcInput), data.length + 8);
  return out;
}

// A plain RGBA pixel buffer with the few drawing primitives the sprite art
// needs. Coordinates outside the canvas are silently ignored.
export class Pixels {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  // Alpha-blends a colour onto a pixel.
  set(x, y, [r, g, b, a = 255]) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    if (a >= 255) {
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      return;
    }
    const sa = a / 255;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    d[i] = (r * sa + d[i] * da * (1 - sa)) / oa;
    d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa;
    d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }

  rect(x, y, w, h, color) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, color);
    }
  }

  // Filled ellipse, used for the mask and the cloak's rounded shoulders.
  ellipse(cx, cy, rx, ry, color) {
    if (rx <= 0 || ry <= 0) return;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, color);
      }
    }
  }

  // Filled triangle via barycentric coverage - used for the horns.
  triangle(p0, p1, p2, color) {
    const minX = Math.floor(Math.min(p0[0], p1[0], p2[0]));
    const maxX = Math.ceil(Math.max(p0[0], p1[0], p2[0]));
    const minY = Math.floor(Math.min(p0[1], p1[1], p2[1]));
    const maxY = Math.ceil(Math.max(p0[1], p1[1], p2[1]));
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (area === 0) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((p1[0] - p0[0]) * (y + 0.5 - p0[1]) - (x + 0.5 - p0[0]) * (p1[1] - p0[1])) / area;
        const w1 = ((x + 0.5 - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (y + 0.5 - p0[1])) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) this.set(x, y, color);
      }
    }
  }

  // A vertical trapezoid: the cloak silhouette.
  trapezoid(cx, topY, topW, botY, botW, color) {
    for (let y = topY; y <= botY; y++) {
      const t = (y - topY) / Math.max(1, botY - topY);
      const w = topW + (botW - topW) * t;
      this.rect(Math.round(cx - w / 2), y, Math.round(w), 1, color);
    }
  }

  // Copies another buffer in at an offset, respecting alpha. Frames are drawn
  // into their own cell-sized buffer and blitted, so a pose that overshoots the
  // cell is clipped instead of bleeding into the neighbouring frame.
  blit(src, dx, dy) {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const a = src.data[i + 3];
        if (a === 0) continue;
        this.set(dx + x, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2], a]);
      }
    }
  }

  toPNG() {
    const { width, height, data } = this;
    // Each scanline is prefixed with filter type 0 (None).
    const raw = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
      const rowStart = y * (width * 4 + 1);
      raw[rowStart] = 0;
      for (let x = 0; x < width * 4; x++) {
        raw[rowStart + 1 + x] = data[y * width * 4 + x];
      }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}
