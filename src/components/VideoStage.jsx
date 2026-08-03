import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Clapperboard, Film, Grid3X3, ImageIcon,
  FlipHorizontal2, Pause, Play, Scissors, SkipBack, SkipForward, X,
} from 'lucide-react';
import { formatTime } from '../lib/video.js';
import { SheetAnimation } from './SheetAnimation.jsx';

/* Center stage for the video workspace.

   Four views over one clip, all fed by the same selection: the source video
   itself (playable the moment it is dropped), a single frame with the live
   cutout, the packed sheet, and the animation those frames produce. The
   filmstrip sits under all of them, so whichever view is open, picking frames
   is one click away and the sheet / animation follow immediately. */

const VIEWS = [
  ['video', 'Video', Film, 'Play the clip you dropped'],
  ['frames', 'Frame', ImageIcon, 'Inspect one frame with the background removal applied live'],
  ['sheet', 'Sheet', Grid3X3, 'The packed sprite sheet of the frames you kept'],
  ['anim', 'Animation', Clapperboard, 'Play the kept frames back, aligned exactly as the sheet packs them'],
];

export function VideoStage({
  videoEl, meta, duration, range, onSetStart, onSetEnd,
  frames, previewIndex, setPreviewIndex, isOff, toggleFrame, onAll, onNone, onInvert,
  previewUrl, view, setView, sheet, showGrid, hasCuts, preview,
  fps, setFps, playing, setPlaying, onion,
  flipX, setFlipX,
  pixelView, bgClass, bgStyle, onPick, pickHint,
  selectedCount, progress, onCancel, onExtract, onBuild, busyLabel,
}) {
  const sheetHolder = useRef(null);
  const playerHolder = useRef(null);
  const strip = useRef(null);
  const [skipDropped, setSkipDropped] = useState(false);
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  // Re-parent the live sheet canvas whenever a new one is built or the sheet
  // view remounts (leaving the view takes the canvas out of the DOM with it).
  useEffect(() => {
    const el = sheetHolder.current;
    if (!el) return;
    el.replaceChildren();
    if (sheet?.canvas) {
      sheet.canvas.className = 'sheetCanvas';
      el.appendChild(sheet.canvas);
    }
  }, [sheet, view]);

  // The <video> is the same element the extractor seeks, so playback, scrubbing
  // and extraction all act on one decoder rather than two out-of-sync copies.
  useEffect(() => {
    const el = playerHolder.current;
    if (!el || !videoEl) return undefined;
    videoEl.controls = true;
    videoEl.className = 'videoPlayer';
    el.appendChild(videoEl);
    return () => { if (videoEl.parentNode === el) el.removeChild(videoEl); };
  }, [videoEl, view]);

  function pick(e) {
    if (!onPick || !meta) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // object-fit letterboxes the frame inside its element, so map through the
    // rendered box; clicks on the letterbox are not pixels and are ignored.
    const k = Math.min(r.width / meta.w, r.height / meta.h);
    const displayX = (e.clientX - r.left - (r.width - meta.w * k) / 2) / k;
    const y = (e.clientY - r.top - (r.height - meta.h * k) / 2) / k;
    if (displayX < 0 || y < 0 || displayX >= meta.w || y >= meta.h) return;
    // The cutout recipe still runs on the original source pixels. When the
    // Frame view is mirrored, map the click through that mirror so the pixel
    // the user sees is still the one that gets sampled.
    const sourceX = flipX ? meta.w - displayX : displayX;
    onPick({ x: Math.min(meta.w - 1, Math.floor(sourceX)), y: Math.floor(y) });
  }

  // Prev/next either walk every extracted frame or hop between the kept ones.
  const stepFrame = dir => {
    if (!frames.length) return;
    setPreviewIndex(i => {
      let n = i;
      for (let k = 0; k < frames.length; k++) {
        n = (n + dir + frames.length) % frames.length;
        if (!skipDropped || !isOff(frames[n])) return n;
      }
      return i; // every frame is dropped — stay put
    });
  };

  const current = frames[previewIndex] || null;
  const currentOff = current ? isOff(current) : false;

  // Keep the inspected frame visible in the strip, so stepping never walks off
  // into the hidden part of it.
  useEffect(() => {
    strip.current?.children[previewIndex]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [previewIndex]);

  // How much of the strip is off-screen, so the arrows and edge fades only
  // appear when there really is more to see.
  const readScroll = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    setScrollState({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return undefined;
    readScroll();
    const ro = new ResizeObserver(readScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frames.length, readScroll]);

  const scrollStrip = dir => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className={'preview video' + bgClass} style={bgStyle}>
      {!videoEl ? (
        <div className="empty">
          <div className="emptyglow"><Film size={44} aria-hidden="true" /></div>
          <h1>Turn a video into a sprite sheet</h1>
          <p>Drop an MP4, WebM or MOV and it starts playing right here. Sample it into frames, keep the ones you want, and PixelKit removes the chroma background from each, trims it, and packs them onto a grid sized to the largest frame you kept — with the animation playing back as you go.</p>
          <div className="emptytags">
            {['Play & trim', 'Frame picker', 'Chroma key + soft shadow', 'Auto trim', 'Max-frame grid', 'Live animation'].map(t => <span key={t}>{t}</span>)}
          </div>
        </div>
      ) : (
        <div className="videoLayout">
          <div className="videoBar">
            <div className="segbtns inline" role="group" aria-label="Video preview mode">
              {VIEWS.map(([id, label, Icon, tip]) => {
                const disabled = (id === 'frames' && !frames.length) || ((id === 'sheet' || id === 'anim') && !sheet);
                return (
                  <button
                    key={id} type="button" className={view === id ? 'on' : ''} aria-pressed={view === id}
                    disabled={disabled} data-tip={disabled ? 'Extract and build frames first' : tip}
                    onClick={() => setView(id)}
                  >
                    <Icon size={13} /> {label}
                  </button>
                );
              })}
            </div>
            <span className="videoCount">
              {frames.length
                ? <><b>{selectedCount}</b> of {frames.length} frames kept</>
                : <>{formatTime(duration || 0)} clip · not sampled yet</>}
              {sheet && <> · cell <b>{sheet.cellW}×{sheet.cellH}</b> · {sheet.cols}×{sheet.rows} grid</>}
            </span>
            {!!frames.length && (
              <div className="videoSelect">
                <button type="button" onClick={onAll} data-tip="Keep every frame">All</button>
                <button type="button" onClick={onNone} data-tip="Drop every frame">None</button>
                <button type="button" onClick={onInvert} data-tip="Swap kept and dropped frames">Invert</button>
              </div>
            )}
          </div>

          <div className={'videoMain' + (view === 'video' ? ' source' : '')} style={{ imageRendering: pixelView ? 'pixelated' : 'auto' }}>
            {view === 'video' && (
              <div className="playerBox">
                <div ref={playerHolder} className="playerHolder" />
                <div className="playerTools">
                  <span>Trim: <b>{range.start.toFixed(2)}s</b> → <b>{range.end.toFixed(2)}s</b></span>
                  <button type="button" onClick={() => onSetStart(videoEl.currentTime)} data-tip="Use the playhead position as the first sampled frame">Set start here</button>
                  <button type="button" onClick={() => onSetEnd(videoEl.currentTime)} data-tip="Use the playhead position as the last sampled frame">Set end here</button>
                  <button type="button" className="go" onClick={onExtract} disabled={!!progress} data-tip="Sample this range into frames">
                    <Film size={13} /> {frames.length ? 'Re-extract frames' : 'Extract frames'}
                  </button>
                </div>
              </div>
            )}

            {view === 'frames' && (previewUrl
              ? (
                  <div className="frameCol">
                    {/* Play happens right here, in the same rectangle as the
                        still frame — not in a thumbnail off to one side. */}
                    {playing && preview
                      ? <SheetAnimation cells={preview.cells} cellW={preview.cellW} cellH={preview.cellH} boxW={meta?.w} boxH={meta?.h} fps={fps} playing={playing} onion={onion} label />
                      : <img className="videoFrame" src={previewUrl} draggable={false} onClick={pick} alt={`Frame ${previewIndex + 1} preview`} style={{ transform: flipX ? 'scaleX(-1)' : undefined }} />}
                    <div className="frameCtl">
                      <button
                        type="button" className={'keepBtn play' + (playing ? ' on' : '')}
                        onClick={() => setPlaying(p => !p)} disabled={!preview}
                        data-tip={preview ? (playing ? 'Pause and go back to the frame you were on' : 'Play the frames you kept, right here') : 'Keep at least one frame to play'}
                      >
                        {playing ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Play</>}
                      </button>
                      <button
                        type="button" className={'skipBtn' + (flipX ? ' on' : '')}
                        aria-pressed={flipX} onClick={() => setFlipX(!flipX)}
                        data-tip="Mirror the frame, filmstrip, animation, sprite sheet, and exports horizontally"
                      >
                        <FlipHorizontal2 size={13} /> Flip X
                      </button>
                      {/* Playing is for watching, paused is for editing: the
                          per-frame controls would only describe the frame you
                          are no longer looking at. */}
                      {!playing && <>
                        <button type="button" className="iconbtn" onClick={() => stepFrame(-1)} aria-label="Previous frame" data-tip="Previous frame"><SkipBack size={14} /></button>
                        <span>Frame <b>{previewIndex + 1}</b> / {frames.length} · {formatTime(current?.time || 0)}</span>
                        <button type="button" className="iconbtn" onClick={() => stepFrame(1)} aria-label="Next frame" data-tip="Next frame"><SkipForward size={14} /></button>
                        <button
                          type="button" className={'skipBtn' + (skipDropped ? ' on' : '')}
                          aria-pressed={skipDropped} onClick={() => setSkipDropped(s => !s)}
                          data-tip={skipDropped ? 'Prev/next are hopping between kept frames only — click to walk every frame' : 'Prev/next walk every extracted frame — click to skip the dropped ones'}
                        >
                          Skip dropped
                        </button>
                        {current && (
                          <button
                            type="button" className={'keepBtn' + (currentOff ? '' : ' on')}
                            onClick={() => toggleFrame(current)}
                            data-tip={currentOff ? 'Add this frame back to the sheet and the animation' : 'Remove this frame from the sheet and the animation'}
                          >
                            {currentOff ? <><X size={13} /> Dropped</> : <><Check size={13} /> Kept</>}
                          </button>
                        )}
                      </>}
                    </div>
                    <p className="frameNote">
                      {playing && preview
                        ? <>Playing the {preview.cells.length} frames you kept{preview.raw ? ' — straight from the video, not cut out yet' : ''} at {fps} fps</>
                        : <>{selectedCount} of {frames.length} frames kept{preview ? '' : ' — keep at least one to play'}</>}
                    </p>
                  </div>
              )
              : <p className="nogrid">Extract frames to inspect them.</p>)}

            {view === 'sheet' && (sheet
              ? (
                <div className="dockRow">
                  <div className="sheetWrap">
                    <div ref={sheetHolder} className="sheetHolder" />
                    {showGrid && (
                      <svg className="sheetGrid" viewBox={`0 0 ${sheet.width} ${sheet.height}`} preserveAspectRatio="none" aria-hidden="true">
                        {sheet.cells.map(c => (
                          <rect key={c.index} x={c.cellX} y={c.cellY} width={sheet.cellW} height={sheet.cellH}
                            fill="none" stroke="#7c6cff" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        ))}
                      </svg>
                    )}
                  </div>
                  {/* The sheet and what it animates into, on one screen. */}
                  <aside className="sheetDock">
                    <b>Result</b>
                    <SheetAnimation cells={sheet.cells} cellW={sheet.cellW} cellH={sheet.cellH} fps={fps} playing={playing} onion={onion} />
                    <span>{sheet.cells.length} frames · {fps} fps</span>
                    <button type="button" className={'dockPlay' + (playing ? '' : ' paused')} onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause preview' : 'Play preview'}>
                      {playing ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Play</>}
                    </button>
                  </aside>
                </div>
              )
              : <p className="nogrid">Remove the background from the frames to build the sheet.</p>)}

            {view === 'anim' && (sheet
              ? (
                <div className="animBig">
                  <SheetAnimation cells={sheet.cells} cellW={sheet.cellW} cellH={sheet.cellH} fps={fps} playing={playing} onion={onion} label />
                  <div className="animCtlRow">
                    <button type="button" className="iconbtn" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}>
                      {playing ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <label className="animFps">
                      {fps} fps
                      <input type="range" min="1" max="30" value={fps} aria-label="Frame rate" onChange={e => setFps(+e.target.value)} />
                    </label>
                    <span>{sheet.cells.length} frames · {sheet.cellW}×{sheet.cellH}</span>
                  </div>
                </div>
              )
              : <p className="nogrid">Remove the background from the frames to see the animation.</p>)}
          </div>

          {!!frames.length && (
            <>
              <div className="filmHead">
                <span><Scissors size={12} /> Filmstrip — <b>{frames.length}</b> frames, scroll sideways for the rest</span>
                {!hasCuts && <button type="button" className="go" onClick={onBuild} disabled={!!progress}>Remove background &amp; build</button>}
              </div>
              <div className={'filmScroll' + (scrollState.left ? ' moreLeft' : '') + (scrollState.right ? ' moreRight' : '')}>
                {scrollState.left && <button type="button" className="filmArrow left" onClick={() => scrollStrip(-1)} aria-label="Scroll filmstrip left"><ChevronLeft size={16} /></button>}
                {scrollState.right && <button type="button" className="filmArrow right" onClick={() => scrollStrip(1)} aria-label="Scroll filmstrip right"><ChevronRight size={16} /></button>}
              <div className="filmstrip" ref={strip} onScroll={readScroll} role="group" aria-label="Extracted frames">
                {frames.map((f, i) => {
                  const off = isOff(f);
                  return (
                    <div className={'filmTile' + (i === previewIndex ? ' cur' : '') + (off ? ' off' : '')} key={f.index}>
                      <button type="button" className="filmPick" aria-pressed={i === previewIndex} onClick={() => setPreviewIndex(i)} data-tip={`Inspect frame ${i + 1} at ${formatTime(f.time)}`}>
                        <img src={f.thumb} draggable={false} alt="" style={{ transform: flipX ? 'scaleX(-1)' : undefined }} />
                        <span>{i + 1}</span>
                      </button>
                      <button type="button" className="filmToggle" onClick={() => toggleFrame(f)}
                        aria-label={off ? `Keep frame ${i + 1}` : `Drop frame ${i + 1}`}
                        data-tip={off ? 'Keep this frame' : 'Drop this frame'}>
                        {off ? <X size={11} /> : <Check size={11} />}
                      </button>
                    </div>
                  );
                })}
              </div>
              </div>
            </>
          )}
        </div>
      )}

      {view === 'frames' && !!frames.length && pickHint && (
        <div className="drawhint" role="status">{pickHint}</div>
      )}

      {progress && (
        <div className="busy" role="status" aria-live="polite">
          <span className="spin" aria-hidden="true" />
          <span className="busyAi">
            <span>{busyLabel || progress.label} {progress.done} / {progress.total}</span>
            <span className="busyBar"><b style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></span>
          </span>
          {onCancel && <button type="button" className="busyCancel" onClick={onCancel}>Stop</button>}
        </div>
      )}
    </div>
  );
}
