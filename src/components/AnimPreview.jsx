import React, { useEffect, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { Range, Toggle } from './controls.jsx';

/* Owns its own frame-index + interval so animation ticks re-render only this
   subtree, never the whole app. Frames carry a precomputed `.url`. */
export function AnimPreview({ frames, fps, setFps, playing, setPlaying, onion, setOnion, pixelView, bgClass = '', bgStyle }) {
  const [frame, setFrame] = useState(0);
  const count = frames.length;

  useEffect(() => {
    if (!playing || count < 2) return;
    const id = setInterval(() => setFrame(v => v + 1), Math.max(40, 1000 / fps));
    return () => clearInterval(id);
  }, [playing, fps, count]);

  const cur = count ? frames[frame % count] : null;
  const prev = count ? frames[(frame - 1 + count) % count] : null;
  const step = dir => { setPlaying(false); setFrame(v => (v + dir + count) % Math.max(1, count)); };

  return (
    <>
      <div className={'anim' + bgClass} style={bgStyle}>
        {cur ? (
          <div className="animstack" style={{ imageRendering: pixelView ? 'pixelated' : 'auto' }}>
            {onion && prev && <img className="onion" src={prev.url} alt="" />}
            <img src={cur.url} alt={`Frame ${(frame % count) + 1}`} />
          </div>
        ) : <span className="nogrid">No frames</span>}
      </div>
      <div className="animctl">
        <button type="button" className="iconbtn" onClick={() => step(-1)} disabled={count < 2} aria-label="Previous frame"><SkipBack size={14} /></button>
        <button type="button" className="iconbtn" onClick={() => setPlaying(p => !p)} disabled={count < 2} aria-label={playing ? 'Pause animation' : 'Play animation'} aria-pressed={playing}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" className="iconbtn" onClick={() => step(1)} disabled={count < 2} aria-label="Next frame"><SkipForward size={14} /></button>
        <div className="animinfo">
          <span>Frame {count ? (frame % count) + 1 : 0} / {count}</span>
          <Toggle small checked={onion} onChange={setOnion} tip="Ghost the previous frame underneath to spot jitter">Onion skin</Toggle>
        </div>
      </div>
      <Range label="Frame rate" tip="Playback speed here and in the exported APNG" value={fps} min={1} max={30} set={setFps} suffix=" fps" />
      <p className="hint">Spot edge flicker and frame jitter before exporting.</p>
    </>
  );
}
