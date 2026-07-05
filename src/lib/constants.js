/* ------------------------------------------------------------------ */
/* Tuning constants                                                    */
/* Kept in one reviewable place so the algorithm bodies stay readable. */
/* ------------------------------------------------------------------ */

// A pixel counts as "visible" foreground once its alpha clears this.
// Used for transparency stats, trimming, and packed-sprite masks.
export const ALPHA_VISIBLE = 8;

// Debounce for the live mask recompute (ms).
export const MASK_DEBOUNCE_MS = 50;

// Border auto-sampling (used by grid auto-detect): how finely to walk the
// border, how coarsely to quantise colours, how far apart kept palette
// colours must be, and how many distinct background colours to keep.
export const BORDER_SAMPLE_DIVISOR = 96;
export const BORDER_QUANT = 16;
export const BORDER_MERGE_DIST = 38;
export const BORDER_MAX_KEYS = 4;

// Anchored shadow detection: max per-channel deviation from a pure
// darkening of the clicked background before a pixel counts as "colored",
// and the darkness floor below which background noise is ignored.
export const SHADOW_NEUTRAL_TOL = 12;
export const SHADOW_NOISE_FLOOR = 0.03;

// Chroma-key: dark pixels carry almost no chroma information, so their
// residual against the scaled key is judged against at least this fraction
// of the key's brightness (stops near-black object pixels reading as deep
// key shadow).
export const CHROMA_DARK_FLOOR = 0.35;

// Packed-atlas sprite detection defaults.
export const ATLAS_DEFAULTS = { alphaThreshold: 72, minArea: 320, mergeDistance: 2, padding: 24 };
// Slack applied to the estimated atlas width so shelves are not over-packed.
export const ATLAS_AREA_SLACK = 1.15;
