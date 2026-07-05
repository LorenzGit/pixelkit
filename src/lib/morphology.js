/* ------------------------------------------------------------------ */
/* Morphology helpers                                                  */
/* ------------------------------------------------------------------ */

// Binary dilation of a Uint8Array mask by `radius` (used by packed-atlas
// detection to merge nearby blobs).
export function dilateMask(mask, w, h, radius) {
  if (radius <= 0) return mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
    }
  }
  return out;
}
