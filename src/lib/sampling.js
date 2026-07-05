/* ------------------------------------------------------------------ */
/* Background colour sampling                                          */
/* ------------------------------------------------------------------ */
import { clamp } from './color.js';
import { BORDER_SAMPLE_DIVISOR, BORDER_QUANT, BORDER_MERGE_DIST, BORDER_MAX_KEYS } from './constants.js';

// Average of the four corner pixels. Used only as a degenerate fallback.
export function sampleCorners(ctx, w, h, inset = 2) {
  const pts = [[inset, inset], [w - inset - 1, inset], [inset, h - inset - 1], [w - inset - 1, h - inset - 1]]
    .map(([x, y]) => ctx.getImageData(clamp(x, 0, w - 1), clamp(y, 0, h - 1), 1, 1).data);
  return pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(v => Math.round(v / pts.length));
}

// Dominant background colours sampled from the whole border. Packed atlases
// usually have a solid matte, but screenshots can carry a dark app frame plus
// a preview background, so we keep several quantised colours rather than
// trusting four corners. Reads four border strips (4 getImageData calls)
// instead of hundreds of 1x1 readbacks.
export function sampleBackgroundPalette(ctx, w, h, maxColors = BORDER_MAX_KEYS) {
  const step = Math.max(1, Math.floor(Math.min(w, h) / BORDER_SAMPLE_DIVISOR));
  const top = ctx.getImageData(0, 0, w, 1).data;
  const bottom = ctx.getImageData(0, h - 1, w, 1).data;
  const left = ctx.getImageData(0, 0, 1, h).data;
  const right = ctx.getImageData(w - 1, 0, 1, h).data;
  const counts = new Map();
  const add = (arr, idx) => {
    const key = (Math.round(arr[idx] / BORDER_QUANT) * BORDER_QUANT) + ',' +
      (Math.round(arr[idx + 1] / BORDER_QUANT) * BORDER_QUANT) + ',' +
      (Math.round(arr[idx + 2] / BORDER_QUANT) * BORDER_QUANT);
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (let x = 0; x < w; x += step) { add(top, x * 4); add(bottom, x * 4); }
  for (let y = 0; y < h; y += step) { add(left, y * 4); add(right, y * 4); }

  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(',').map(Number));
  if (!colors.length) return [sampleCorners(ctx, w, h)];
  const picked = [];
  for (const c of colors) {
    if (picked.every(p => ((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2) > BORDER_MERGE_DIST ** 2)) picked.push(c);
    if (picked.length >= maxColors) break;
  }
  return picked.length ? picked : [sampleCorners(ctx, w, h)];
}
