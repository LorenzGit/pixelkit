import React, { useEffect, useRef, useState } from 'react';

/* Plays the selected frames back inside the sheet's own cell box.

   It draws the trimmed frame canvases straight onto one canvas at their cell
   offsets — no data URLs anywhere. That matters: re-encoding 200 frames to
   PNG every time a slider moves would stall the tab, whereas drawImage per
   tick is free and, because it reuses the very offsets the sheet was packed
   with, the playback is pixel-identical to the exported sheet and APNG.

   `boxW`/`boxH` draw the cells centred inside a larger box — the source frame
   size — so playback happens in exactly the same rectangle, at exactly the
   same scale, as the still frame it replaces. Pressing play then animates in
   place instead of swapping in a differently sized picture. */
export function SheetAnimation({ cells, cellW, cellH, fps, playing, onion, label, boxW, boxH }) {
  const ref = useRef(null);
  const [frame, setFrame] = useState(0);
  const count = cells?.length || 0;
  const w = boxW || cellW, h = boxH || cellH;
  const padX = Math.round((w - cellW) / 2), padY = Math.round((h - cellH) / 2);

  useEffect(() => {
    if (!playing || count < 2) return undefined;
    const id = setInterval(() => setFrame(v => v + 1), Math.max(40, 1000 / fps));
    return () => clearInterval(id);
  }, [playing, fps, count]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !count) return;
    canvas.width = w; canvas.height = h; // also clears
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const cur = cells[frame % count];
    if (onion && count > 1) {
      const prev = cells[(frame - 1 + count) % count];
      ctx.globalAlpha = 0.26;
      ctx.drawImage(prev.frame.canvas, padX + prev.ox, padY + prev.oy);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(cur.frame.canvas, padX + cur.ox, padY + cur.oy);
  }, [frame, cells, w, h, padX, padY, onion, count]);

  if (!count) return <span className="nogrid">Nothing selected</span>;
  return (
    <div className="animCanvasWrap">
      <canvas ref={ref} className="animCanvas" aria-label={`Animation frame ${(frame % count) + 1} of ${count}`} />
      {label && <span className="animLabel">{(frame % count) + 1} / {count}</span>}
    </div>
  );
}
