/* ------------------------------------------------------------------ */
/* Uniform sprite-sheet layout                                         */
/*                                                                     */
/* Frames arrive already cut out and trimmed to their own tight box, so */
/* every frame has a different size AND a different offset in the       */
/* source video. Two ways to fit them to one fixed cell:                */
/*                                                                     */
/* 'motion' (default): the cell is the union of every frame's box, and  */
/* each frame keeps its own offset inside it. Because every frame is    */
/* placed in the same coordinate system, a subject that walks across    */
/* the shot still walks across the cell — nothing is re-centred, so the */
/* animation cannot wobble.                                             */
/*                                                                     */
/* 'compact': the cell is the largest width and the largest height      */
/* (taken independently, so it holds both the widest and the tallest    */
/* frame), and each frame is centred/anchored in it. This is the        */
/* smallest possible sheet, but it discards where each frame actually   */
/* sat, so any subject movement turns into frame-to-frame jitter. Right */
/* for a set of unrelated sprites, wrong for an animation.              */
/*                                                                     */
/* Either way the numbers come from the frames actually passed in, i.e. */
/* the current selection: dropping the frame that reaches furthest out  */
/* shrinks the cell, so the sheet is only ever as large as it must be.  */
/* ------------------------------------------------------------------ */

// Where a frame sits inside its cell. Sprites are centred horizontally in
// every case; `bottom` pins the baseline, which keeps a walk cycle's feet
// on the ground instead of bobbing with the frame's height.
const ANCHOR_Y = {
  center: (cellH, h) => Math.round((cellH - h) / 2),
  top: () => 0,
  bottom: (cellH, h) => cellH - h,
};

export function sheetLayout(frames, { columns = 0, margin = 0, spacing = 0, anchor = 'center', placement = 'motion' } = {}) {
  const count = frames.length;
  if (!count) return null;

  // Motion placement needs each frame's offset in the source; fall back to
  // compact if the frames were not trimmed with one (e.g. older callers).
  const positioned = placement === 'motion' && frames.every(f => Number.isFinite(f.x) && Number.isFinite(f.y));
  let cellW, cellH, offsetFor;
  if (positioned) {
    const minX = Math.min(...frames.map(f => f.x));
    const minY = Math.min(...frames.map(f => f.y));
    cellW = Math.max(1, Math.max(...frames.map(f => f.x + f.w)) - minX);
    cellH = Math.max(1, Math.max(...frames.map(f => f.y + f.h)) - minY);
    offsetFor = f => ({ ox: f.x - minX, oy: f.y - minY });
  } else {
    cellW = frames.reduce((m, f) => Math.max(m, f.w), 1);
    cellH = frames.reduce((m, f) => Math.max(m, f.h), 1);
    const offsetY = ANCHOR_Y[anchor] || ANCHOR_Y.center;
    offsetFor = f => ({ ox: Math.round((cellW - f.w) / 2), oy: offsetY(cellH, f.h) });
  }

  const cols = Math.max(1, Math.min(columns > 0 ? columns : Math.ceil(Math.sqrt(count)), count));
  const rows = Math.ceil(count / cols);
  const cells = frames.map((frame, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cellX = margin + col * (cellW + spacing);
    const cellY = margin + row * (cellH + spacing);
    const { ox, oy } = offsetFor(frame);
    return { frame, index: i, col, row, cellX, cellY, ox, oy, x: cellX + ox, y: cellY + oy };
  });
  return {
    cellW, cellH, cols, rows, cells, placement: positioned ? 'motion' : 'compact',
    width: margin * 2 + cols * cellW + spacing * (cols - 1),
    height: margin * 2 + rows * cellH + spacing * (rows - 1),
  };
}

export function drawSpriteSheet(layout) {
  const c = document.createElement('canvas');
  c.width = layout.width; c.height = layout.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  for (const cell of layout.cells) ctx.drawImage(cell.frame.canvas, cell.x, cell.y);
  return c;
}

// Atlas metadata rows for the shared ATLAS_FORMATS serialisers. The cell is
// the source size and the in-cell offset is the trim offset, so an engine
// that honours `spriteSourceSize` reproduces the grid exactly.
export function sheetFrameRecords(layout, baseName) {
  return layout.cells.map((cell, i) => ({
    name: `${baseName}_${String(i).padStart(3, '0')}.png`,
    x: cell.x, y: cell.y, w: cell.frame.w, h: cell.frame.h,
    ox: cell.ox, oy: cell.oy, srcW: layout.cellW, srcH: layout.cellH,
  }));
}
