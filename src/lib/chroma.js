/* ------------------------------------------------------------------ */
/* Chroma-key engine (green / magenta screen shots)                     */
/*                                                                     */
/* Same click-driven workflow as the wand, different math. With no      */
/* clicks the configured key color (default #00ff00) is used, so a      */
/* standard green screen keys out with zero interaction. A clicked      */
/* screen color keys out EVERY brightness of itself — the shadowed      */
/* screen floods away in the same click — and a decontamination pass    */
/* strips the key color that bleeds into sprite edges, which is why a   */
/* plain wand cutout of a chroma shot keeps a green/magenta fringe.     */
/*                                                                     */
/* Layer 1 (object): per click, GLOBAL selection of every pixel that    */
/* is a neutral re-lighting of the clicked color (p ≈ s·K) — unlike     */
/* the wand there is no contiguity requirement, because screen color    */
/* trapped in enclosed pockets (between leaves, under handles) must     */
/* key out too. Refined with the same contract → smooth → feather       */
/* recipe, then cleared.                                                */
/* Layer 2 (shadow): keyed-out pixels darker than the key come back as  */
/* translucent black. Unlike the wand there is no separate neutrality   */
/* test — the luma-invariant keying already proved the pixel is a       */
/* re-lit screen color, so darkness alone decides (the wand's fixed     */
/* per-channel tolerance punches holes in the shadows of saturated      */
/* low-luma screens like magenta).                                      */
/* Decontamination: key-dominance despill — every pixel near the cut    */
/* (and ALL cleared pixels, so texture filtering in a game engine can   */
/* never bleed the screen color out of transparent texels) loses the    */
/* key chroma in proportion to how key-dominant it is. Luma is          */
/* preserved exactly and colors that are not key-tinted are untouched,  */
/* so genuinely green foliage away from the edge survives a green       */
/* screen.                                                              */
/* ------------------------------------------------------------------ */
import { hexToRgb, luminance, transparentPct } from './color.js';
import { contractSel, smoothSel, blurSel } from './wand.js';
import { CHROMA_DARK_FLOOR, SHADOW_NOISE_FLOOR } from './constants.js';

// Residual of pixel i against the best neutral re-lighting s·K of key K
// (least-squares scale, max per-channel remainder — same units as the wand
// tolerance). Dark pixels carry almost no chroma signal, so the residual is
// judged against at least CHROMA_DARK_FLOOR of the key's brightness —
// otherwise near-black object pixels read as deep key shadow and get eaten.
function keyResidual(d, i, K, KK) {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  let s = (r * K[0] + g * K[1] + b * K[2]) / KK;
  if (s < 0) s = 0;
  const res = Math.max(
    Math.abs(r - s * K[0]),
    Math.abs(g - s * K[1]),
    Math.abs(b - s * K[2]),
  );
  return res / Math.max(CHROMA_DARK_FLOOR, Math.min(1, s));
}

// Global key selection with the luma-invariant metric: one click selects
// every brightness of the screen color EVERYWHERE in the image — shadows,
// vignette and enclosed pockets a contiguous flood could never reach.
// Rejected pixels near the tolerance get a fractional (anti-aliased)
// selection over a second tolerance band, like the wand's flood edge.
function selectKey(d, w, h, K, tolerance, sel) {
  const KK = Math.max(1, K[0] * K[0] + K[1] * K[1] + K[2] * K[2]);
  const tol = Math.max(0, tolerance);
  const soft = Math.max(1, tol); // AA band width beyond the hard tolerance
  for (let p = 0, i = 0; p < sel.length; p++, i += 4) {
    const res = keyResidual(d, i, K, KK);
    if (res <= tol) { sel[p] = 255; continue; }
    const frac = 1 - (res - tol) / soft;
    if (frac > 0) { const v = Math.round(255 * frac); if (v > sel[p]) sel[p] = v; }
  }
}

// The chroma recipe. seeds: [{x, y, tolerance?}] in image pixels — a seed may
// carry its own tolerance (stamped at click time); opts.tolerance is the
// fallback and covers the configured key color. Returns a fresh canvas.
export function chromaCutout(sourceCanvas, seeds, opts) {
  const {
    tolerance = 20, contract = 1, smooth = 2, feather = 1,
    shadow = true, shadowStrength = 100,
    despill = 100, despillReach = 3, despillTone = 100,
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
  const keys = [];
  for (const s of seeds) {
    const x = Math.min(w - 1, Math.max(0, Math.round(s.x)));
    const y = Math.min(h - 1, Math.max(0, Math.round(s.y)));
    const i = (y * w + x) * 4;
    keys.push({ K: [d[i], d[i + 1], d[i + 2]], tol: s.tolerance ?? tolerance });
  }
  // No clicks yet: fall back to the configured key color, so a standard
  // green/magenta screen keys out with zero interaction.
  if (!keys.length && opts.key) keys.push({ K: hexToRgb(opts.key), tol: tolerance });
  for (const k of keys) selectKey(d, w, h, k.K, k.tol, sel);

  // The raw selection drives decontamination: refinement (contract/smooth)
  // can annihilate small key pockets, but their color must still be
  // decontaminated even where the refined alpha keeps them opaque.
  const selRaw = sel.slice();

  if (contract) contractSel(sel, w, h, contract);
  if (smooth > 0) smoothSel(sel, w, h, smooth);
  if (feather > 0) blurSel(sel, w, h, feather);

  // Shadow darkness must be measured before decontamination repaints the
  // cleared pixels, so read it up front from the original colors. A keyed
  // pixel needs no further neutrality test — selection already proved it is
  // a re-lit screen color — so its darkness vs the unshadowed screen is the
  // shadow opacity, weighted by how strongly it keyed (raw selection, so
  // the AA rim of a shadow fades instead of stepping).
  //
  // The reference brightness comes from the SELECTION (95th percentile of
  // fully-selected luma), not from the nominal key color: a default #00ff00
  // key is brighter than any real rendered screen, and measuring darkness
  // against it would veil the whole background in faint shadow alpha.
  const strength = shadowStrength / 100;
  let dark = null;
  if (shadow && keys.length) {
    const hist = new Uint32Array(256);
    let selCount = 0;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (selRaw[p] >= 250) {
        hist[Math.min(255, Math.round(luminance(d[i], d[i + 1], d[i + 2])))]++;
        selCount++;
      }
    }
    let Lref = 0;
    if (selCount) {
      let acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= selCount * 0.95) { Lref = v; break; } }
    } else {
      for (const { K } of keys) Lref = Math.max(Lref, luminance(K[0], K[1], K[2]));
    }
    if (Lref >= 8) { // a black screen leaves no headroom for shadows
      dark = new Float32Array(w * h);
      for (let p = 0, i = 0; p < dark.length; p++, i += 4) {
        const conf = selRaw[p] / 255;
        if (!conf) continue;
        const L = luminance(d[i], d[i + 1], d[i + 2]);
        const v = Math.max(0, (1 - L / Lref) - SHADOW_NOISE_FLOOR) / (1 - SHADOW_NOISE_FLOOR);
        dark[p] = v * conf;
      }
    }
  }

  // Decontamination: strip key spill from pixel colors, preserving
  // brightness. How key-tinted a pixel is comes from the key's own channel
  // ranking (green screen: G above both R and B; magenta: R and B above G),
  // NOT from a chroma-axis projection — an axis projection cross-talks with
  // innocent colors that merely share a component with the key (warm creams
  // read as part green). Subtracting the key's zero-luma chroma scaled by
  // that dominance turns pure screen pixels into exact neutral gray and
  // leaves creams / oranges / blues untouched. The weight is full on the
  // cut and fades to 0 `despillReach` px inside the object, so key-colored
  // detail away from the edge (real foliage on a green screen) survives;
  // cleared pixels are always fully decontaminated so texture filtering in
  // a game engine can never bleed the screen color out of transparent
  // texels.
  if (keys.length && despill > 0) {
    const K = [0, 1, 2].map(c => keys.reduce((s, k) => s + k.K[c], 0) / keys.length);
    const Lk = luminance(K[0], K[1], K[2]);
    const cK = [K[0] - Lk, K[1] - Lk, K[2] - Lk]; // zero-luma key chroma
    const [top, mid, low] = [0, 1, 2].sort((a, b) => K[b] - K[a]);
    // Dual-dominant key (magenta / cyan / yellow screens): the middle
    // channel sits nearer the top one than the bottom one.
    const dual = (K[top] - K[mid]) < (K[mid] - K[low]);
    const domK = dual
      ? Math.min(cK[top], cK[mid]) - cK[low]
      : cK[top] - Math.max(cK[mid], cK[low]);
    if (domK > 20) { // a near-neutral key has no spill worth chasing
      // Chessboard distance to the cleared region (two-pass chamfer) —
      // distance-based rather than area-based, so even a few cleared pixels
      // trapped in a crevice give their whole rim full decontamination
      // strength, where a blur of the mask would fade with pocket size.
      const FAR = 250;
      const dist = new Uint8Array(w * h);
      for (let p = 0; p < dist.length; p++) dist[p] = selRaw[p] >= 128 ? 0 : FAR;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!dist[p]) continue;
        let m = dist[p];
        if (x > 0) m = Math.min(m, dist[p - 1] + 1);
        if (y > 0) {
          m = Math.min(m, dist[p - w] + 1);
          if (x > 0) m = Math.min(m, dist[p - w - 1] + 1);
          if (x + 1 < w) m = Math.min(m, dist[p - w + 1] + 1);
        }
        dist[p] = m;
      }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const p = y * w + x;
        if (!dist[p]) continue;
        let m = dist[p];
        if (x + 1 < w) m = Math.min(m, dist[p + 1] + 1);
        if (y + 1 < h) {
          m = Math.min(m, dist[p + w] + 1);
          if (x + 1 < w) m = Math.min(m, dist[p + w + 1] + 1);
          if (x > 0) m = Math.min(m, dist[p + w - 1] + 1);
        }
        dist[p] = m;
      }
      const amt = despill / 100;
      const reach = Math.max(1, despillReach);
      // Tone of the neutralized residue: the removed key amount m carries
      // m·Lk of screen brightness with it; 100% keeps that brightness in
      // place (pure luma-preserving despill), 0% subtracts it (residue goes
      // black, like a shadowed rim), 200% doubles it (residue goes white).
      // Scaled by m, so pixels without key tint never shift.
      const tone = (despillTone - 100) / 100;
      for (let p = 0, i = 0; p < sel.length; p++, i += 4) {
        const band = dist[p] <= 1 ? 1 : Math.max(0, 1 - (dist[p] - 1) / reach);
        const wt = Math.max(band, selRaw[p] / 255) * amt;
        if (wt <= 0) continue;
        const e = dual
          ? Math.min(d[i + top], d[i + mid]) - d[i + low]
          : d[i + top] - Math.max(d[i + mid], d[i + low]);
        if (e <= 0) continue;
        const m = (e / domK) * wt;
        d[i] -= m * cK[0]; d[i + 1] -= m * cK[1]; d[i + 2] -= m * cK[2];
        if (tone) {
          const dL = tone * m * Lk;
          d[i] += dL; d[i + 1] += dL; d[i + 2] += dL;
        }
      }
    }
  }

  for (let p = 0, i = 0; p < sel.length; p++, i += 4) {
    const aO = (d[i + 3] / 255) * (255 - sel[p]) / 255; // layer 1 cleared
    let aS = 0;
    if (dark && aO < 1) aS = Math.min(1, dark[p] * strength) * (d[i + 3] / 255) * (1 - aO);
    const aF = aO + aS;
    if (aS > 0 && aF > 0) {
      // Shadow contributes as translucent BLACK (see wand.js).
      const f = aO / aF;
      d[i] = Math.round(d[i] * f); d[i + 1] = Math.round(d[i + 1] * f); d[i + 2] = Math.round(d[i + 2] * f);
    }
    d[i + 3] = Math.round(255 * aF);
  }

  ctx.putImageData(image, 0, 0);
  return { canvas: out, transparentPct: transparentPct(d, w * h) };
}
