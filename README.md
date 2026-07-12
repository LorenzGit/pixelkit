# PixelKit

PixelKit is a local-first app for removing backgrounds from game UI assets, icons, and sprite sheets. It focuses on sharp UI edges, pixel-art-friendly previews, soft contact-shadow preservation, and atlas export workflows.

Magic-wand and chroma processing run entirely in the browser. The optional BiRefNet v2 mode sends an image only to the local PixelKit inference server; it never calls a third-party inference API.

## Features

### Background Removal

- Magic-wand mode: click one or more background or shadow-tone areas to union contiguous selections.
- Chroma key mode: use the configured key color or click the canvas to pick a key color for green/magenta screen captures.
- Exposed refine controls for tolerance, contract, smooth, feather, and chroma despill.
- Optional soft-shadow recovery for neutral darkening on cleared background pixels.
- Password-gated local BiRefNet v2 inference with Light, Light 2K, Heavy, Matting, Portrait, and Dynamic profiles.
- BiRefNet 1024/2048/2304 operating sizes, foreground refinement, mask export/mask-only, and PNG/WebP/GIF output.
- Optional BiRefNet soft-shadow recovery with automatic border sampling or manually clicked background samples, adjustable strength, and color sensitivity.
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

The Canvas tools work with only Vite. To enable BiRefNet, install the CPU inference service and run it in a second terminal:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
pip install -r requirements-birefnet.txt
npm run api
```

Vite proxies `/api` to port 8000. BiRefNet defaults to the simple password `ciao`; override it with `PIXELKIT_BIREFNET_PASSWORD`. Each selected model is downloaded from its official ZhengPeng7 Hugging Face repository on first use and cached. Only one inference job runs at a time to stay within this machine's RAM.

## Production Build

```bash
npm run build
PIXELKIT_BIREFNET_PASSWORD=ciao npm run api
```

The production bundle is written to `dist/`; `server.py` serves both that bundle and the BiRefNet API on port 8000.

## Static Hosting

Static hosting supports the Canvas modes but not BiRefNet. Run `server.py` for the password-gated AI mode.

## License

MIT
