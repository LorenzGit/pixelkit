import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, Download, Grid3X3, Image as ImageIcon, Scissors, Sparkles, Wand2,
  Layers, Trash2, RotateCcw, Boxes, Maximize2, SunMedium, Moon, Square,
  Hexagon, Crop, FileJson, FileArchive, Copy, HelpCircle, Clapperboard,
  Lasso, Undo2, Eye, Film, LayoutGrid,
  BrainCircuit, LockKeyhole, Play, Pause, ImageDown,
} from 'lucide-react';

import { clamp, hexToRgb, rgbToHex, transparentPct } from './lib/color.js';
import { drawImageToCanvas, loadImage, dataURL, canvasToBlob, scaleCanvas, trimCanvas } from './lib/canvas.js';
import { wandCutout } from './lib/wand.js';
import { chromaCutout } from './lib/chroma.js';
import { applyRegions } from './lib/regions.js';
import { packAtlas, autoDetectGrid, extractPackedSprites } from './lib/atlas.js';
import { buildZip, canvasToPngBytes, downloadBlob, downloadCanvas, strBytes } from './lib/zip.js';
import { encodeAPNG } from './lib/apng.js';
import { loadVideo, releaseVideo, extractVideoFrames, frameTimes, thumbnailURL, formatTime } from './lib/video.js';
import { sheetLayout, drawSpriteSheet, sheetFrameRecords } from './lib/sheet.js';
import {
  DEFAULT_OPTS, DEFAULT_GRID, DEFAULT_DETECT, DEFAULT_PACK, DEFAULT_VIDEO, DEFAULT_SHEET,
  PREVIEW_BG, ATLAS_FORMATS, BIREFNET_DEFAULTS,
} from './lib/presets.js';
import { MASK_DEBOUNCE_MS, MAX_VIDEO_FRAMES, VIDEO_THUMB_PX } from './lib/constants.js';

import { usePersistentState } from './hooks/usePersistentState.js';
import { Section, Range, Seg, Toggle } from './components/controls.jsx';
import { CanvasStage } from './components/CanvasStage.jsx';
import { VideoStage } from './components/VideoStage.jsx';
import { SheetAnimation } from './components/SheetAnimation.jsx';
import { AnimPreview } from './components/AnimPreview.jsx';
import { HelpOverlay } from './components/HelpOverlay.jsx';

const cropCenter = (cut, w, h) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cut, Math.round((w - cut.width) / 2), Math.round((h - cut.height) / 2));
  return c;
};

// Composite a set of trimmed frames onto a shared max-size box (centred) so a
// packed animation no longer jitters frame-to-frame. Returns uniform canvases.
function boxFrames(frames) {
  if (!frames.length) return frames;
  const w = Math.max(...frames.map(f => f.cut.width));
  const h = Math.max(...frames.map(f => f.cut.height));
  return frames.map(f => {
    const c = cropCenter(f.cut, w, h);
    return { ...f, cut: c, url: dataURL(c), w, h, fw: w, fh: h };
  });
}

function buildOverlay(result) {
  const w = result.width, h = result.height;
  if (!w || !h) return null;
  const src = result.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(w, h);
  const od = out.data;
  for (let i = 0; i < src.length; i += 4) { od[i] = 255; od[i + 1] = 40; od[i + 2] = 140; od[i + 3] = 255 - src[i + 3]; }
  ctx.putImageData(out, 0, 0);
  return c.toDataURL('image/png');
}

async function dataUriToCanvas(uri) {
  const blob = await fetch(uri).then(r => r.blob());
  const loaded = await loadImage(blob);
  try { return drawImageToCanvas(loaded.img); }
  finally { URL.revokeObjectURL(loaded.url); }
}

export default function App() {
  // Persisted settings ------------------------------------------------------
  const [opts, setOpts] = usePersistentState('pixelkit:v4:opts', DEFAULT_OPTS);
  const [grid, setGrid] = usePersistentState('pixelkit:v1:grid', DEFAULT_GRID);
  const [detect, setDetect] = usePersistentState('pixelkit:v1:detect', DEFAULT_DETECT);
  const [pack, setPack] = usePersistentState('pixelkit:v1:pack', DEFAULT_PACK);
  const [sheetMode, setSheetMode] = usePersistentState('pixelkit:v1:sheetMode', 'packed');
  const [previewBg, setPreviewBg] = usePersistentState('pixelkit:v1:previewBg', 'checker');
  const [exportScale, setExportScale] = usePersistentState('pixelkit:v1:exportScale', 1);
  const [trimExport, setTrimExport] = usePersistentState('pixelkit:v1:trimExport', false);
  const [pixelView, setPixelView] = usePersistentState('pixelkit:v1:pixelView', false);
  const [lockFrameBox, setLockFrameBox] = usePersistentState('pixelkit:v1:lockFrameBox', false);
  const [atlasFormat, setAtlasFormat] = usePersistentState('pixelkit:v1:atlasFormat', 'texturepacker');
  const [videoOpts, setVideoOpts] = usePersistentState('pixelkit:v1:video', DEFAULT_VIDEO);
  const [sheetOpts, setSheetOpts] = usePersistentState('pixelkit:v1:sheet', DEFAULT_SHEET);

  // Session state -----------------------------------------------------------
  const [tab, setTab] = useState('single');
  const [file, setFile] = useState(null);
  const [img, setImg] = useState(null);
  const [url, setUrl] = useState(null);
  const [baseResult, setBaseResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [birefPassword, setBirefPassword] = useState('');
  const [birefUnlocked, setBirefUnlocked] = useState(false);
  const [birefMask, setBirefMask] = useState(null);
  const [birefOriginal, setBirefOriginal] = useState(null);
  const [birefElapsed, setBirefElapsed] = useState(0);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [maskOverlay, setMaskOverlay] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [beforeHold, setBeforeHold] = useState(false);

  // Wand seeds: background points the user clicked (per image, not persisted).
  // Each seed carries the tolerance it was clicked at; selecting its chip
  // rebinds the Tolerance slider to that one sample.
  const [seeds, setSeeds] = useState([]);
  const [selectedSeedId, setSelectedSeedId] = useState(null);
  const seedIdRef = useRef(0);

  // User-drawn keep / erase / subtract regions (per image, not persisted).
  const [regions, setRegions] = useState([]);
  const [regionTool, setRegionTool] = useState(null); // null | 'poly' | 'rect'
  const [regionEffect, setRegionEffect] = useState('keep');

  const [fps, setFps] = useState(12);
  const [playing, setPlaying] = useState(true);
  const [onion, setOnion] = useState(false);

  const [excluded, setExcluded] = useState({});

  // Video → sheet workspace (per video, not persisted). rawFrames holds one
  // full-size canvas per sampled timestamp; cutFrames holds what survived the
  // removal + trim pass, keyed back to the raw frame index.
  const [videoFile, setVideoFile] = useState(null);
  const [videoEl, setVideoEl] = useState(null); // the live <video>, mounted by the stage
  const [videoMeta, setVideoMeta] = useState(null); // { duration, width, height }
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [rawFrames, setRawFrames] = useState([]);
  const [cutFrames, setCutFrames] = useState([]);
  const [frameOff, setFrameOff] = useState({}); // raw index → left out of the sheet
  const [previewIndex, setPreviewIndex] = useState(0);
  const [videoView, setVideoView] = useState('video');
  const [progress, setProgress] = useState(null); // { label, done, total }
  const videoRef = useRef(null);
  const cancelRef = useRef(false);

  const [showHelp, setShowHelp] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const flash = useCallback(msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  // The video workspace feeds the frame under inspection into the very same
  // removal pipeline as a still image, so every wand / chroma / shadow control
  // previews live on a real frame before the whole clip is processed.
  const previewFrame = rawFrames.length ? rawFrames[Math.min(previewIndex, rawFrames.length - 1)] : null;
  const originalCanvas = useMemo(
    () => (tab === 'video' ? previewFrame?.canvas || null : (img ? drawImageToCanvas(img) : null)),
    [img, tab, previewFrame],
  );

  // The active mode's parameter block (each mode keeps its own tuning).
  const modeKey = opts.mode === 'birefnet' ? 'birefnet' : (opts.mode === 'chroma' ? 'chroma' : 'wand');
  const cur = { ...DEFAULT_OPTS[modeKey], ...(opts[modeKey] || {}) };
  const setCur = useCallback(
    patch => setOpts(o => ({ ...o, [modeKey]: { ...(o[modeKey] || DEFAULT_OPTS[modeKey]), ...patch } })),
    [modeKey, setOpts],
  );

  // File input --------------------------------------------------------------
  // A video and an image are mutually exclusive sources: loading either one
  // clears the other so the pipeline only ever has one thing to work on.
  const onVideoFile = useCallback(async (f) => {
    setError(null); setBusy(true);
    try {
      const handle = await loadVideo(f);
      releaseVideo(videoRef.current);
      videoRef.current = handle;
      setVideoFile(f); setVideoEl(handle.video);
      setVideoMeta({ duration: handle.duration, width: handle.width, height: handle.height });
      setRange({ start: 0, end: +handle.duration.toFixed(2) });
      setRawFrames([]); setCutFrames([]);
      setFrameOff({}); setPreviewIndex(0); setVideoView('video');
      setFile(null); setImg(null); setUrl(null); setBaseResult(null); setBirefMask(null); setBirefOriginal(null);
      setSeeds([]); setSelectedSeedId(null); setRegions([]); setRegionTool(null); setShowBefore(false);
      setTab('video');
    } catch (err) {
      console.error('[PixelKit video open failed]', err);
      setError(err.message || 'Could not open that video.');
    } finally { setBusy(false); }
  }, []);

  const onFile = useCallback(async (f) => {
    if (!f) return;
    if (f.type.startsWith('video/')) { onVideoFile(f); return; }
    if (!f.type.startsWith('image/')) return;
    try {
      const loaded = await loadImage(f);
      setUrl(loaded.url); // previous URL is revoked by the cleanup effect below
      setFile(f); setImg(loaded.img); setBaseResult(null); setBirefMask(null); setBirefOriginal(null); setError(null);
      setZoom(1); setPan({ x: 0, y: 0 }); setExcluded({});
      setSeeds([]); setSelectedSeedId(null); setRegions([]); setRegionTool(null); setShowBefore(false);
      setVideoFile(null); setVideoEl(null); setVideoMeta(null); setRawFrames([]); setCutFrames([]);
      releaseVideo(videoRef.current); videoRef.current = null;
      if (tab === 'video') setTab('single');
    } catch {
      setError('Could not open that image.');
    }
  }, [onVideoFile, tab]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => releaseVideo(videoRef.current), []);
  useEffect(() => { if (zoom <= 1 && (pan.x || pan.y)) setPan({ x: 0, y: 0 }); }, [zoom]); // eslint-disable-line

  // Live recompute of the wand recipe (debounced, cancellable) --------------
  useEffect(() => {
    if (!originalCanvas) { setBaseResult(null); return; }
    if (opts.mode === 'birefnet') { setBaseResult(null); setBirefMask(null); setBirefOriginal(null); setBusy(false); return; }
    let cancelled = false;
    setBusy(true); setError(null);
    const t = setTimeout(() => {
      try {
        const cutout = opts.mode === 'chroma' ? chromaCutout : wandCutout;
        const r = cutout(originalCanvas, seeds, { ...cur, shadow: opts.shadow, shadowStrength: opts.shadowStrength });
        if (!cancelled) setBaseResult(r.canvas);
      } catch (err) {
        if (cancelled) return;
        console.error('[PixelKit mask failed]', err);
        setError('Background removal failed for this image.'); setBaseResult(null);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, MASK_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [originalCanvas, seeds, opts]);

  useEffect(() => {
    if (!busy || opts.mode !== 'birefnet') { setBirefElapsed(0); return undefined; }
    const started = Date.now();
    const timer = setInterval(() => setBirefElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy, opts.mode]);

  async function unlockBirefNet(e) {
    e?.preventDefault();
    setError(null);
    try {
      const response = await fetch('/api/birefnet/unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: birefPassword }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Incorrect BiRefNet password.' : 'BiRefNet server is unavailable.');
      setBirefUnlocked(true); flash('BiRefNet unlocked for this browser session');
    } catch (err) { setError(err.message); }
  }

  async function runBirefNet() {
    if (!originalCanvas || !birefUnlocked || busy) return;
    setBusy(true); setError(null); setBirefMask(null);
    try {
      const blob = await canvasToBlob(originalCanvas, 'image/png');
      const form = new FormData();
      form.append('image', blob, file?.name || 'pixelkit.png');
      form.append('model', cur.model);
      form.append('operating_resolution', cur.operatingResolution);
      form.append('refine_foreground_enabled', String(cur.refineForeground));
      form.append('decontaminate', String(cur.decontaminate));
      form.append('decontaminate_tone', String(cur.decontaminateTone));
      form.append('output_mask', String(cur.outputMask));
      form.append('mask_only', String(cur.maskOnly));
      form.append('output_format', cur.outputFormat);
      form.append('recover_soft_shadows_enabled', String(cur.recoverShadows));
      form.append('shadow_strength', String(cur.shadowStrength));
      form.append('shadow_tolerance', String(cur.shadowTolerance));
      form.append('shadow_auto_sample', String(cur.shadowSampling === 'auto'));
      form.append('background_samples', JSON.stringify(seedInfo.map(s => hexToRgb(s.hex))));
      const response = await fetch('/api/birefnet/remove', {
        method: 'POST', headers: { 'X-PixelKit-Password': birefPassword }, body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) setBirefUnlocked(false);
        throw new Error(payload.detail || `BiRefNet failed (${response.status}).`);
      }
      const canvas = await dataUriToCanvas(payload.image);
      setBaseResult(canvas); setBirefMask(payload.mask || null); setBirefOriginal(payload.image);
      flash(`BiRefNet finished at ${cur.operatingResolution}`);
    } catch (err) {
      console.error('[PixelKit BiRefNet failed]', err);
      setError(err.message || 'BiRefNet background removal failed.');
    } finally { setBusy(false); }
  }

  async function downloadBirefMask() {
    if (!birefMask) return;
    downloadBlob(await fetch(birefMask).then(r => r.blob()), `${baseName()}-birefnet-mask.png`);
  }

  async function downloadBirefOriginal() {
    if (!birefOriginal) return;
    downloadBlob(await fetch(birefOriginal).then(r => r.blob()), `${baseName()}-birefnet.${cur.outputFormat}`);
  }

  // Drawn regions are applied on top of the automatic mask, so tweaking a
  // shape never re-runs the wand recipe.
  const result = useMemo(
    () => (baseResult && originalCanvas && regions.length ? applyRegions(baseResult, originalCanvas, regions) : baseResult),
    [baseResult, originalCanvas, regions],
  );

  const stats = useMemo(() => {
    if (!result || !result.width) return { transparentPct: 0 };
    const d = result.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, result.width, result.height).data;
    return { transparentPct: transparentPct(d, result.width * result.height) };
  }, [result]);

  // Seed chips need the color that was clicked (swatch + wand target).
  const seedInfo = useMemo(() => {
    if (!originalCanvas) return [];
    const ctx = originalCanvas.getContext('2d', { willReadFrequently: true });
    return seeds.map(s => {
      const d = ctx.getImageData(s.x, s.y, 1, 1).data;
      return { ...s, hex: rgbToHex(d[0], d[1], d[2]) };
    });
  }, [seeds, originalCanvas]);

  // A new click bakes in the slider's current tolerance (like Photoshop's
  // wand) and becomes the selected sample, so dragging Tolerance right after
  // clicking tunes exactly that click without re-flooding earlier ones.
  const addSeed = useCallback(pt => {
    const id = ++seedIdRef.current;
    setSeeds(s => [...s, { ...pt, tolerance: cur.tolerance ?? 20, id }]);
    setSelectedSeedId(id);
    flash('Background sample added — drag Tolerance to tune it, Ctrl+Z undoes');
  }, [flash, cur.tolerance]);

  const selectedSeed = useMemo(() => seedInfo.find(s => s.id === selectedSeedId) || null, [seedInfo, selectedSeedId]);

  // Paste from clipboard ----------------------------------------------------
  useEffect(() => {
    const handler = e => {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (item) onFile(item.getAsFile());
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [onFile]);

  // Derived previews --------------------------------------------------------
  const resultUrl = useMemo(() => (result ? dataURL(result) : null), [result]);
  const overlayUrl = useMemo(() => (maskOverlay && result ? buildOverlay(result) : null), [maskOverlay, result]);

  // Grid frames slice the finished result, so the wand recipe (whole-sheet
  // clicks) and regions carry into every frame.
  const gridFrames = useMemo(() => {
    if (!result || tab !== 'sprite' || sheetMode !== 'grid') return [];
    const fw = Math.floor((result.width - grid.margin * 2 - grid.spacing * (grid.cols - 1)) / grid.cols);
    const fh = Math.floor((result.height - grid.margin * 2 - grid.spacing * (grid.rows - 1)) / grid.rows);
    if (fw <= 0 || fh <= 0) return [];
    const arr = [];
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      const sx = grid.margin + c * (fw + grid.spacing), sy = grid.margin + r * (fh + grid.spacing);
      arr.push({ cut: cropFrom(result, sx, sy, fw, fh), fw, fh, index: r * grid.cols + c });
    }
    return arr;
  }, [result, grid, tab, sheetMode]);

  const packedFrames = useMemo(() => {
    if (!result || tab !== 'sprite' || sheetMode !== 'packed') return [];
    try { return extractPackedSprites(result, detect); } catch (e) { console.error('[PixelKit packed detection failed]', e); return []; }
  }, [result, tab, sheetMode, detect]);

  const activeFrames = useMemo(() => {
    const raw = sheetMode === 'packed' ? packedFrames : gridFrames;
    return raw.map((f, i) => sheetMode === 'packed'
      ? { ...f, id: `p${f.x},${f.y}`, label: `${f.w}×${f.h}`, url: dataURL(f.cut), fw: f.w, fh: f.h, index: i }
      : { ...f, id: `g${f.index}`, label: String(f.index + 1), url: dataURL(f.cut), index: i });
  }, [packedFrames, gridFrames, sheetMode]);

  const isExcluded = useCallback(f => !!excluded[f.id], [excluded]);
  const toggleExclude = useCallback(f => setExcluded(e => ({ ...e, [f.id]: !e[f.id] })), []);

  // Drop stale exclude keys when re-detection shifts sprite ids, so exclusions
  // can't accumulate or accidentally hide a newly detected sprite.
  useEffect(() => {
    setExcluded(prev => {
      const live = new Set(activeFrames.map(f => f.id));
      let changed = false; const next = {};
      for (const k in prev) { if (live.has(k)) next[k] = prev[k]; else changed = true; }
      return changed ? next : prev;
    });
  }, [activeFrames]);

  const exportFrames = useMemo(() => activeFrames.filter(f => !excluded[f.id]), [activeFrames, excluded]);
  const animFrames = useMemo(
    () => (lockFrameBox && exportFrames.length > 1 ? boxFrames(exportFrames) : exportFrames),
    [lockFrameBox, exportFrames],
  );

  // Video → sheet -----------------------------------------------------------
  // The inspected frame falls back to the raw frame whenever the recipe has no
  // result yet (BiRefNet mode, or the very first debounce tick).
  const framePreviewUrl = useMemo(
    () => (tab !== 'video' ? null : resultUrl || (previewFrame ? dataURL(previewFrame.canvas) : null)),
    [tab, resultUrl, previewFrame],
  );

  const isFrameOff = useCallback(f => !!frameOff[f.index], [frameOff]);
  const toggleFrame = useCallback(f => setFrameOff(o => ({ ...o, [f.index]: !o[f.index] })), []);
  const selectedRaw = useMemo(() => rawFrames.filter(f => !frameOff[f.index]), [rawFrames, frameOff]);

  // The sheet is laid out from the CURRENT selection, so excluding a frame
  // after the fact re-packs the grid — and if the widest or tallest frame was
  // the one excluded, every cell shrinks with it.
  const sheetFrames = useMemo(() => cutFrames.filter(f => !frameOff[f.index]), [cutFrames, frameOff]);
  const sheet = useMemo(() => {
    const layout = sheetLayout(sheetFrames, sheetOpts);
    return layout ? { ...layout, canvas: drawSpriteSheet(layout) } : null;
  }, [sheetFrames, sheetOpts]);

  // Before the removal pass there is nothing cut to animate, but the kept raw
  // frames can still be played back — so frame picking has a preview from the
  // moment frames exist, instead of only after a build.
  const rawPreview = useMemo(() => {
    if (cutFrames.length || !selectedRaw.length) return null;
    const cellW = selectedRaw[0].canvas.width, cellH = selectedRaw[0].canvas.height;
    return {
      raw: true, cellW, cellH,
      cells: selectedRaw.map((f, i) => ({ index: i, frame: { canvas: f.canvas, w: cellW, h: cellH }, ox: 0, oy: 0 })),
    };
  }, [cutFrames.length, selectedRaw]);

  // What the docks and the sidebar play: the packed sheet once it exists,
  // the raw kept frames until then.
  const preview = sheet || rawPreview;

  const plannedFrames = useMemo(
    () => (videoMeta ? frameTimes({ ...range, fps: videoOpts.fps, maxFrames: MAX_VIDEO_FRAMES }).length : 0),
    [videoMeta, range, videoOpts.fps],
  );

  async function extractFrames() {
    const handle = videoRef.current;
    if (!handle || progress) return;
    const times = frameTimes({ ...range, fps: videoOpts.fps, maxFrames: MAX_VIDEO_FRAMES });
    if (!times.length) { flash('That range is empty'); return; }
    cancelRef.current = false;
    setError(null);
    setProgress({ label: 'Extracting frame', done: 0, total: times.length });
    try {
      const frames = await extractVideoFrames(handle.video, {
        times, scale: videoOpts.scale, thumbSize: VIDEO_THUMB_PX,
        onProgress: (done, total) => setProgress({ label: 'Extracting frame', done, total }),
        isCancelled: () => cancelRef.current,
      });
      setRawFrames(frames); setCutFrames([]);
      setFrameOff({}); setPreviewIndex(0); setVideoView('frames');
      flash(`${frames.length} frame${frames.length === 1 ? '' : 's'} extracted — tune the removal, then build`);
    } catch (err) {
      console.error('[PixelKit video extraction failed]', err);
      setError(err.message || 'Could not read frames from that video.');
    } finally { setProgress(null); }
  }

  // Cut and trim EVERY extracted frame, not just the kept ones: once they are
  // all processed, keeping or dropping a frame re-packs the sheet and the
  // animation instantly with no second pass. Sequential with a yield between
  // frames, since each cutout is a full-image pass — that keeps the progress
  // bar and the Stop button alive instead of freezing the tab for a minute.
  async function buildSheet() {
    if (!rawFrames.length || progress || opts.mode === 'birefnet') return;
    cancelRef.current = false;
    setError(null);
    setProgress({ label: 'Removing background from frame', done: 0, total: rawFrames.length });
    const cutout = opts.mode === 'chroma' ? chromaCutout : wandCutout;
    const cuts = [];
    let processed = 0;
    try {
      for (let i = 0; i < rawFrames.length; i++) {
        if (cancelRef.current) break;
        const f = rawFrames[i];
        const cut = cutout(f.canvas, seeds, { ...cur, shadow: opts.shadow, shadowStrength: opts.shadowStrength }).canvas;
        const trimmed = trimCanvas(regions.length ? applyRegions(cut, f.canvas, regions) : cut);
        processed++;
        if (trimmed) {
          cuts.push({
            index: f.index, time: f.time, canvas: trimmed.canvas, w: trimmed.w, h: trimmed.h,
            // Where this frame sat in the source — what keeps the animation
            // from wobbling when the frames are packed (see lib/sheet.js).
            x: trimmed.x, y: trimmed.y,
            thumb: thumbnailURL(trimmed.canvas, VIDEO_THUMB_PX),
          });
        }
        setProgress({ label: 'Removing background from frame', done: i + 1, total: rawFrames.length });
        await new Promise(r => setTimeout(r, 0));
      }
      setCutFrames(cuts);
      if (cuts.length) setVideoView('sheet');
      const empty = processed - cuts.length;
      flash(cuts.length
        ? `${cuts.length} frame${cuts.length === 1 ? '' : 's'} cut and trimmed${empty ? ` · ${empty} came out empty` : ''}`
        : 'Every frame came out empty — the removal is eating the subject');
    } catch (err) {
      console.error('[PixelKit sheet build failed]', err);
      setError('Background removal failed on one of the frames.');
    } finally { setProgress(null); }
  }

  const selectAllFrames = useCallback(() => setFrameOff({}), []);
  const selectNoFrames = useCallback(
    () => setFrameOff(Object.fromEntries(rawFrames.map(f => [f.index, true]))),
    [rawFrames],
  );
  const invertFrames = useCallback(
    () => setFrameOff(o => Object.fromEntries(rawFrames.map(f => [f.index, !o[f.index]]))),
    [rawFrames],
  );

  // Trim handles driven by the player's own playhead.
  const setRangeStart = useCallback(t => setRange(r => ({ ...r, start: Math.min(+t.toFixed(2), r.end) })), []);
  const setRangeEnd = useCallback(t => setRange(r => ({ ...r, end: Math.max(+t.toFixed(2), r.start) })), []);

  // Helpers -----------------------------------------------------------------
  const baseName = () => ((tab === 'video' ? videoFile?.name : file?.name)?.replace(/\.[^.]+$/, '') || 'pixelkit');
  const scaledForExport = c => scaleCanvas(c, exportScale, pixelView);
  const frameSize = sheetMode === 'packed' ? 86 : Math.min(96, Math.max(28, 560 / grid.cols));

  // Settings actions --------------------------------------------------------
  function resetOpts() { setOpts({ ...DEFAULT_OPTS, mode: opts.mode }); flash('Settings reset to the mode defaults'); }

  function autoGrid() {
    if (!originalCanvas) return;
    const tol = seeds.length ? Math.max(...seeds.map(s => s.tolerance ?? cur.tolerance)) : cur.tolerance;
    const g = autoDetectGrid(originalCanvas, { keys: seedInfo.map(s => s.hex), tolerance: tol });
    setGrid(gr => ({ ...gr, cols: g.cols, rows: g.rows }));
  }

  // Exports -----------------------------------------------------------------
  async function exportPNG() {
    if (!result) return;
    let c = result;
    if (trimExport) { const t = trimCanvas(result); if (t) c = t.canvas; }
    await downloadCanvas(scaledForExport(c), `${baseName()}-alpha.png`);
  }

  async function copyResult() {
    let c = null;
    if (tab === 'video') c = sheet ? scaledForExport(sheet.canvas) : null;
    else if (tab === 'single' && result) c = scaledForExport(trimExport ? (trimCanvas(result)?.canvas || result) : result);
    else if (result) c = scaledForExport(result);
    if (!c) return;
    try {
      const blob = await canvasToBlob(c, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash('Copied to clipboard');
    } catch {
      await downloadCanvas(c, `${baseName()}-alpha.png`);
      flash('Clipboard blocked — downloaded instead');
    }
  }

  async function exportSheet() {
    if (sheetMode === 'packed') { if (result) await downloadCanvas(scaledForExport(result), `${baseName()}-alpha-atlas.png`); return; }
    if (!originalCanvas || !exportFrames.length) return;
    const out = document.createElement('canvas');
    out.width = originalCanvas.width; out.height = originalCanvas.height;
    const ctx = out.getContext('2d');
    exportFrames.forEach(f => {
      const c = f.index % grid.cols, r = Math.floor(f.index / grid.cols);
      ctx.drawImage(f.cut, grid.margin + c * (f.fw + grid.spacing), grid.margin + r * (f.fh + grid.spacing));
    });
    await downloadCanvas(scaledForExport(out), `${baseName()}-alpha-sheet.png`);
  }

  async function exportFramesZip() {
    if (!exportFrames.length) return;
    const files = await Promise.all(exportFrames.map(async (f, i) => {
      const c = trimExport ? (trimCanvas(f.cut)?.canvas || f.cut) : f.cut;
      return { name: `${baseName()}_${String(i).padStart(3, '0')}.png`, bytes: await canvasToPngBytes(scaledForExport(c)) };
    }));
    downloadBlob(buildZip(files), `${baseName()}-frames.zip`);
  }

  async function exportAtlas() {
    if (!exportFrames.length) return;
    const items = [];
    exportFrames.forEach((f, i) => {
      // Packed sprites are already standalone cutouts, not trimmed from a larger
      // source frame, so their source offset is zero. (Grid frames keep the real
      // trim offset from trimCanvas.)
      const t = sheetMode === 'packed' ? { canvas: f.cut, w: f.w, h: f.h, x: 0, y: 0 } : trimCanvas(f.cut);
      if (!t) return;
      items.push({ canvas: t.canvas, w: t.w, h: t.h, name: `${baseName()}_${String(i).padStart(3, '0')}.png`, ox: t.x, oy: t.y, srcW: f.fw || f.w, srcH: f.fh || f.h });
    });
    if (!items.length) return;
    const { width, height, placements } = packAtlas(items, pack.padding);
    const sheet = document.createElement('canvas');
    sheet.width = width; sheet.height = height;
    const ctx = sheet.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const frames = [];
    for (const p of placements) {
      const { item, x, y } = p;
      if (pack.extrude && pack.padding > 0) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ctx.drawImage(item.canvas, x + dx, y + dy);
      }
      ctx.drawImage(item.canvas, x, y);
      frames.push({ name: item.name, x, y, w: item.w, h: item.h, ox: item.ox, oy: item.oy, srcW: item.srcW, srcH: item.srcH });
    }
    const fmt = ATLAS_FORMATS[atlasFormat] || ATLAS_FORMATS.texturepacker;
    const json = fmt.serialize({ frames, width, height, baseName: baseName() });
    downloadBlob(buildZip([
      { name: `${baseName()}-atlas.png`, bytes: await canvasToPngBytes(sheet) },
      { name: `${baseName()}-atlas.${fmt.ext}`, bytes: strBytes(json) },
    ]), `${baseName()}-atlas.zip`);
  }

  async function exportAPNG() {
    if (exportFrames.length < 2) { flash('Need at least 2 frames'); return; }
    const frames = boxFrames(exportFrames);
    const blob = encodeAPNG(frames.map(f => scaledForExport(f.cut)), {
      width: Math.round(frames[0].w * exportScale), height: Math.round(frames[0].h * exportScale), fps,
    });
    downloadBlob(blob, `${baseName()}-anim.png`);
    flash('APNG exported');
  }

  async function exportVideoSheet() {
    if (!sheet) return;
    await downloadCanvas(scaledForExport(sheet.canvas), `${baseName()}-sheet.png`);
  }

  // The JSON describes the unscaled grid, so the PNG in the same ZIP is
  // written unscaled too — otherwise every rect in the metadata would lie.
  async function exportVideoSheetAtlas() {
    if (!sheet) return;
    const fmt = ATLAS_FORMATS[atlasFormat] || ATLAS_FORMATS.texturepacker;
    const json = fmt.serialize({
      frames: sheetFrameRecords(sheet, baseName()), width: sheet.width, height: sheet.height, baseName: baseName(),
    });
    downloadBlob(buildZip([
      { name: `${baseName()}-sheet.png`, bytes: await canvasToPngBytes(sheet.canvas) },
      { name: `${baseName()}-sheet.${fmt.ext}`, bytes: strBytes(json) },
    ]), `${baseName()}-sheet.zip`);
  }

  async function exportVideoFramesZip() {
    if (!sheetFrames.length) return;
    const files = await Promise.all(sheetFrames.map(async (f, i) => ({
      name: `${baseName()}_${String(i).padStart(3, '0')}.png`,
      bytes: await canvasToPngBytes(scaledForExport(f.canvas)),
    })));
    downloadBlob(buildZip(files), `${baseName()}-frames.zip`);
  }

  // Each frame is composited into its cell first, so the animation is aligned
  // exactly like the sheet — same cell size, same anchor.
  async function exportVideoAPNG() {
    if (!sheet || sheet.cells.length < 2) { flash('Need at least 2 frames'); return; }
    const boxed = sheet.cells.map(c => {
      const box = document.createElement('canvas');
      box.width = sheet.cellW; box.height = sheet.cellH;
      const ctx = box.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c.frame.canvas, c.ox, c.oy);
      return scaledForExport(box);
    });
    downloadBlob(encodeAPNG(boxed, {
      width: Math.round(sheet.cellW * exportScale), height: Math.round(sheet.cellH * exportScale), fps,
    }), `${baseName()}-anim.png`);
    flash('APNG exported');
  }

  function primaryExport() {
    if (tab === 'single') return exportPNG();
    if (tab === 'video') return exportVideoSheet();
    return exportAtlas();
  }

  // Keyboard shortcuts ------------------------------------------------------
  useEffect(() => {
    // Only text-entry fields swallow shortcuts — checkboxes, sliders and
    // buttons keep them live (so Ctrl+Z works right after moving a slider).
    const typing = el => el && (el.matches?.('textarea,select,[contenteditable],input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=file])'));
    const onKeyDown = e => {
      if (typing(e.target)) return;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) {
        if (seeds.length) { e.preventDefault(); setSeeds(s => s.slice(0, -1)); }
        return;
      }
      if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); setShowHelp(s => !s); return; }
      if (k === 'Escape') { setShowHelp(false); return; }
      if (showHelp) return;
      if (k === ' ') { e.preventDefault(); setPlaying(p => !p); }
      else if (k === 'b' || k === 'B') { setBeforeHold(true); }
      else if (k === 'l' || k === 'L') { if (img && tab === 'single') setRegionTool(t => (t === 'poly' ? null : 'poly')); }
      else if (k === 'c' || k === 'C') { copyResult(); }
      else if (k === 'e' || k === 'E') { primaryExport(); }
      else if (k === '1') setPreviewBg('checker');
      else if (k === '2') setPreviewBg('dark');
      else if (k === '3') setPreviewBg('light');
      else if (k === '4') setPreviewBg('magenta');
      else if (k === '+' || k === '=') setZoom(z => +clamp(z * 1.15, 0.25, 8).toFixed(2));
      else if (k === '-' || k === '_') setZoom(z => +clamp(z / 1.15, 0.25, 8).toFixed(2));
      else if (k === '0') { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    const onKeyUp = e => { if (e.key === 'b' || e.key === 'B') setBeforeHold(false); };
    const onBlur = () => setBeforeHold(false); // never leave the "before" hold stuck
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }); // re-bind each render so handlers see fresh state/closures

  const bgClass = previewBg === 'checker' ? ' bg-checker' : '';
  const bgStyle = previewBg === 'checker' ? undefined : { backgroundColor: PREVIEW_BG[previewBg] };

  return (
    <div className="app">
      <main className="shell">
        {/* LEFT ---------------------------------------------------------- */}
        <aside className="panel left" aria-label="Removal controls">
          <div className="brandrow">
            <div className="logo"><Scissors size={15} aria-hidden="true" /></div>
            <b>PixelKit</b>
            <span className="localtag tipdown" data-tip="Everything runs in your browser — images never leave your machine"><Sparkles size={11} aria-hidden="true" /> 100% local</span>
            <button type="button" className="iconbtn tipdown tipright" aria-label="Help and shortcuts" data-tip="Help & keyboard shortcuts (?)" onClick={() => setShowHelp(true)}><HelpCircle size={15} /></button>
          </div>

          <label className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
            <Upload size={22} aria-hidden="true" />
            <strong>Drop, paste or browse</strong>
            <span>PNG · JPG · WebP · sprite sheets · MP4 · WebM</span>
            <input type="file" accept="image/*,video/*" aria-label="Upload image or video" onChange={e => onFile(e.target.files[0])} />
          </label>

          <div className="tabs three" role="group" aria-label="Workspace">
            <button type="button" className={tab === 'single' ? 'active' : ''} aria-pressed={tab === 'single'} data-tip="One image, one transparent PNG out" onClick={() => setTab('single')}><ImageIcon size={15} /> Single</button>
            <button type="button" className={tab === 'sprite' ? 'active' : ''} aria-pressed={tab === 'sprite'} data-tip="Slice a sprite sheet / texture atlas into frames" onClick={() => setTab('sprite')}><Grid3X3 size={15} /> Atlas</button>
            <button type="button" className={tab === 'video' ? 'active' : ''} aria-pressed={tab === 'video'} data-tip="Turn a video into a sprite sheet: pick frames, remove the background, trim, pack on a grid" onClick={() => setTab('video')}><Film size={15} /> Video</button>
          </div>

          {tab === 'video' && (
            <Section title="Video source" icon={<Film size={15} />}>
              {!videoMeta ? (
                <p className="hint">Drop an MP4, WebM or MOV above. Frames are decoded by this browser — the video never leaves your machine.</p>
              ) : (<>
                <p className="hint">{videoMeta.width}×{videoMeta.height} · {formatTime(videoMeta.duration)} long</p>
                <Range label="Sample rate" tip="How many frames per second to pull out of the clip. 12 fps is a typical sprite-animation cadence; raise it for fast action, lower it for fewer, cleaner frames." value={videoOpts.fps} min={1} max={30} set={v => setVideoOpts({ ...videoOpts, fps: v })} suffix=" fps" />
                <Range label="Start" tip="First timestamp to sample — trim off the lead-in" value={range.start} min={0} max={+videoMeta.duration.toFixed(2)} step={0.05} set={v => setRange(r => ({ ...r, start: Math.min(+v.toFixed(2), r.end) }))} suffix=" s" />
                <Range label="End" tip="Last timestamp to sample — trim off the tail" value={range.end} min={0} max={+videoMeta.duration.toFixed(2)} step={0.05} set={v => setRange(r => ({ ...r, end: Math.max(+v.toFixed(2), r.start) }))} suffix=" s" />
                <Seg
                  label="Extract size" tip="Resolution the frames are grabbed at. Full size keeps every edge detail; halving it makes extraction and the per-frame removal much faster and lighter on memory."
                  value={String(videoOpts.scale)} set={v => setVideoOpts({ ...videoOpts, scale: +v })}
                  options={[['1', '100%', 'Original video resolution'], ['0.5', '50%', 'Half size — 4× faster per frame'], ['0.25', '25%', 'Quarter size — fastest, for rough passes']]}
                />
                <p className="hint">
                  {plannedFrames} frame{plannedFrames === 1 ? '' : 's'} · every {Math.round(1000 / Math.max(1, videoOpts.fps))} ms
                  {plannedFrames >= MAX_VIDEO_FRAMES && ` · capped at ${MAX_VIDEO_FRAMES}, shorten the range or lower the sample rate`}
                </p>
                <button type="button" className="wide" disabled={!!progress} data-tip="Seek through the range and grab one image per timestamp" onClick={extractFrames}>
                  <Film size={14} /> {rawFrames.length ? 'Re-extract frames' : 'Extract frames'}
                </button>
              </>)}
            </Section>
          )}

          <Section title="Background removal" icon={<Wand2 size={15} />} action={
            <button type="button" className="hbtn tipright" data-tip="Reset the removal settings to this mode's defaults (wand 20 / 1 / 2 / 1 · chroma 28 / 0.7 / 0.7 / 0.3)" aria-label="Reset settings" onClick={resetOpts}><RotateCcw size={13} /></button>
          }>
            <Seg
              label="Mode" tip="How clicked background colors are removed"
              value={opts.mode || 'wand'} set={v => setOpts({ ...opts, mode: v })}
              options={[
                ['wand', 'Magic wand', 'Photoshop magic-wand recipe: each click floods the exact clicked color within tolerance'],
                ['chroma', 'Chroma key', 'Green / magenta screen: the key color (default #00FF00, or a click on the image) is removed at every brightness, shadows included, and its spill decontaminated from sprite edges'],
                ['birefnet', 'BiRefNet v2', 'AI segmentation with specialized general, matting, portrait, heavy, 2K, and dynamic models'],
              ]}
            />
            {opts.mode === 'birefnet' ? (
              <>
                {!birefUnlocked ? (
                  <form className="passwordGate" onSubmit={unlockBirefNet}>
                    <div className="gateTitle"><LockKeyhole size={15} /><span><b>BiRefNet is protected</b><small>The password applies only to AI inference.</small></span></div>
                    <div className="passwordRow">
                      <input type="password" value={birefPassword} onChange={e => setBirefPassword(e.target.value)} placeholder="Password" autoComplete="current-password" aria-label="BiRefNet password" />
                      <button type="submit" disabled={!birefPassword}>Unlock</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="aiUnlocked"><BrainCircuit size={14} /><span>AI inference unlocked</span><button type="button" onClick={() => { setBirefUnlocked(false); setBirefPassword(''); }}>Lock</button></div>
                    <div className="presetCallout">
                      <b>UI sprites + soft shadow</b>
                      <span>Matting · 1024² · refined alpha · PNG + mask</span>
                      <button type="button" onClick={() => setCur({ ...BIREFNET_DEFAULTS })}>Use recommended</button>
                    </div>
                    <label className="field">
                      <span>Model profile</span>
                      <select value={cur.model} onChange={e => {
                        const model = e.target.value;
                        setCur({ model, operatingResolution: cur.operatingResolution === '2304x2304' && model !== 'General Use (Dynamic)' ? '2048x2048' : cur.operatingResolution });
                      }}>
                        <option>General Use (Light)</option>
                        <option>General Use (Light 2K)</option>
                        <option>General Use (Heavy)</option>
                        <option>General Use (HR)</option>
                        <option>Matting</option>
                        <option>Portrait</option>
                        <option>General Use (Dynamic)</option>
                      </select>
                    </label>
                    <p className="hint">{({
                      'General Use (Light)': 'Fastest general-purpose model; a good fallback for ordinary assets.',
                      'General Use (Light 2K)': 'Light model trained at 2K for larger source art.',
                      'General Use (Heavy)': 'Slower, more accurate general segmentation.',
                      'General Use (HR)': 'Full model trained at 2048²; best edge quality in the family. Pair with 2048² resolution.',
                      Matting: 'Best default for antialiased UI edges, translucent details, and soft shadows.',
                      Portrait: 'Specialized for people, hair, and portrait edges.',
                      'General Use (Dynamic)': 'Handles varying image scales and unlocks the 2304² maximum.',
                    })[cur.model]}</p>
                    <Seg label="Operating resolution" tip="AI working size; larger is more detailed but much slower and needs much more RAM" value={cur.operatingResolution} set={v => setCur({ operatingResolution: v })} options={[
                      ['1024x1024', '1024²', 'Recommended on this CPU host'],
                      ['2048x2048', '2048²', 'High quality; can take several minutes on this host'],
                      ...(cur.model === 'General Use (Dynamic)' ? [['2304x2304', '2304²', 'Maximum detail; highest memory risk']] : []),
                    ]} />
                    <Toggle checked={cur.refineForeground && !cur.maskOnly} onChange={v => setCur({ refineForeground: v })} tip="Mask-guided foreground color estimation cleans color contamination along translucent edges" >Refine foreground colors</Toggle>
                    {cur.refineForeground && !cur.maskOnly && <>
                      <Range label="Decontaminate" tip="Strength of BiRefNet's mask-guided edge-color cleanup. 0% keeps the source colors; 100% removes the estimated background contamination." value={cur.decontaminate} min={0} max={100} set={v => setCur({ decontaminate: v })} suffix="%" />
                      <Range label="Decontaminate tone" tip="Brightness of the color correction on contaminated edges. 100% preserves the refined brightness; lower darkens the corrected fringe and higher lifts it. Unchanged colors are untouched." value={cur.decontaminateTone} min={0} max={200} set={v => setCur({ decontaminateTone: v })} suffix="%" />
                    </>}
                    <Toggle checked={cur.outputMask} onChange={v => setCur({ outputMask: v })} tip="Also return the grayscale alpha mask for inspection or compositing">Return separate mask</Toggle>
                    <Toggle checked={cur.maskOnly} onChange={v => setCur({ maskOnly: v, refineForeground: v ? false : cur.refineForeground })} tip="Return only the raw segmentation mask; skips foreground refinement">Mask-only mode</Toggle>
                    <Seg label="Output format" value={cur.outputFormat} set={v => setCur({ outputFormat: v })} options={[
                      ['png', 'PNG', 'Best for sprites and soft alpha'], ['webp', 'WebP', 'Smaller lossless file'], ['gif', 'GIF', 'Limited to 1-bit transparency'],
                    ]} />
                    {!cur.maskOnly && <div className="aiShadowOptions">
                      <Toggle checked={cur.recoverShadows} onChange={v => setCur({ recoverShadows: v })} tip="Reconstruct neutral darkening outside the AI subject as portable translucent-black shadow">Recover soft shadows</Toggle>
                      {cur.recoverShadows && <>
                        <Range label="Shadow strength" tip="Opacity of the reconstructed shadow relative to its darkness on the original matte" value={cur.shadowStrength} min={0} max={200} set={v => setCur({ shadowStrength: v })} suffix="%" />
                        <Range label="Color sensitivity" tip="How much color deviation a darkened background pixel may have and still count as shadow. Raise for noisy sheets; lower if dark artwork leaks into the shadow." value={cur.shadowTolerance} min={4} max={40} set={v => setCur({ shadowTolerance: v })} />
                        <Seg label="Background sampling" value={cur.shadowSampling} set={v => setCur({ shadowSampling: v })} options={[
                          ['auto', 'Auto border', 'Find dominant clean matte colors around the sheet border'],
                          ['manual', 'Click samples', 'Click one or more clean, unshadowed background areas'],
                        ]} />
                        {cur.shadowSampling === 'manual' && <>
                          <div className="keys">
                            {!seedInfo.length && <span className="keyauto">Click a clean, unshadowed background area in the image.</span>}
                            {seedInfo.map(s => <span className="keychip" key={s.id}>
                              <i style={{ background: s.hex }} aria-hidden="true" /> {s.hex}
                              <button type="button" onClick={() => setSeeds(ss => ss.filter(x => x.id !== s.id))} aria-label={`Remove shadow background sample ${s.hex}`}><Trash2 size={12} /></button>
                            </span>)}
                          </div>
                          {!!seedInfo.length && <button type="button" className="ghost" onClick={() => setSeeds([])}><Trash2 size={13} /> Clear samples</button>}
                        </>}
                      </>}
                    </div>}
                    <button type="button" className="wide aiRun" disabled={!img || busy} onClick={runBirefNet}><Play size={14} /> {busy ? `Running BiRefNet… ${birefElapsed}s` : 'Remove background with BiRefNet'}</button>
                    {birefOriginal && <button type="button" className="wide" onClick={downloadBirefOriginal}><Download size={14} /> Download BiRefNet {cur.outputFormat.toUpperCase()}</button>}
                    {birefMask && <button type="button" className="wide" onClick={downloadBirefMask}><ImageDown size={14} /> Download alpha mask</button>}
                    <p className="hint privacyNote">The image is sent only to this PixelKit server. The first run for each profile downloads and caches its model weights.</p>
                  </>
                )}
              </>
            ) : (<>
            {opts.mode === 'chroma' ? (
              <p className="hint">The key color below is removed automatically — every brightness of it, shadows included. Click the image background to sample a different screen color instead. Edges and removed pixels are decontaminated, so no green/magenta trace survives.</p>
            ) : (
              <p className="hint">Click background areas on the image. Each click selects the connected pixels of that color — like Photoshop’s magic wand — then the selection is contracted, smoothed, feathered and cleared.</p>
            )}
            {opts.mode === 'chroma' && (
              <div className="seg">
                <span className="lbl hastip" data-tip="The screen color to key out when you haven't clicked the image — clicking a background pixel overrides it">Key color</span>
                <input
                  type="color" value={cur.key || '#00ff00'} aria-label="Chroma key color"
                  data-tip="Pick the screen color to remove"
                  onChange={e => setCur({ key: e.target.value })}
                  style={{ width: 44, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                />
              </div>
            )}
            <div className="keys">
              {seedInfo.length === 0 && (opts.mode === 'chroma' ? (
                <span className="keychip tipdown" data-tip="Removing this screen color everywhere — click the image background to sample a different one">
                  <i style={{ background: cur.key || '#00ff00' }} aria-hidden="true" /> {(cur.key || '#00ff00')} (key)
                </span>
              ) : (
                <span className="keyauto tipdown" data-tip="Nothing selected yet — click the image background to start removing it">No background clicked yet</span>
              ))}
              {seedInfo.map(s => (
                <span className={'keychip' + (s.id === selectedSeedId ? ' sel' : '')} key={s.id}>
                  <button
                    type="button" className="chippick"
                    aria-pressed={s.id === selectedSeedId}
                    data-tip={s.id === selectedSeedId ? 'Selected — the Tolerance slider tunes this sample; click to deselect' : 'Select this sample to retune its tolerance'}
                    onClick={() => setSelectedSeedId(id => (id === s.id ? null : s.id))}
                  >
                    <i style={{ background: s.hex }} aria-hidden="true" /> {s.hex} · {s.tolerance}
                  </button>
                  <button type="button" onClick={() => setSeeds(ss => ss.filter(x => x.id !== s.id))} aria-label={`Remove wand sample ${s.hex}`} data-tip="Remove this wand sample"><Trash2 size={12} /></button>
                </span>
              ))}
            </div>
            {seeds.length > 0 && (
              <div className="rowbtns">
                <button type="button" className="ghost" data-tip="Remove the most recent wand click (Ctrl+Z)" onClick={() => setSeeds(s => s.slice(0, -1))}><Undo2 size={13} /> Undo</button>
                <button type="button" className="ghost" data-tip="Clear all wand clicks and start over" onClick={() => setSeeds([])}><Trash2 size={13} /> Clear ({seeds.length})</button>
              </div>
            )}
            <Range
              label="Tolerance"
              swatch={selectedSeed?.hex}
              tip={selectedSeed
                ? `Tolerance of the selected ${selectedSeed.hex} sample only — other samples keep their own. Raise it if background remains around that click; lower it if the subject gets eaten. New clicks start from this value.`
                : 'How similar a pixel must be to the clicked color to join the selection — Photoshop wand tolerance. Each sample keeps the tolerance it was clicked at; select its chip above to retune just that sample.'}
              value={selectedSeed ? selectedSeed.tolerance : cur.tolerance} min={0} max={100}
              set={v => {
                setCur({ tolerance: v });
                if (selectedSeed) setSeeds(ss => ss.map(s => (s.id === selectedSeed.id ? { ...s, tolerance: v } : s)));
              }}
            />
            <Range label="Contract / expand" tip="Positive shrinks the selection inward, keeping a safety margin around the object (Select > Modify > Contract). Negative expands it outward to eat leftover background fringe (Select > Modify > Expand). Steps of 0.1 px for fine edges." value={cur.contract} min={-10} max={10} step={0.1} set={v => setCur({ contract: v })} suffix=" px" />
            <Range label="Smooth" tip="Rounds off jagged, stair-stepped selection edges (Select > Modify > Smooth). Steps of 0.1 px for fine edges." value={cur.smooth} min={0} max={10} step={0.1} set={v => setCur({ smooth: v })} suffix=" px" />
            <Range label="Feather" tip="Softens the selection edge so the cut fades instead of ending abruptly (Select > Modify > Feather). Use 0 for pixel art. Steps of 0.1 px for fine edges." value={cur.feather} min={0} max={10} step={0.1} set={v => setCur({ feather: v })} suffix=" px" />
            {opts.mode === 'chroma' && <>
              <Range label="Decontaminate" tip="Strips the screen color that bleeds into sprite edges (spill). 100% removes the key chroma completely; brightness is never changed, and colors without a key tint are untouched." value={cur.despill} min={0} max={100} set={v => setCur({ despill: v })} suffix="%" />
              <Range label="Decontaminate reach" tip="How many pixels deep inside the sprite the spill cleanup extends. Keep it small so genuinely green/magenta details away from the edge are never desaturated." value={cur.despillReach} min={1} max={10} set={v => setCur({ despillReach: v })} suffix=" px" />
              <Range label="Decontaminate tone" tip="Brightness of the neutralized screen color at edges. 100% keeps the pixel's original brightness; lower darkens the decontaminated fringe toward black (good over dark game scenes), higher lifts it toward white. Only key-tinted pixels shift." value={cur.despillTone} min={0} max={200} set={v => setCur({ despillTone: v })} suffix="%" />
            </>}
            </>)}
          </Section>

          {opts.mode !== 'birefnet' && <Section title="Soft shadow" icon={<Moon size={15} />}>
            <Toggle tip="Pixels that are a darkened version of the background you clicked come back as translucent black shadow. Anchored to your wand clicks, so it works on gray, white — any background." checked={opts.shadow} onChange={v => setOpts({ ...opts, shadow: v })}>Keep soft shadow layer</Toggle>
            {opts.shadow && (
              <Range label="Strength" tip="Shadow opacity relative to how much darker the pixel is than your clicked background. 100% reproduces the original shadow exactly; lower fades it, higher deepens it." value={opts.shadowStrength} min={0} max={200} set={v => setOpts({ ...opts, shadowStrength: v })} suffix="%" />
            )}
            <p className="hint">Click the shadow tones with the wand too — the shadow layer rebuilds them as clean translucent black. Only neutral darkenings of the clicked background qualify, so colored elements can’t sneak back in.</p>
          </Section>}

          {tab === 'video' && !!rawFrames.length && (
            <Section title="Sprite sheet" icon={<LayoutGrid size={15} />}>
              <p className="hint">{sheetOpts.placement === 'compact'
                ? <>Every frame is trimmed to its own box and centred in a cell as small as the widest and tallest <b>kept</b> frame. Smallest sheet — but each frame is re-centred on its own, so a moving subject will jitter.</>
                : <>Every frame keeps the position it had in the video, so the animation moves the way the clip does. The cell is the area the <b>kept</b> frames cover between them, so dropping the frame that reaches furthest out shrinks the sheet straight away — no rebuild needed.</>}</p>
              {opts.mode === 'birefnet' && <p className="hint">BiRefNet processes one image at a time on the server. Switch Mode to Chroma key or Magic wand to run a whole clip.</p>}
              <button type="button" className="wide" disabled={!rawFrames.length || !!progress || opts.mode === 'birefnet'} data-tip="Run the removal on every extracted frame and trim each one — afterwards, keeping or dropping frames re-packs instantly" onClick={buildSheet}>
                <Scissors size={14} /> {cutFrames.length ? 'Reprocess' : 'Remove background & build'} ({rawFrames.length})
              </button>
              <Seg
                label="Frame placement" tip="How each trimmed frame is positioned inside its cell."
                value={sheetOpts.placement} set={v => setSheetOpts({ ...sheetOpts, placement: v })}
                options={[
                  ['motion', 'Preserve motion', 'Every frame keeps the position it had in the video, so a subject that moves keeps moving instead of jittering. The cell is the area the subject covers across the kept frames.'],
                  ['compact', 'Compact', 'Each frame is centred in the smallest cell that fits the widest and tallest frame. Smallest sheet, but frames are re-centred individually, so any movement becomes wobble.'],
                ]}
              />
              <Range label="Columns" tip="Frames per row. 0 lays them out on a square-ish grid." value={sheetOpts.columns} min={0} max={24} set={v => setSheetOpts({ ...sheetOpts, columns: v })} />
              <Range label="Spacing" tip="Transparent gap between cells" value={sheetOpts.spacing} min={0} max={32} set={v => setSheetOpts({ ...sheetOpts, spacing: v })} suffix=" px" />
              <Range label="Margin" tip="Transparent border around the whole sheet" value={sheetOpts.margin} min={0} max={64} set={v => setSheetOpts({ ...sheetOpts, margin: v })} suffix=" px" />
              {sheetOpts.placement === 'compact' && <Seg
                label="Frame anchor" tip="Where each trimmed frame sits inside its cell. Bottom pins the baseline, so a walk cycle's feet stay on the ground."
                value={sheetOpts.anchor} set={v => setSheetOpts({ ...sheetOpts, anchor: v })}
                options={[['center', 'Center', 'Centre the frame in its cell'], ['bottom', 'Bottom', 'Sit the frame on the bottom edge of its cell'], ['top', 'Top', 'Hang the frame from the top edge of its cell']]}
              />}
              <Toggle checked={sheetOpts.showGrid} onChange={v => setSheetOpts({ ...sheetOpts, showGrid: v })} tip="Outline every cell on the sheet preview so you can see the grid the frames are placed on">Show cell grid</Toggle>
              <Seg label="Sheet JSON" tip="Metadata format written next to the sheet PNG. Each frame records its cell rect and its offset inside the cell." value={atlasFormat} set={setAtlasFormat} options={Object.entries(ATLAS_FORMATS).map(([id, f]) => [id, f.label])} />
              {sheet && <p className="hint">Cell <b>{sheet.cellW}×{sheet.cellH}</b> · {sheet.cols}×{sheet.rows} grid · sheet <b>{sheet.width}×{sheet.height}</b></p>}
            </Section>
          )}

          {tab === 'video' && !!preview && (
            <Section title="Animation preview" icon={<Clapperboard size={15} />}>
              <div className={'anim' + bgClass} style={bgStyle}>
                <SheetAnimation cells={preview.cells} cellW={preview.cellW} cellH={preview.cellH} fps={fps} playing={playing} onion={onion} />
              </div>
              <div className="animctl">
                <button type="button" className="iconbtn" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause animation' : 'Play animation'} aria-pressed={playing}>
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <div className="animinfo">
                  <span>{preview.cells.length} frame{preview.cells.length === 1 ? '' : 's'} · {preview.cellW}×{preview.cellH}</span>
                  <Toggle small checked={onion} onChange={setOnion} tip="Ghost the previous frame underneath to spot jitter">Onion skin</Toggle>
                </div>
              </div>
              <Range label="Frame rate" tip="Playback speed here and in the exported APNG" value={fps} min={1} max={30} set={setFps} suffix=" fps" />
              <p className="hint">{preview.raw
                ? 'Playing the frames you kept, straight from the video. Build the sheet to preview them cut out and trimmed.'
                : 'Exactly what the sheet holds — same cells, same anchor — so what you see here is what the APNG exports.'}</p>
            </Section>
          )}

          {tab === 'single' && (
            <Section title="Keep / erase areas" icon={<Lasso size={15} />}>
              <Seg
                label="Tool" tip="Draw areas on the image that override the automatic mask"
                value={regionTool || 'off'} set={v => setRegionTool(v === 'off' ? null : v)}
                options={[
                  ['off', 'Off', 'Stop drawing — clicks go back to the magic wand'],
                  ['poly', 'Lasso', 'Click to place polygon points; close via the first point, double-click or Enter (L)'],
                  ['rect', 'Box', 'Drag a rectangle over an area'],
                ]}
              />
              <Seg
                label="Effect" tip="What a newly drawn shape does"
                value={regionEffect} set={setRegionEffect}
                options={[
                  ['keep', 'Keep', 'Protect: everything inside stays exactly as in the original'],
                  ['erase', 'Erase', 'Force-remove everything inside'],
                  ['sub', 'Subtract', 'Carve earlier shapes back to the automatic result'],
                ]}
              />
              <div className="rowbtns">
                <button type="button" className="ghost" disabled={!regions.length} data-tip="Remove the most recent shape" onClick={() => setRegions(r => r.slice(0, -1))}><Undo2 size={13} /> Undo</button>
                <button type="button" className="ghost" disabled={!regions.length} data-tip="Delete all drawn shapes" onClick={() => setRegions([])}><Trash2 size={13} /> Clear{regions.length ? ` (${regions.length})` : ''}</button>
              </div>
              <p className="hint">Areas apply after the wand recipe and carry into atlas detection.</p>
            </Section>
          )}

          {tab === 'sprite' && (
            <Section title="Atlas detection" icon={<Layers size={15} />}>
              <Seg label="Sheet type" tip="How sprites are arranged on the sheet" value={sheetMode} set={setSheetMode} options={[
                ['packed', 'Packed atlas', 'Sprites placed anywhere — detected automatically from the alpha mask (most atlases)'],
                ['grid', 'Uniform grid', 'Fixed-size frames in rows and columns — only for true animation sheets'],
              ]} />
              {sheetMode === 'packed' ? (
                <>
                  <Range label="Alpha threshold" tip="How opaque a pixel must be to count as part of a sprite during detection — raise it so soft shadows don't merge neighbours" value={detect.alphaThreshold} min={1} max={220} set={v => setDetect({ ...detect, alphaThreshold: v })} />
                  <Range label="Minimum sprite area" tip="Detected blobs smaller than this many pixels are ignored" value={detect.minArea} min={16} max={5000} set={v => setDetect({ ...detect, minArea: v })} suffix=" px" />
                  <Range label="Merge distance" tip="Blobs closer together than this are merged into one sprite" value={detect.mergeDistance} min={0} max={40} set={v => setDetect({ ...detect, mergeDistance: v })} suffix=" px" />
                  <Range label="Crop padding" tip="Extra pixels kept around each detected sprite so soft shadows survive the crop" value={detect.padding} min={0} max={32} set={v => setDetect({ ...detect, padding: v })} suffix=" px" />
                </>
              ) : (
                <>
                  <button type="button" className="wide" data-tip="Guess the column / row count from the image" onClick={autoGrid} disabled={!img}><Sparkles size={14} /> Auto-detect grid</button>
                  <Range label="Columns" tip="Number of frames per row" value={grid.cols} min={1} max={32} set={v => setGrid({ ...grid, cols: v })} />
                  <Range label="Rows" tip="Number of frame rows" value={grid.rows} min={1} max={32} set={v => setGrid({ ...grid, rows: v })} />
                  <Range label="Margin" tip="Empty border around the whole sheet" value={grid.margin} min={0} max={80} set={v => setGrid({ ...grid, margin: v })} suffix=" px" />
                  <Range label="Spacing" tip="Gap between frames" value={grid.spacing} min={0} max={40} set={v => setGrid({ ...grid, spacing: v })} suffix=" px" />
                </>
              )}
            </Section>
          )}

          {tab === 'sprite' && (
            <Section title="Animation preview" icon={<Clapperboard size={15} />} collapsible>
              <AnimPreview frames={animFrames} fps={fps} setFps={setFps} playing={playing} setPlaying={setPlaying} onion={onion} setOnion={setOnion} pixelView={pixelView} bgClass={bgClass} bgStyle={bgStyle} />
            </Section>
          )}

          {tab === 'sprite' && (
            <Section title="Atlas export options" icon={<Boxes size={15} />} collapsible defaultOpen={false}>
              <Range label="Padding" tip="Transparent spacing packed between sprites in the exported atlas" value={pack.padding} min={0} max={16} set={v => setPack({ ...pack, padding: v })} suffix=" px" />
              <Toggle tip="Duplicates each sprite's edge pixels outward so texture filtering can't bleed neighbours in" checked={pack.extrude} onChange={v => setPack({ ...pack, extrude: v })}>Edge extrude (no bleed)</Toggle>
              <Toggle tip="Centers every frame on a shared box so packed animations don't jitter frame-to-frame" checked={lockFrameBox} onChange={setLockFrameBox}>Lock frame box (stabilize anim)</Toggle>
              <Seg label="Atlas JSON" tip="Metadata format written next to the atlas PNG" value={atlasFormat} set={setAtlasFormat} options={Object.entries(ATLAS_FORMATS).map(([id, f]) => [id, f.label])} />
            </Section>
          )}
        </aside>

        {/* CENTER -------------------------------------------------------- */}
        <section className="canvasPanel" aria-label="Preview">
          <div className="toolbar">
            <div className="filemeta">
              <b>{(tab === 'video' ? videoFile?.name : file?.name) || (tab === 'video' ? 'Drop a video to build a sprite sheet' : 'Upload a UI asset or sprite sheet')}</b>
              <span>{tab === 'video'
                ? (videoMeta
                  ? `${videoMeta.width}×${videoMeta.height} · ${formatTime(videoMeta.duration)}${rawFrames.length ? ` · ${selectedRaw.length}/${rawFrames.length} frames kept` : ''}${sheet ? ` · ${sheet.cellW}×${sheet.cellH} cell` : ''}`
                  : 'MP4 · WebM · MOV — decoded locally, never uploaded')
                : (img
                  ? `${img.naturalWidth}×${img.naturalHeight}px · ${stats.transparentPct}% removed${tab === 'sprite' ? ` · ${exportFrames.length} sprite${exportFrames.length === 1 ? '' : 's'}` : ''}`
                  : 'transparent PNG export · sprite-aware workflow')}</span>
            </div>
            <div className="viewtools">
              <div className="bgswitch" role="group" aria-label="Preview background">
                <button type="button" className={(previewBg === 'checker' ? 'on' : '') + ' tipdown'} aria-pressed={previewBg === 'checker'} data-tip="Checkerboard preview background (1)" onClick={() => setPreviewBg('checker')}><Square size={14} /></button>
                <button type="button" className={(previewBg === 'dark' ? 'on' : '') + ' tipdown'} aria-pressed={previewBg === 'dark'} data-tip="Dark preview background (2)" onClick={() => setPreviewBg('dark')}><Moon size={14} /></button>
                <button type="button" className={(previewBg === 'light' ? 'on' : '') + ' tipdown'} aria-pressed={previewBg === 'light'} data-tip="Light preview background (3)" onClick={() => setPreviewBg('light')}><SunMedium size={14} /></button>
                <button type="button" className={(previewBg === 'magenta' ? 'on' : '') + ' tipdown'} aria-pressed={previewBg === 'magenta'} data-tip="High-contrast magenta background (4)" onClick={() => setPreviewBg('magenta')}><Hexagon size={14} /></button>
              </div>
              <button type="button" className={'iconbtn tipdown' + (pixelView ? ' on' : '')} aria-pressed={pixelView} data-tip="Pixelated view — nearest-neighbor zoom, no smoothing" onClick={() => setPixelView(v => !v)}><Boxes size={15} /></button>
              {tab === 'single' && <button type="button" className={'iconbtn tipdown' + (maskOverlay ? ' on' : '')} aria-pressed={maskOverlay} data-tip="Tint removed areas pink to tune the mask" onClick={() => setMaskOverlay(v => !v)} disabled={!result}><Layers size={15} /></button>}
              {tab === 'single' && <button type="button" className={'iconbtn tipdown' + (showBefore ? ' on' : '')} aria-pressed={showBefore} data-tip="Show the original image — toggle on/off, or hold B for a quick peek" onClick={() => setShowBefore(v => !v)} disabled={!result}><Eye size={15} /></button>}
              <div className="zoomctl tipdown tipright" data-tip="Zoom — scroll wheel, pinch, or + / − keys; 0 resets">
                <Maximize2 size={13} aria-hidden="true" />
                <input type="range" min="0.25" max="8" step="0.05" value={zoom} aria-label="Zoom" onChange={e => setZoom(+e.target.value)} />
                <span>{Math.round(zoom * 100)}%</span>
              </div>
            </div>
          </div>

          {tab === 'video' ? (
            <VideoStage
              videoEl={videoEl} duration={videoMeta?.duration} range={range}
              onSetStart={setRangeStart} onSetEnd={setRangeEnd}
              frames={rawFrames} previewIndex={previewIndex} setPreviewIndex={setPreviewIndex}
              isOff={isFrameOff} toggleFrame={toggleFrame}
              onAll={selectAllFrames} onNone={selectNoFrames} onInvert={invertFrames}
              previewUrl={framePreviewUrl} meta={originalCanvas ? { w: originalCanvas.width, h: originalCanvas.height } : null}
              view={videoView} setView={setVideoView} sheet={sheet} showGrid={sheetOpts.showGrid}
              hasCuts={!!cutFrames.length} preview={preview}
              fps={fps} setFps={setFps} playing={playing} setPlaying={setPlaying} onion={onion}
              pixelView={pixelView} bgClass={bgClass} bgStyle={bgStyle}
              onPick={opts.mode === 'birefnet' ? null : addSeed}
              pickHint={opts.mode === 'chroma'
                ? 'Chroma key runs on every frame — click the screen only if it misses, on a spot the subject never crosses'
                : 'Click a background area — the same click runs on every frame'}
              selectedCount={selectedRaw.length}
              progress={progress} onCancel={() => { cancelRef.current = true; }}
              onExtract={extractFrames} onBuild={buildSheet}
            />
          ) : (
          <CanvasStage
            tab={tab} img={img} url={url} resultUrl={resultUrl} overlayUrl={overlayUrl} originalCanvas={originalCanvas}
            previewBg={previewBg} zoom={zoom} setZoom={setZoom} pan={pan} setPan={setPan}
            pixelView={pixelView} maskOverlay={maskOverlay} showBefore={showBefore} beforeHold={beforeHold}
            onWandPick={opts.mode === 'birefnet' && cur.shadowSampling !== 'manual' ? null : addSeed}
            showWandHint={!!img && seeds.length === 0 && (opts.mode === 'wand' || (opts.mode === 'birefnet' && cur.recoverShadows && cur.shadowSampling === 'manual'))}
            wandHint={opts.mode === 'birefnet' ? 'Click a clean, unshadowed background area to anchor soft-shadow recovery' : undefined}
            regions={regions} regionTool={regionTool} regionEffect={regionEffect}
            onAddRegion={r => setRegions(rs => [...rs, r])} onExitTool={() => setRegionTool(null)}
            activeFrames={activeFrames} sheetMode={sheetMode} frameSize={frameSize} isExcluded={isExcluded} toggleExclude={toggleExclude}
            busy={busy}
          />
          )}

          {error && <div className="errline" role="alert">{error}</div>}

          <div className="exportbar">
            <div className="scaleopt">
              <span>Scale</span>
              <div className="segbtns inline" role="group" aria-label="Export scale">
                {[1, 2, 4].map(s => <button key={s} type="button" className={exportScale === s ? 'on' : ''} aria-pressed={exportScale === s} data-tip={`Export at ${s}× size`} onClick={() => setExportScale(s)}>{s}×</button>)}
              </div>
              <Toggle small checked={trimExport} onChange={setTrimExport} icon={<Crop size={12} />} tip="Crop away transparent borders before exporting">Trim</Toggle>
            </div>
            <div className="exportbtns">
              <button type="button" onClick={copyResult} disabled={tab === 'video' ? !sheet : !result} data-tip="Copy the result PNG to the clipboard (C)"><Copy size={15} /> Copy</button>
              {tab === 'single' && <button type="button" className="primary" disabled={!result} onClick={exportPNG} data-tip="Download the transparent PNG (E)"><Download size={15} /> PNG</button>}
              {tab === 'sprite' && <>
                <button type="button" disabled={!exportFrames.length} onClick={exportSheet} data-tip="Download the whole sheet with the background removed, layout unchanged"><Download size={15} /> Sheet</button>
                <button type="button" disabled={!exportFrames.length} onClick={exportFramesZip} data-tip="Download every sprite as its own PNG inside a ZIP"><FileArchive size={15} /> ZIP</button>
                <button type="button" disabled={exportFrames.length < 2} onClick={exportAPNG} data-tip="Download an animated PNG of the frames (keeps alpha)"><Clapperboard size={15} /> APNG</button>
                <button type="button" className="primary" disabled={!exportFrames.length} onClick={exportAtlas} data-tip="Download a re-packed atlas PNG + JSON metadata (E)"><FileJson size={15} /> Atlas</button>
              </>}
              {tab === 'video' && <>
                <button type="button" disabled={!sheetFrames.length} onClick={exportVideoFramesZip} data-tip="Download every trimmed frame as its own PNG inside a ZIP"><FileArchive size={15} /> ZIP</button>
                <button type="button" disabled={!sheet || sheet.cells.length < 2} onClick={exportVideoAPNG} data-tip="Download an animated PNG of the sheet's frames, cell-aligned (keeps alpha)"><Clapperboard size={15} /> APNG</button>
                <button type="button" disabled={!sheet} onClick={exportVideoSheetAtlas} data-tip="Download the sheet PNG + JSON metadata describing every cell (unscaled)"><FileJson size={15} /> Sheet + JSON</button>
                <button type="button" className="primary" disabled={!sheet} onClick={exportVideoSheet} data-tip="Download the sprite sheet PNG (E)"><Download size={15} /> Sheet</button>
              </>}
            </div>
          </div>
        </section>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// Crop a sub-rectangle of a source canvas into a fresh canvas.
function cropFrom(src, x, y, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }).drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}
