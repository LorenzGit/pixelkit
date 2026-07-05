/* ------------------------------------------------------------------ */
/* User-drawn keep / erase regions (polygon lasso + rectangles)        */
/*                                                                     */
/* Regions are applied as a post-process on top of whichever removal   */
/* engine produced the base result, without re-running the mask.       */
/*                                                                     */
/* A region is { type: 'poly'|'rect', effect: 'keep'|'erase'|'sub',    */
/*   points: [{x,y},…] } (rect also as points: 2 opposite corners).    */
/* Effects, applied in draw order:                                     */
/*   keep  — restore the original pixels (protect from removal)        */
/*   erase — force transparent                                         */
/*   sub   — subtract: clear earlier keep/erase shapes back to auto    */
/* ------------------------------------------------------------------ */

function tracePath(ctx, region) {
  ctx.beginPath();
  if (region.type === 'rect') {
    const [a, b] = region.points;
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else {
    region.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
}

// Rasterize the region stack to a per-pixel state map:
// 0 = automatic mask, 1 = keep original, 2 = force erase.
export function rasterizeRegions(regions, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (const r of regions) {
    ctx.globalCompositeOperation = r.effect === 'sub' ? 'destination-out' : 'source-over';
    ctx.fillStyle = r.effect === 'erase' ? '#ff0000' : '#00ff00';
    tracePath(ctx, r);
    ctx.fill();
  }
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    if (d[i + 3] > 127) out[p] = d[i] > 127 ? 2 : 1;
  }
  return out;
}

// Combine the automatic mask result with the drawn regions.
export function applyRegions(baseCanvas, originalCanvas, regions) {
  if (!regions.length) return baseCanvas;
  const w = baseCanvas.width, h = baseCanvas.height;
  if (!w || !h) return baseCanvas;
  const states = rasterizeRegions(regions, w, h);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(baseCanvas, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const od = originalCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  for (let p = 0, i = 0; p < states.length; p++, i += 4) {
    if (states[p] === 1) { d[i] = od[i]; d[i + 1] = od[i + 1]; d[i + 2] = od[i + 2]; d[i + 3] = od[i + 3]; }
    else if (states[p] === 2) d[i + 3] = 0;
  }
  ctx.putImageData(image, 0, 0);
  return out;
}
