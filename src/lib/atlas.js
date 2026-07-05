/* ------------------------------------------------------------------ */
/* Atlas packing + sprite detection                                    */
/* ------------------------------------------------------------------ */
import { clamp, hexToRgb, nearestDistSq } from './color.js';
import { sampleBackgroundPalette } from './sampling.js';
import { dilateMask } from './morphology.js';
import { ATLAS_AREA_SLACK } from './constants.js';

// Shelf packer: sort by height, lay out left-to-right wrapping into shelves.
export function packAtlas(items, padding) {
  const sorted = [...items].sort((a, b) => b.h - a.h);
  const totalArea = sorted.reduce((s, i) => s + (i.w + padding) * (i.h + padding), 0);
  const width = Math.max(...sorted.map(i => i.w + padding * 2), Math.ceil(Math.sqrt(totalArea) * ATLAS_AREA_SLACK));
  let x = padding, y = padding, shelfH = 0;
  const placements = [];
  for (const it of sorted) {
    if (x + it.w + padding > width) { x = padding; y += shelfH + padding; shelfH = 0; }
    placements.push({ item: it, x, y });
    x += it.w + padding;
    if (it.h > shelfH) shelfH = it.h;
  }
  const height = y + shelfH + padding;
  return { width, height, placements };
}

// Estimate columns/rows for a uniform grid by counting background gaps.
export function autoDetectGrid(canvas, opts) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, w, h).data;
  const targets = (opts.keys && opts.keys.length) ? opts.keys.map(hexToRgb) : sampleBackgroundPalette(ctx, w, h);
  const tol = (opts.tolerance + 8) * (opts.tolerance + 8);
  const colHas = new Array(w).fill(false), rowHas = new Array(h).fill(false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (nearestDistSq(d, i, targets).dist > tol) { colHas[x] = true; rowHas[y] = true; }
  }
  const countGroups = arr => {
    let groups = 0, inRun = false;
    for (const v of arr) { if (v && !inRun) { groups++; inRun = true; } else if (!v) inRun = false; }
    return groups;
  };
  return { cols: clamp(countGroups(colHas), 1, 32), rows: clamp(countGroups(rowHas), 1, 32) };
}

// Detect individually packed sprites from the alpha mask of a cutout canvas.
export function extractPackedSprites(canvas, { alphaThreshold = 72, minArea = 320, mergeDistance = 2, padding = 24 } = {}) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const source = ctx.getImageData(0, 0, w, h);
  const data = source.data;
  let mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) mask[p] = data[p * 4 + 3] > alphaThreshold ? 1 : 0;
  mask = dilateMask(mask, w, h, mergeDistance);
  const seen = new Uint8Array(w * h);
  const labels = new Int32Array(w * h);
  const raw = [];

  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !mask[p]) continue;
    const stack = [p], pixels = [p]; seen[p] = 1;
    let minX = w, minY = h, maxX = -1, maxY = -1, area = 0;
    while (stack.length) {
      const id = stack.pop(); area++;
      const x = id % w, y = (id / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const candidates = [];
      if (x > 0) candidates.push(id - 1);
      if (x < w - 1) candidates.push(id + 1);
      if (y > 0) candidates.push(id - w);
      if (y < h - 1) candidates.push(id + w);
      for (const np of candidates) {
        if (seen[np] || !mask[np]) continue;
        seen[np] = 1; stack.push(np); pixels.push(np);
      }
    }
    if (area >= minArea) {
      const id = raw.length + 1;
      for (const px of pixels) labels[px] = id;
      raw.push({ id, coreX: minX, coreY: minY, coreW: maxX - minX + 1, coreH: maxY - minY + 1, area });
    }
  }

  const comps = raw.map((comp, idx) => {
    const x0 = clamp(comp.coreX - padding, 0, w - 1);
    const y0 = clamp(comp.coreY - padding, 0, h - 1);
    const x1 = clamp(comp.coreX + comp.coreW - 1 + padding, 0, w - 1);
    const y1 = clamp(comp.coreY + comp.coreH - 1 + padding, 0, h - 1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const cut = document.createElement('canvas'); cut.width = bw; cut.height = bh;
    const cctx = cut.getContext('2d');
    const out = cctx.createImageData(bw, bh);
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
      const sx = x0 + xx, sy = y0 + yy;
      const sp = sy * w + sx;
      const si = sp * 4, di = (yy * bw + xx) * 4;
      const alpha = data[si + 3];
      if (alpha === 0) continue;
      const belongs = labels[sp] === comp.id;
      const lowShadow = alpha <= alphaThreshold;
      // Keep the component and its soft shadow padding, but remove neighbouring
      // high-alpha sprite fragments caught by the padding rectangle.
      if (!belongs && !lowShadow) continue;
      out.data[di] = data[si]; out.data[di + 1] = data[si + 1]; out.data[di + 2] = data[si + 2]; out.data[di + 3] = alpha;
    }
    cctx.putImageData(out, 0, 0);
    return { x: x0, y: y0, w: bw, h: bh, area: comp.area, cut, index: idx };
  });
  return comps.sort((a, b) => (a.y - b.y) || (a.x - b.x));
}
