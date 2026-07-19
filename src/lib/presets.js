/* ------------------------------------------------------------------ */
/* Default settings and static configuration                           */
/* ------------------------------------------------------------------ */
import { ATLAS_DEFAULTS } from './constants.js';

// Removal parameters (persisted), per mode so each keeps its own tuning.
// Wand seeds are per-image session state, not part of opts. Wand defaults
// mirror the reference Photoshop workflow (tolerance 20 → contract 1 →
// smooth 2 → feather 1); chroma defaults are the user's chroma-screen
// recipe, including the #00ff00 key so a standard green screen keys out
// with zero clicks (a click overrides the key color).
export const WAND_DEFAULTS = { tolerance: 20, contract: 1, smooth: 2, feather: 1 };
export const CHROMA_DEFAULTS = {
  key: '#00ff00',
  tolerance: 28,
  contract: 0.7,
  smooth: 0.7,
  feather: 0.3,
  despill: 100,
  despillReach: 5,
  despillTone: 0,
};
// The sprite preset favours alpha quality over raw speed. 1024 keeps it
// practical on PixelKit's CPU host while the matting weights and foreground
// refinement preserve antialiased UI edges and soft contact shadows.
export const BIREFNET_DEFAULTS = {
  model: 'Matting',
  operatingResolution: '1024x1024',
  refineForeground: true,
  outputMask: true,
  maskOnly: false,
  outputFormat: 'png',
  recoverShadows: true,
  shadowStrength: 100,
  shadowTolerance: 12,
  shadowSampling: 'auto',
};
export const DEFAULT_OPTS = {
  mode: 'wand', // 'wand' | 'chroma' | 'birefnet'
  wand: { ...WAND_DEFAULTS },
  chroma: { ...CHROMA_DEFAULTS },
  birefnet: { ...BIREFNET_DEFAULTS },
  shadow: true,
  shadowStrength: 100,
};

export const DEFAULT_GRID = { rows: 4, cols: 4, margin: 0, spacing: 0 };
export const DEFAULT_DETECT = { ...ATLAS_DEFAULTS };
export const DEFAULT_PACK = { padding: 2, extrude: true };

// Solid preview backgrounds (checkerboard is handled by a CSS class).
export const PREVIEW_BG = { checker: null, dark: '#11131a', light: '#e9edf5', magenta: '#ff00ff' };

// Atlas JSON serialisers, keyed by format id. Each receives
// ({ frames, width, height, baseName }) and returns a JSON string.
export const ATLAS_FORMATS = {
  texturepacker: {
    label: 'TexturePacker',
    ext: 'json',
    serialize: ({ frames, width, height, baseName }) => JSON.stringify({
      frames: Object.fromEntries(frames.map(f => [f.name, {
        frame: { x: f.x, y: f.y, w: f.w, h: f.h },
        rotated: false, trimmed: true,
        spriteSourceSize: { x: f.ox, y: f.oy, w: f.w, h: f.h },
        sourceSize: { w: f.srcW, h: f.srcH },
      }])),
      meta: { app: 'PixelKit', version: '1.0', image: `${baseName}-atlas.png`, format: 'RGBA8888', size: { w: width, h: height }, scale: 1 },
    }, null, 2),
  },
  phaser3: {
    label: 'Phaser 3',
    ext: 'json',
    serialize: ({ frames, width, height, baseName }) => JSON.stringify({
      textures: [{
        image: `${baseName}-atlas.png`, format: 'RGBA8888', size: { w: width, h: height }, scale: 1,
        frames: frames.map(f => ({
          filename: f.name,
          frame: { x: f.x, y: f.y, w: f.w, h: f.h },
          rotated: false, trimmed: true,
          spriteSourceSize: { x: f.ox, y: f.oy, w: f.w, h: f.h },
          sourceSize: { w: f.srcW, h: f.srcH },
        })),
      }],
      meta: { app: 'PixelKit', version: '1.0' },
    }, null, 2),
  },
  json: {
    label: 'Plain JSON',
    ext: 'json',
    serialize: ({ frames, width, height }) => JSON.stringify({
      size: { w: width, h: height },
      frames: frames.map(f => ({ name: f.name, x: f.x, y: f.y, w: f.w, h: f.h, sourceW: f.srcW, sourceH: f.srcH })),
    }, null, 2),
  },
};
