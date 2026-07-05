/* ------------------------------------------------------------------ */
/* Colour math (pure, no DOM)                                          */
/* ------------------------------------------------------------------ */
import { ALPHA_VISIBLE } from './constants.js';

export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const m = (hex || '#000000').replace('#', '').match(/.{1,2}/g) || ['00', '00', '00'];
  return m.slice(0, 3).map(x => parseInt(x, 16));
}

export function colorDistSq(data, i, t) {
  const dr = data[i] - t[0], dg = data[i + 1] - t[1], db = data[i + 2] - t[2];
  return dr * dr + dg * dg + db * db;
}

export function nearestDistSq(data, i, targets) {
  let best = Infinity, idx = 0;
  for (let k = 0; k < targets.length; k++) {
    const d = colorDistSq(data, i, targets[k]);
    if (d < best) { best = d; idx = k; }
  }
  return { dist: best, idx };
}

export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// Share of pixels that are effectively transparent, as a 0-100 percentage.
export function transparentPct(data, totalPx) {
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > ALPHA_VISIBLE) opaque++;
  return Math.round((1 - opaque / totalPx) * 100);
}
