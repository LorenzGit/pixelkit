/* ------------------------------------------------------------------ */
/* Magic-wand recipe engine (the Photoshop workflow, automated)         */
/*                                                                     */
/* Layer 1 (object): the user clicks background areas; each click      */
/* flood-selects contiguous pixels within a tolerance of the clicked   */
/* color (magic wand, anti-aliased like Photoshop's). The union        */
/* selection is refined — contract → smooth → feather — and cleared.   */
/*                                                                     */
/* Layer 2 (shadow): anchored to the clicked background colors. A      */
/* pixel counts as soft shadow when it is a *neutral darkening* of a   */
/* clicked background color (same chroma, lower luminance). It comes   */
/* back as translucent black with opacity equal to how much darker it  */
/* is — the exact un-compositing of a multiply shadow, so it reads     */
/* correctly over any new background. Colored elements (text badges,   */
/* decorations) fail the neutrality test and are never resurrected.    */
/* ------------------------------------------------------------------ */
import { luminance, transparentPct } from './color.js';
import { SHADOW_NEUTRAL_TOL, SHADOW_NOISE_FLOOR } from './constants.js';

// Photoshop-style tolerance: max per-channel difference.
const chanDiff = (d, i, r, g, b) =>
  Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));

// Flood-select contiguous pixels similar to the seed pixel into `sel`
// (0..255 per pixel). Pixels within `tolerance` flood on; rejected pixels
// touching the flood get a fractional (anti-aliased) selection that fades
// over a second tolerance band, like Photoshop's anti-aliased wand.
export function floodSelect(d, w, h, sx, sy, tolerance, sel) {
  const start = sy * w + sx;
  const i0 = start * 4;
  const sr = d[i0], sg = d[i0 + 1], sb = d[i0 + 2];
  const tol = Math.max(0, tolerance);
  const soft = Math.max(1, tol); // AA band width beyond the hard tolerance
  const seen = new Uint8Array(w * h);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const p = stack.pop();
    const diff = chanDiff(d, p * 4, sr, sg, sb);
    if (diff > tol) {
      // Boundary pixel: partial selection proportional to how close it is.
      const frac = 1 - (diff - tol) / soft;
      if (frac > 0) { const v = Math.round(255 * frac); if (v > sel[p]) sel[p] = v; }
      continue; // AA rim never propagates the flood
    }
    sel[p] = 255;
    const x = p % w, y = (p / w) | 0;
    if (x + 1 < w && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
    if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
    if (y + 1 < h && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    if (y > 0 && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
  }
}

// Separable min filter — shrinks the selection inward by `r` px
// (Photoshop: Select > Modify > Contract). Outside the canvas counts as
// selected, so a selection touching the image border doesn't pull away
// from the edge (matches Photoshop).
export function erodeSel(sel, w, h, r) {
  const tmp = new Uint8ClampedArray(sel.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 255;
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= w) continue;
      v = Math.min(v, sel[y * w + nx]);
      if (!v) break;
    }
    tmp[y * w + x] = v;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let v = 255;
    for (let dy = -r; dy <= r; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      v = Math.min(v, tmp[ny * w + x]);
      if (!v) break;
    }
    sel[y * w + x] = v;
  }
}

// Separable max filter — grows the selection outward by `r` px
// (Photoshop: Select > Modify > Expand). Used for negative Contract values
// to eat leftover background fringe hugging the object.
export function dilateSel(sel, w, h, r) {
  const tmp = new Uint8ClampedArray(sel.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= w) continue;
      v = Math.max(v, sel[y * w + nx]);
      if (v === 255) break;
    }
    tmp[y * w + x] = v;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let v = 0;
    for (let dy = -r; dy <= r; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      v = Math.max(v, tmp[ny * w + x]);
      if (v === 255) break;
    }
    sel[y * w + x] = v;
  }
}

// Separable box blur with a running sum (edges clamp to the border value).
// Accepts fractional radii: the integer window keeps full weight and the two
// taps just outside it contribute the fractional remainder, so the blur
// width varies continuously (feather 0.5 is genuinely half of feather 1).
export function blurSel(sel, w, h, r) {
  const n = Math.floor(r), f = r - n;
  const win = 2 * n + 1 + 2 * f;
  const tmp = new Float32Array(sel.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -n; x <= n; x++) sum += sel[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      let v = sum;
      if (f > 0) v += f * (sel[row + Math.max(0, x - n - 1)] + sel[row + Math.min(w - 1, x + n + 1)]);
      tmp[row + x] = v / win;
      sum += sel[row + Math.min(w - 1, x + n + 1)] - sel[row + Math.max(0, x - n)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -n; y <= n; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      let v = sum;
      if (f > 0) v += f * (tmp[Math.max(0, y - n - 1) * w + x] + tmp[Math.min(h - 1, y + n + 1) * w + x]);
      sel[y * w + x] = Math.round(v / win);
      sum += tmp[Math.min(h - 1, y + n + 1) * w + x] - tmp[Math.max(0, y - n) * w + x];
    }
  }
}

// PS-style Smooth: round contours without destroying the anti-aliased edge.
// Blur rounds the shape; the steep (but not binary) remap re-sharpens the
// gradient so a soft edge survives where a hard threshold would erase it.
// Below 1 px the remap slope ramps 1 → 3 with the radius, so fractional
// smooth fades in continuously instead of jumping to the full re-sharpen.
export function smoothSel(sel, w, h, r) {
  blurSel(sel, w, h, r);
  const k = 1 + 2 * Math.min(1, r);
  for (let p = 0; p < sel.length; p++) sel[p] = Math.max(0, Math.min(255, (sel[p] - 128) * k + 128));
}

// Contract (r > 0) or expand (r < 0) the selection by a possibly-fractional
// pixel amount: whole pixels use the min/max filter, and the remainder blends
// toward one more step — so 0.5 lands visually halfway between 0 and 1.
export function contractSel(sel, w, h, r) {
  const op = r > 0 ? erodeSel : dilateSel;
  const a = Math.abs(r);
  const n = Math.floor(a), f = a - n;
  if (n > 0) op(sel, w, h, n);
  if (f > 1e-3) {
    const more = sel.slice();
    op(more, w, h, 1);
    for (let p = 0; p < sel.length; p++) sel[p] = Math.round(sel[p] * (1 - f) + more[p] * f);
  }
}

// Shadow test against one clicked background color: is this pixel a neutral
// darkening of it? Returns the darkness fraction (0..1), or 0 if not shadow.
export function shadowDarkness(d, i, bg) {
  const Lb = luminance(bg[0], bg[1], bg[2]);
  if (Lb < 8) return 0; // clicking a black background leaves no headroom
  const k = luminance(d[i], d[i + 1], d[i + 2]) / Lb;
  if (k >= 1) return 0;
  if (
    Math.abs(d[i] - k * bg[0]) > SHADOW_NEUTRAL_TOL ||
    Math.abs(d[i + 1] - k * bg[1]) > SHADOW_NEUTRAL_TOL ||
    Math.abs(d[i + 2] - k * bg[2]) > SHADOW_NEUTRAL_TOL
  ) return 0; // chroma-shifted vs the background — a colored element, not shadow
  return Math.max(0, (1 - k) - SHADOW_NOISE_FLOOR) / (1 - SHADOW_NOISE_FLOOR);
}

// The full recipe. seeds: [{x, y}] in image pixels. Returns a fresh canvas.
export function wandCutout(sourceCanvas, seeds, opts) {
  const {
    tolerance = 20, contract = 1, smooth = 2, feather = 1,
    shadow = true, shadowStrength = 100,
  } = opts;
  const w = sourceCanvas.width, h = sourceCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!w || !h) return { canvas: out, transparentPct: 0 };
  ctx.drawImage(sourceCanvas, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  const sel = new Uint8ClampedArray(w * h);
  const bgColors = [];
  for (const s of seeds) {
    const x = Math.min(w - 1, Math.max(0, Math.round(s.x)));
    const y = Math.min(h - 1, Math.max(0, Math.round(s.y)));
    const i = (y * w + x) * 4;
    bgColors.push([d[i], d[i + 1], d[i + 2]]);
    floodSelect(d, w, h, x, y, tolerance, sel);
  }

  if (contract) contractSel(sel, w, h, contract);
  if (smooth > 0) smoothSel(sel, w, h, smooth);
  if (feather > 0) blurSel(sel, w, h, feather);

  const strength = shadowStrength / 100;
  for (let p = 0, i = 0; p < sel.length; p++, i += 4) {
    const aO = (d[i + 3] / 255) * (255 - sel[p]) / 255; // layer 1: selection cleared
    let aS = 0;
    if (shadow && aO < 1 && bgColors.length) { // layer 2: anchored shadow
      let dark = 0;
      for (const bg of bgColors) {
        const v = shadowDarkness(d, i, bg);
        if (v > dark) dark = v;
      }
      aS = Math.min(1, dark * strength) * (d[i + 3] / 255) * (1 - aO);
    }
    const aF = aO + aS;
    if (aS > 0 && aF > 0) {
      // Shadow contributes as translucent BLACK (un-composited multiply
      // shadow), so over the original background it looks identical, and
      // over any new background it darkens instead of graying.
      const f = aO / aF;
      d[i] = Math.round(d[i] * f); d[i + 1] = Math.round(d[i + 1] * f); d[i + 2] = Math.round(d[i + 2] * f);
    }
    d[i + 3] = Math.round(255 * aF);
  }

  ctx.putImageData(image, 0, 0);
  return { canvas: out, transparentPct: transparentPct(d, w * h) };
}
