/**
 * Code 128 (subset B) encoder used for the tear-off stub barcode.
 *
 * Every symbol is six alternating bar/space modules that sum to 11, except the
 * stop symbol which is seven modules summing to 13. `CODE128_PATTERNS` is
 * validated against those invariants in the unit test, which is what catches a
 * mistyped pattern before it reaches a scanner.
 */
export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
] as const;

const START_B = 104;
const STOP = 106;

/** Keeps the payload inside the printable range subset B can represent. */
export const sanitizeCode128 = (value: string) =>
  (value || "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join("")
    .slice(0, 32);

/**
 * Returns the module widths of the full symbol, starting with a bar and
 * alternating. An empty payload returns an empty array.
 */
export const encodeCode128 = (value: string): number[] => {
  const payload = sanitizeCode128(value);
  if (!payload) return [];
  const codes = [START_B];
  for (const character of payload) {
    codes.push(character.charCodeAt(0) - 32);
  }
  const checksum = codes.reduce(
    (total, code, index) => total + code * (index === 0 ? 1 : index),
    0,
  );
  codes.push(checksum % 103, STOP);
  return codes.flatMap((code) =>
    CODE128_PATTERNS[code].split("").map((width) => Number(width)),
  );
};

/** Bars only, as `[offset, width]` pairs in module units, plus the total. */
export const code128Bars = (value: string) => {
  const modules = encodeCode128(value);
  const bars: Array<{ x: number; width: number }> = [];
  let offset = 0;
  modules.forEach((width, index) => {
    if (index % 2 === 0) bars.push({ x: offset, width });
    offset += width;
  });
  return { bars, total: offset };
};
