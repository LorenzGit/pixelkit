import test from 'node:test';
import assert from 'node:assert/strict';

import { sheetLayout, sheetFrameRecords } from './sheet.js';

const frames = [
  { w: 40, h: 90 }, // tallest
  { w: 80, h: 30 }, // widest
  { w: 50, h: 50 },
];

// A subject standing still on the ground while its silhouette changes width:
// the feet stay at y = 100, the body drifts right by 10px a frame.
const walk = [
  { x: 20, y: 60, w: 30, h: 40 },
  { x: 30, y: 55, w: 40, h: 45 },
  { x: 40, y: 60, w: 30, h: 40 },
];

test('the cell takes the max width and max height independently', () => {
  const l = sheetLayout(frames, { columns: 3, placement: 'compact' });
  assert.equal(l.cellW, 80);
  assert.equal(l.cellH, 90);
});

test('the cell shrinks when the biggest frames are not in the selection', () => {
  const l = sheetLayout(frames.slice(2), { columns: 3, placement: 'compact' });
  assert.equal(l.cellW, 50);
  assert.equal(l.cellH, 50);
});

test('motion placement keeps every frame in one coordinate system', () => {
  const l = sheetLayout(walk, { columns: 3 });
  assert.equal(l.placement, 'motion');
  // union of the boxes: x 20→70, y 55→100
  assert.equal(l.cellW, 50);
  assert.equal(l.cellH, 45);
  // offsets preserve the drift, and the shared baseline stays shared
  assert.deepEqual(l.cells.map(c => c.ox), [0, 10, 20]);
  assert.deepEqual(l.cells.map(c => c.oy + c.frame.h), [45, 45, 45]);
});

test('compact placement is what makes a moving subject wobble', () => {
  const l = sheetLayout(walk, { columns: 3, placement: 'compact' });
  // every frame re-centred on its own: the drift is destroyed and replaced
  // by a 5px shuffle in the opposite direction
  assert.deepEqual(l.cells.map(c => c.ox), [5, 0, 5]);
});

test('motion placement shrinks to the frames actually kept', () => {
  const l = sheetLayout(walk.slice(0, 2), { columns: 2 });
  assert.equal(l.cellW, 50); // x 20→70 still, frame 2 is the rightmost
  const tight = sheetLayout(walk.slice(0, 1), { columns: 1 });
  assert.equal(tight.cellW, 30);
  assert.equal(tight.cellH, 40);
});

test('motion placement falls back to compact without source offsets', () => {
  const l = sheetLayout(frames, { columns: 3, placement: 'motion' });
  assert.equal(l.placement, 'compact');
  assert.equal(l.cellW, 80);
});

test('auto columns lay the frames out on a square-ish grid', () => {
  assert.deepEqual(
    [4, 9, 10].map(n => {
      const l = sheetLayout(Array.from({ length: n }, () => ({ w: 10, h: 10 })));
      return [l.cols, l.rows];
    }),
    [[2, 2], [3, 3], [4, 3]],
  );
});

test('sheet size accounts for margin and spacing', () => {
  const l = sheetLayout(frames, { columns: 2, margin: 5, spacing: 3 });
  assert.equal(l.cols, 2);
  assert.equal(l.rows, 2);
  assert.equal(l.width, 5 * 2 + 80 * 2 + 3);
  assert.equal(l.height, 5 * 2 + 90 * 2 + 3);
});

test('frames are centred horizontally and anchored vertically', () => {
  const centered = sheetLayout(frames, { columns: 3 }).cells;
  assert.deepEqual(centered.map(c => c.ox), [20, 0, 15]);
  assert.deepEqual(centered.map(c => c.oy), [0, 30, 20]);

  const bottom = sheetLayout(frames, { columns: 3, anchor: 'bottom' }).cells;
  assert.deepEqual(bottom.map(c => c.oy), [0, 60, 40]);

  const top = sheetLayout(frames, { columns: 3, anchor: 'top' }).cells;
  assert.deepEqual(top.map(c => c.oy), [0, 0, 0]);
});

test('cells advance across columns then wrap to the next row', () => {
  const l = sheetLayout(frames, { columns: 2 });
  assert.deepEqual(l.cells.map(c => [c.cellX, c.cellY]), [[0, 0], [80, 0], [0, 90]]);
});

test('an empty selection has no layout', () => {
  assert.equal(sheetLayout([]), null);
});

test('atlas records report the cell as the source size', () => {
  const l = sheetLayout(frames, { columns: 3, margin: 2 });
  const records = sheetFrameRecords(l, 'clip');
  assert.equal(records[1].name, 'clip_001.png');
  assert.deepEqual(
    [records[1].w, records[1].h, records[1].srcW, records[1].srcH],
    [80, 30, 80, 90],
  );
  assert.equal(records[1].x, l.cells[1].x);
  assert.equal(records[1].oy, 30);
});
