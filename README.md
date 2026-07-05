# PixelKit

PixelKit is a local-first browser app for removing backgrounds from game UI assets, icons, and sprite sheets. It focuses on sharp UI edges, pixel-art-friendly previews, soft contact-shadow preservation, and atlas export workflows.

All processing runs in the browser with the Canvas API. Images are not uploaded to a server.

## Features

### Background Removal

- Magic-wand mode: click one or more background or shadow-tone areas to union contiguous selections.
- Chroma key mode: use the configured key color or click the canvas to pick a key color for green/magenta screen captures.
- Exposed refine controls for tolerance, contract, smooth, feather, and chroma despill.
- Optional soft-shadow recovery for neutral darkening on cleared background pixels.
- Keep, erase, and subtract regions for manual lasso or rectangle corrections.
- Mask overlay, before/after preview, pan, zoom, and checker/dark/light/magenta backgrounds.

### Sprite And Atlas Workflow

- Packed atlas detection for randomly packed sprites.
- Uniform grid mode for true fixed-frame animation sheets.
- Per-sprite exclude toggles and locked frame boxes for stable packed animations.
- Animation preview and alpha-preserving APNG export.
- Export transparent PNGs, sprite ZIP files, packed atlas PNG + JSON, copied PNGs, and sheets with alpha.

## Keyboard Shortcuts

- `Ctrl+Z`: undo the last seed click.
- `L`: lasso tool.
- `B`: hold to show the original image.
- `C`: copy the current result.
- `E`: export.
- `?`: help overlay.

## Tech Stack

- Vite + React
- Canvas API
- Self-hosted Inter font via `@fontsource-variable/inter`
- `lucide-react` icons
- Dependency-free ZIP and APNG encoders

## Architecture

The image-processing logic lives in small, framework-free modules under `src/lib/`:

- `wand.js`: magic-wand selection, selection refinement, and shadow reconstruction.
- `chroma.js`: luma-invariant chroma keying, despill, and chroma shadow handling.
- `regions.js`: keep/erase/subtract rasterization.
- `atlas.js`: grid detection, packed sprite detection, and atlas packing.
- `canvas.js`, `color.js`, `sampling.js`, `morphology.js`: shared pure helpers.
- `zip.js`, `apng.js`: export encoders.
- `presets.js`, `constants.js`: default options and tuning constants.

React orchestration lives in `src/App.jsx`, components live in `src/components/`, and localStorage-backed state lives in `src/hooks/usePersistentState.js`.

## Local Development

```bash
npm install
npm run dev
```

Vite prints the local development URL. If port `5173` is busy, Vite chooses another available port.

## Production Build

```bash
npm run build
```

The production bundle is written to `dist/`.

## Static Hosting

The current Vite config uses:

```js
base: '/pixelkit/'
```

That matches hosting the app from a `/pixelkit/` subpath, such as GitHub Pages for a repository named `pixelkit`. If you host PixelKit at a domain root, change the base path to `/` before building.

## License

MIT
