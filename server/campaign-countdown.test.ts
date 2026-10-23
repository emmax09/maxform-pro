import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { countdownSegments, renderCountdownPng } from "./campaign-countdown";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Walks the chunk list so the test verifies real PNG structure, not a prefix. */
const readChunks = (png: Buffer) => {
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    chunks.push({
      type,
      data: png.subarray(offset + 8, offset + 8 + length),
    });
    offset += 12 + length;
  }
  return chunks;
};

describe("countdown segments", () => {
  it("returns nothing for an unparseable deadline", () => {
    expect(countdownSegments("tomorrow-ish")).toBeNull();
  });

  it("marks an elapsed deadline as expired", () => {
    const now = Date.UTC(2026, 6, 29, 12, 0, 0);
    expect(
      countdownSegments(new Date(now - 1000).toISOString(), now),
    ).toEqual({ days: 0, hours: 0, minutes: 0, expired: true });
  });

  it("splits the remaining time relative to the given instant", () => {
    const now = Date.UTC(2026, 6, 29, 12, 0, 0);
    const deadline = new Date(
      now + 3 * 86_400_000 + 5 * 3_600_000 + 42 * 60_000,
    ).toISOString();

    expect(countdownSegments(deadline, now)).toEqual({
      days: 3,
      hours: 5,
      minutes: 42,
      expired: false,
    });
  });

  it("caps an absurdly distant deadline at three digits of days", () => {
    const now = Date.UTC(2026, 6, 29, 12, 0, 0);
    const deadline = new Date(now + 5000 * 86_400_000).toISOString();

    expect(countdownSegments(deadline, now)?.days).toBe(999);
  });
});

describe("countdown PNG rendering", () => {
  const now = Date.UTC(2026, 6, 29, 12, 0, 0);
  const png = renderCountdownPng({
    deadline: new Date(now + 2 * 86_400_000).toISOString(),
    accent: "#635BFF",
    now,
  });

  it("emits a real PNG with the required chunks in order", () => {
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(readChunks(png).map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "IDAT",
      "IEND",
    ]);
  });

  it("declares 8-bit truecolour dimensions in the header", () => {
    const header = readChunks(png).find((chunk) => chunk.type === "IHDR")!.data;

    expect(header.readUInt32BE(0)).toBe(336); // width
    expect(header.readUInt32BE(4)).toBe(104); // height
    expect(header.readUInt8(8)).toBe(8); // bit depth
    expect(header.readUInt8(9)).toBe(2); // colour type: RGB
  });

  it("produces pixel data of exactly the declared size", () => {
    const idat = readChunks(png).find((chunk) => chunk.type === "IDAT")!.data;
    const raw = inflateSync(idat);

    // Each of the 104 scanlines is one filter byte plus 336 RGB triples.
    expect(raw.length).toBe(104 * (1 + 336 * 3));
    for (let row = 0; row < 104; row += 1) {
      expect(raw[row * (1 + 336 * 3)]).toBe(0); // filter type: none
    }
  });

  it("paints the accent colour into the image", () => {
    const idat = readChunks(png).find((chunk) => chunk.type === "IDAT")!.data;
    const raw = inflateSync(idat);
    const stride = 1 + 336 * 3;
    let accentPixels = 0;
    for (let row = 0; row < 104; row += 1) {
      for (let column = 0; column < 336; column += 1) {
        const offset = row * stride + 1 + column * 3;
        if (
          raw[offset] === 0x63 &&
          raw[offset + 1] === 0x5b &&
          raw[offset + 2] === 0xff
        ) {
          accentPixels += 1;
        }
      }
    }
    expect(accentPixels).toBeGreaterThan(1000);
  });

  it("still renders a valid image for an expired or invalid deadline", () => {
    for (const deadline of ["", "nonsense", new Date(now - 1).toISOString()]) {
      const image = renderCountdownPng({ deadline, now });
      expect(image.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect(readChunks(image).map((chunk) => chunk.type)).toEqual([
        "IHDR",
        "IDAT",
        "IEND",
      ]);
    }
  });

  it("changes with the clock, which is the point of regenerating per open", () => {
    const deadline = new Date(now + 2 * 86_400_000).toISOString();
    const later = renderCountdownPng({
      deadline,
      accent: "#635BFF",
      now: now + 6 * 3_600_000,
    });

    expect(later.equals(png)).toBe(false);
  });
});
