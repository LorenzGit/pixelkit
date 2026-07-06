import React, { useEffect, useRef, useState } from 'react';
import { Zap, X } from 'lucide-react';
import { clamp } from '../lib/color.js';
import { PREVIEW_BG } from '../lib/presets.js';

const ZOOM_MIN = 0.25, ZOOM_MAX = 8;
const CLOSE_SNAP_PX = 12; // screen px within which a polygon click snaps shut
const CLICK_SLOP_PX = 5;  // pointer travel beyond this turns a wand click into a drag

const REGION_FILL = { keep: 'rgba(74, 222, 128, .25)', erase: 'rgba(255, 93, 115, .28)', sub: 'rgba(152, 161, 184, .22)' };
const REGION_STROKE = { keep: '#4ade80', erase: '#ff5d73', sub: '#98a1b8' };

export function CanvasStage({
  tab, img, url, resultUrl, overlayUrl, originalCanvas,
  previewBg, zoom, setZoom, pan, setPan,
  pixelView, maskOverlay, showBefore, beforeHold,
  onWandPick, showWandHint,
  regions, regionTool, regionEffect, onAddRegion, onExitTool,
  activeFrames, sheetMode, frameSize, isExcluded, toggleExclude,
  busy,
}) {
  const previewRef = useRef(null);
  const compareRef = useRef(null);
  const gesture = useRef({ pointers: new Map(), mode: null, panStart: null, pinchDist: 0, pinchZoom: 1 });

  // In-progress region: polygon vertex list, or a 2-corner rect while dragging.
  const [draft, setDraft] = useState([]);
  const [hoverPt, setHoverPt] = useState(null);
  const rectDrag = useRef(false);
  // True only while a pan/pinch drag is actually moving the view, so the
  // crosshair (color pick) cursor survives being zoomed in.
  const [panning, setPanning] = useState(false);

  const W = originalCanvas?.width || 1, H = originalCanvas?.height || 1;
  const drawing = !!regionTool && tab === 'single' && !!img;

  // Non-passive wheel listener so we can preventDefault page scroll while zooming.
  useEffect(() => {
    const el = previewRef.current;
    if (!el || tab !== 'single') return;
    const onWheel = e => {
      if (!img) return;
      e.preventDefault();
      const next = +clamp(zoom * (e.deltaY < 0 ? 1.1 : 0.9), ZOOM_MIN, ZOOM_MAX).toFixed(2);
      if (next === zoom) return;
      // Shift pan so the image point under the cursor stays under the cursor.
      // The transformed stage center sits at (untransformed center + pan), so
      // the cursor's offset from the current rect center is all we need.
      const r = compareRef.current?.getBoundingClientRect();
      if (r && next > 1) {
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const k = 1 - next / zoom;
        setPan(p => clampPan({ x: p.x + dx * k, y: p.y + dy * k }, next));
      } else if (next <= 1) {
        setPan({ x: 0, y: 0 }); // panning is disabled at 1x, so don't strand an offset
      }
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }); // re-bind each render so the handler sees the fresh zoom/pan

  // Reset any half-drawn shape when the tool changes or the image swaps.
  useEffect(() => { setDraft([]); setHoverPt(null); rectDrag.current = false; }, [regionTool, url]);

  function commitPoly(points) {
    if (points.length >= 3) onAddRegion({ type: 'poly', effect: regionEffect, points });
    setDraft([]); setHoverPt(null);
  }

  // Enter closes the polygon, Escape abandons the draft.
  useEffect(() => {
    if (!drawing) return;
    const onKey = e => {
      if (e.key === 'Enter' && regionTool === 'poly' && draft.length >= 3) { e.preventDefault(); commitPoly(draft); }
      else if (e.key === 'Escape') {
        if (draft.length) { setDraft([]); setHoverPt(null); rectDrag.current = false; }
        else onExitTool?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bind each render so the handler sees the fresh draft

  const bgClass = previewBg === 'checker' ? ' bg-checker' : '';
  const bgStyle = previewBg === 'checker' ? undefined : { backgroundColor: PREVIEW_BG[previewBg] };

  function clampPan(p, z) {
    const r = previewRef.current?.getBoundingClientRect();
    if (!r) return p;
    const bx = (z - 1) * r.width / 2 + 60, by = (z - 1) * r.height / 2 + 60;
    return { x: clamp(p.x, -bx, bx), y: clamp(p.y, -by, by) };
  }

  // Map a pointer event to image-space coordinates (accounts for zoom/pan
  // because getBoundingClientRect already includes the CSS transform).
  function toImage(e) {
    const r = compareRef.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return {
      x: clamp((e.clientX - r.left) / r.width * W, 0, W),
      y: clamp((e.clientY - r.top) / r.height * H, 0, H),
      scale: r.width / W, // screen px per image px, for snap radii
    };
  }

  // A click (little pointer travel) adds a magic-wand seed at that pixel;
  // a drag pans / pinches as usual.
  function wandPick(e) {
    if (!originalCanvas || !onWandPick) return;
    const pt = toImage(e);
    if (!pt) return;
    onWandPick({ x: clamp(Math.floor(pt.x), 0, W - 1), y: clamp(Math.floor(pt.y), 0, H - 1) });
  }

  function regionDown(e) {
    const pt = toImage(e);
    if (!pt) return;
    if (regionTool === 'rect') {
      rectDrag.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDraft([{ x: pt.x, y: pt.y }, { x: pt.x, y: pt.y }]);
      return;
    }
    // Polygon: snap shut when clicking near the first vertex.
    if (draft.length >= 3) {
      const first = draft[0];
      const distPx = Math.hypot(pt.x - first.x, pt.y - first.y) * pt.scale;
      if (distPx < CLOSE_SNAP_PX) { commitPoly(draft); return; }
    }
    setDraft(d => [...d, { x: pt.x, y: pt.y }]);
  }

  function onPointerDown(e) {
    if (tab !== 'single' || !img) return;
    if (regionTool) { regionDown(e); return; }
    const g = gesture.current;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Track a potential wand click; any real travel or a second finger voids it.
    g.click = g.pointers.size === 1 ? { x: e.clientX, y: e.clientY, ok: true } : null;
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.pinchZoom = zoom;
      g.mode = 'pinch';
    } else if (zoom > 1) {
      g.mode = 'pan';
      g.panStart = { x: pan.x, y: pan.y, px: e.clientX, py: e.clientY };
    }
  }

  function onPointerMove(e) {
    if (regionTool && tab === 'single' && img) {
      const pt = toImage(e);
      if (!pt) return;
      if (regionTool === 'rect' && rectDrag.current) setDraft(d => (d.length === 2 ? [d[0], { x: pt.x, y: pt.y }] : d));
      else if (regionTool === 'poly' && draft.length) setHoverPt({ x: pt.x, y: pt.y });
      return;
    }
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.click && Math.hypot(e.clientX - g.click.x, e.clientY - g.click.y) > CLICK_SLOP_PX) g.click.ok = false;
    if (g.mode === 'pinch' && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom(+clamp(g.pinchZoom * (dist / g.pinchDist), ZOOM_MIN, ZOOM_MAX).toFixed(2));
      setPanning(true);
    } else if (g.mode === 'pan') {
      setPan(clampPan({ x: g.panStart.x + (e.clientX - g.panStart.px), y: g.panStart.y + (e.clientY - g.panStart.py) }, zoom));
      if (Math.hypot(e.clientX - g.panStart.px, e.clientY - g.panStart.py) > CLICK_SLOP_PX) setPanning(true);
    }
  }

  function onPointerUp(e) {
    if (regionTool === 'rect' && rectDrag.current) {
      rectDrag.current = false;
      if (draft.length === 2) {
        const [a, b] = draft;
        if (Math.abs(b.x - a.x) >= 2 && Math.abs(b.y - a.y) >= 2) onAddRegion({ type: 'rect', effect: regionEffect, points: draft });
      }
      setDraft([]);
      return;
    }
    const g = gesture.current;
    const wasClick = g.click?.ok && g.pointers.size === 1 && tab === 'single' && img && !regionTool;
    g.pointers.delete(e.pointerId);
    g.click = null;
    if (g.pointers.size === 0) setPanning(false);
    if (wasClick) { wandPick(e); g.mode = null; return; }
    if (g.pointers.size === 0) { g.mode = null; return; }
    // Pinch dropped to one finger: hand the surviving pointer back to pan
    // so the gesture stays live instead of going inert.
    if (g.mode === 'pinch' && g.pointers.size === 1) {
      const [p] = [...g.pointers.values()];
      g.mode = zoom > 1 ? 'pan' : null;
      g.panStart = { x: pan.x, y: pan.y, px: p.x, py: p.y };
    }
  }

  function onDoubleClick() {
    if (regionTool === 'poly' && draft.length >= 3) commitPoly(draft);
  }

  const transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
  const before = showBefore || beforeHold;
  const hasResult = !!resultUrl;
  const dotR = Math.max(1.5, W / 160);

  const regionShape = (r, i) => {
    const common = { fill: REGION_FILL[r.effect], stroke: REGION_STROKE[r.effect], strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' };
    if (r.type === 'rect') {
      const [a, b] = r.points;
      return <rect key={i} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...common} />;
    }
    return <polygon key={i} points={r.points.map(p => `${p.x},${p.y}`).join(' ')} {...common} />;
  };

  return (
    <div
      ref={previewRef}
      className={'preview' + bgClass + (tab === 'single' ? ' single' : '') + (drawing || (img && tab === 'single') ? ' picking' : '') + (panning ? ' panning' : '')}
      style={bgStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {!img && (
        <div className="empty">
          <div className="emptyglow"><Zap size={44} aria-hidden="true" /></div>
          <h1>Background removal for game UI, icons &amp; sprite sheets</h1>
          <p>Drop an asset, then click the background — a magic wand selects it, refines the edge (contract · smooth · feather) and clears it, while a second layer keeps the soft contact shadow. Everything runs locally in your browser.</p>
          <div className="emptytags">
            {['Magic wand', 'Contract · Smooth · Feather', 'Soft shadow layer', 'Keep/erase lasso', 'Atlas JSON', 'ZIP frames', 'APNG'].map(t => <span key={t}>{t}</span>)}
          </div>
        </div>
      )}

      {img && tab === 'single' && (
        <div className="stage" style={{ transform }}>
          <div className="compare" ref={compareRef} style={{ imageRendering: pixelView ? 'pixelated' : 'auto' }}>
            {/* The original defines the layout box; hide (not unmount) it under
                the transparent result so the removed background can't show through. */}
            <img src={url} className="orig" style={{ visibility: hasResult && !before ? 'hidden' : 'visible' }} draggable={false} alt="Original image" />
            {hasResult && !before && <img src={resultUrl} className="cut" draggable={false} alt="Background removed result" />}
            {maskOverlay && overlayUrl && !before && <img src={overlayUrl} className="overlay" draggable={false} alt="" />}
            {(regions.length > 0 || draft.length > 0) && (
              <svg className="regionsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
                {regions.map(regionShape)}
                {draft.length > 0 && regionTool === 'rect' && regionShape({ type: 'rect', effect: regionEffect, points: draft }, 'draft')}
                {draft.length > 0 && regionTool === 'poly' && (
                  <g>
                    <polyline
                      points={[...draft, hoverPt || draft[draft.length - 1]].map(p => `${p.x},${p.y}`).join(' ')}
                      fill="none" stroke={REGION_STROKE[regionEffect]} strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"
                    />
                    {draft.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? dotR * 1.7 : dotR} fill={i === 0 ? REGION_STROKE[regionEffect] : '#fff'} stroke={REGION_STROKE[regionEffect]} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>
                )}
              </svg>
            )}
          </div>
        </div>
      )}

      {img && tab === 'sprite' && (
        <div className="spriteScroll">
          <div className="stage">
            <div className="spriteWrap" style={{ imageRendering: pixelView ? 'pixelated' : 'auto' }}>
              {activeFrames.length
                ? activeFrames.map((f) => {
                  const excl = isExcluded(f);
                  return (
                    <div className={'spriteTile' + (excl ? ' excluded' : '')} key={f.id}>
                      {toggleExclude && (
                        <button type="button" className="spriteX" onClick={() => toggleExclude(f)} aria-label={excl ? 'Include sprite' : 'Exclude sprite'} data-tip={excl ? 'Include this sprite in exports' : 'Exclude this sprite from exports'}>
                          <X size={12} />
                        </button>
                      )}
                      <img src={f.url} style={{ maxWidth: frameSize, maxHeight: frameSize }} draggable={false} alt={`Sprite ${f.label}`} />
                      <span>{f.label}</span>
                    </div>
                  );
                })
                : <p className="nogrid">No sprites detected. Pick the background color, lower the alpha threshold, or reduce the minimum area.</p>}
            </div>
          </div>
        </div>
      )}

      {drawing && (
        <div className="drawhint" role="status">
          {regionTool === 'poly'
            ? (draft.length ? 'Click to add points · click the first point, double-click or press Enter to close · Esc cancels' : 'Click to start a polygon around the area')
            : 'Drag a rectangle over the area'}
        </div>
      )}

      {!drawing && showWandHint && tab === 'single' && (
        <div className="drawhint" role="status">Click a background area to remove it — the magic wand selects everything connected of that color</div>
      )}

      {busy && (
        <div className="busy" role="status" aria-live="polite">
          <span className="spin" aria-hidden="true" />
          Processing…
        </div>
      )}
    </div>
  );
}
