import type { IncomingMessage, ServerResponse } from "node:http";
import { deflateSync } from "node:zlib";

/**
 * Server-rendered countdown image for campaign email.
 *
 * Email clients do not run JavaScript, so a "live" countdown is an image the
 * server regenerates on every request: the reader sees the time remaining at
 * the moment they opened the message, and it does not tick while open. This is
 * the same technique established senders use.
 *
 * The image is a real PNG built here rather than an SVG, because SVG images are
 * blocked or unsupported in Gmail and Outlook. No image dependency is needed:
 * the raster is assembled from a bitmap font and deflated with node:zlib.
 */

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

// 5x7 bitmap font. Only the characters a countdown needs are defined; anything
// else renders as blank space.
const glyphs: Record<string, string[]> = {
  "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  ":": ["00000", "00000", "00100", "00000", "00100", "00000", "00000"],
};

type Rgb = [number, number, number];

class Raster {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.pixels = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
      this.pixels[index * 3] = background[0];
      this.pixels[index * 3 + 1] = background[1];
      this.pixels[index * 3 + 2] = background[2];
    }
  }

  setPixel(x: number, y: number, color: Rgb) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    this.pixels[offset] = color[0];
    this.pixels[offset + 1] = color[1];
    this.pixels[offset + 2] = color[2];
  }

  fillRect(x: number, y: number, width: number, height: number, color: Rgb) {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        this.setPixel(column, row, color);
      }
    }
  }

  drawText(
    text: string,
    x: number,
    y: number,
    scale: number,
    color: Rgb,
    letterSpacing = 1,
  ) {
    let cursor = x;
    for (const character of text.toUpperCase()) {
      const glyph = glyphs[character];
      if (glyph) {
        glyph.forEach((row, rowIndex) => {
          for (let column = 0; column < GLYPH_WIDTH; column += 1) {
            if (row[column] !== "1") continue;
            this.fillRect(
              cursor + column * scale,
              y + rowIndex * scale,
              scale,
              scale,
              color,
            );
          }
        });
      }
      cursor += (GLYPH_WIDTH + letterSpacing) * scale;
    }
    return cursor;
  }

  measureText(text: string, scale: number, letterSpacing = 1) {
    if (!text.length) return 0;
    return (
      text.length * (GLYPH_WIDTH + letterSpacing) * scale -
      letterSpacing * scale
    );
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
};

const encodePng = (raster: Raster) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(raster.width, 0);
  header.writeUInt32BE(raster.height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: truecolour RGB
  header.writeUInt8(0, 10); // deflate
  header.writeUInt8(0, 11); // adaptive filtering
  header.writeUInt8(0, 12); // no interlace

  const stride = raster.width * 3;
  const scanlines = Buffer.alloc((stride + 1) * raster.height);
  for (let row = 0; row < raster.height; row += 1) {
    scanlines[row * (stride + 1)] = 0; // filter type none
    Buffer.from(
      raster.pixels.buffer,
      raster.pixels.byteOffset + row * stride,
      stride,
    ).copy(scanlines, row * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const parseHexColor = (value: string, fallback: Rgb): Rgb => {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return fallback;
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
};

export const countdownSegments = (deadline: string, now = Date.now()) => {
  const target = new Date(deadline).getTime();
  if (!Number.isFinite(target)) return null;
  const remaining = target - now;
  if (remaining <= 0) return { days: 0, hours: 0, minutes: 0, expired: true };
  return {
    days: Math.min(999, Math.floor(remaining / 86_400_000)),
    hours: Math.floor((remaining % 86_400_000) / 3_600_000),
    minutes: Math.floor((remaining % 3_600_000) / 60_000),
    expired: false,
  };
};

export const renderCountdownPng = (options: {
  deadline: string;
  accent?: string;
  now?: number;
}) => {
  const width = 336;
  const height = 104;
  const accent = parseHexColor(options.accent || "", [0x63, 0x5b, 0xff]);
  const background: Rgb = [0xff, 0xff, 0xff];
  const raster = new Raster(width, height, background);
  const segments = countdownSegments(options.deadline, options.now);

  if (!segments || segments.expired) {
    const message = segments ? "OFFER HAS ENDED" : "COUNTDOWN UNAVAILABLE";
    const scale = 2;
    const textWidth = raster.measureText(message, scale);
    raster.drawText(
      message,
      Math.round((width - textWidth) / 2),
      Math.round((height - GLYPH_HEIGHT * scale) / 2),
      scale,
      [0x8a, 0x96, 0xaa],
    );
    return encodePng(raster);
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  const cells = [
    { value: segments.days > 99 ? String(segments.days) : pad(segments.days), label: "DAYS" },
    { value: pad(segments.hours), label: "HOURS" },
    { value: pad(segments.minutes), label: "MINS" },
  ];

  const cellWidth = 96;
  const gap = 24;
  const totalWidth = cells.length * cellWidth + (cells.length - 1) * gap;
  let x = Math.round((width - totalWidth) / 2);

  cells.forEach((cell, index) => {
    raster.fillRect(x, 8, cellWidth, 66, accent);
    const valueScale = 6;
    const valueWidth = raster.measureText(cell.value, valueScale);
    raster.drawText(
      cell.value,
      x + Math.round((cellWidth - valueWidth) / 2),
      8 + Math.round((66 - GLYPH_HEIGHT * valueScale) / 2),
      valueScale,
      background,
    );

    const labelScale = 2;
    const labelWidth = raster.measureText(cell.label, labelScale);
    raster.drawText(
      cell.label,
      x + Math.round((cellWidth - labelWidth) / 2),
      82,
      labelScale,
      [0x52, 0x60, 0x77],
    );

    if (index < cells.length - 1) {
      raster.fillRect(x + cellWidth + gap / 2 - 2, 30, 4, 4, accent);
      raster.fillRect(x + cellWidth + gap / 2 - 2, 48, 4, 4, accent);
    }
    x += cellWidth + gap;
  });

  return encodePng(raster);
};

export async function handleCampaignCountdown(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url || "/", "http://localhost");
  const deadline = url.searchParams.get("deadline") || "";
  const accent = url.searchParams.get("accent") || "";
  try {
    const png = renderCountdownPng({ deadline, accent });
    response.statusCode = 200;
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Length", String(png.length));
    // Regenerated on every open: caching it would freeze the clock.
    response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(png);
  } catch {
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Countdown image could not be rendered.");
  }
}
