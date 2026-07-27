import test from 'node:test';
import assert from 'node:assert/strict';

import { chromaSelectionValue } from './chroma.js';

const GREEN = [0, 255, 0];

test('protects neutral black and dark blue foreground from a green key', () => {
  assert.equal(chromaSelectionValue(0, 0, 0, GREEN, 26), 0);
  assert.equal(chromaSelectionValue(5, 5, 5, GREEN, 26), 0);
  assert.equal(chromaSelectionValue(5, 10, 15, GREEN, 26), 0);
});

test('keeps weak green spill opaque so despill can correct its color', () => {
  assert.equal(chromaSelectionValue(3, 20, 5, GREEN, 26), 0);
});

test('selects genuine green screen across useful brightness levels', () => {
  assert.equal(chromaSelectionValue(0, 255, 0, GREEN, 26), 255);
  assert.equal(chromaSelectionValue(0, 40, 0, GREEN, 26), 255);
  assert.equal(chromaSelectionValue(0, 10, 0, GREEN, 26), 255);
  assert.equal(chromaSelectionValue(0, 2, 0, GREEN, 26), 128);
});

test('retains the soft tolerance band for antialiased green edges', () => {
  const value = chromaSelectionValue(3, 40, 5, GREEN, 26);
  assert.ok(value > 0 && value < 255);
});
