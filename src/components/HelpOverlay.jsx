import React from 'react';
import { X, Keyboard, Lightbulb } from 'lucide-react';

const SHORTCUTS = [
  ['Click', 'Magic wand — select & remove the clicked background area'],
  ['Ctrl+Z', 'Undo the last wand click'],
  ['B', 'Hold to peek at the original (before)'],
  ['L', 'Toggle the lasso (keep / erase areas)'],
  ['Enter', 'Close the current lasso polygon'],
  ['Esc', 'Cancel the current shape / exit the active tool'],
  ['C', 'Copy the result to the clipboard'],
  ['E', 'Export (PNG, or atlas in sheet mode)'],
  ['Space', 'Play / pause animation'],
  ['1 – 4', 'Preview background: checker / dark / light / contrast'],
  ['+ / −', 'Zoom in / out'],
  ['0', 'Reset zoom & pan'],
  ['V', 'Paste an image from the clipboard'],
  ['?', 'Open or close this help'],
];

const TIPS = [
  ['Click every background area', 'The wand only selects pixels connected to your click. Background split into pockets (between limbs, inside handles)? Click each pocket.'],
  ['The recipe', 'Each click flood-selects at your tolerance, then the selection is contracted, smoothed, feathered and cleared — the classic Photoshop cleanup, automated.'],
  ['Green / magenta screens', 'Switch Mode to Chroma key: the key color (default #00FF00 — no clicks needed) is removed at every brightness, shadows and enclosed pockets included, and its spill decontaminated from sprite edges and transparent pixels. Click the image to sample a different screen color.'],
  ['Soft shadows', 'Pixels that are a darkened version of the background you clicked come back as translucent black shadow — anchored to your wand clicks, so it works on any background color. Tune it with Strength.'],
  ['Keep / erase areas', 'Draw a lasso or box to protect details the wand eats, force-erase leftovers, or Subtract to carve a shape back out.'],
  ['Packed vs Uniform grid', 'Most atlases are packed randomly — keep Packed atlas. Use Uniform grid only for true fixed-frame animation sheets.'],
];

export function HelpOverlay({ onClose }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Help and keyboard shortcuts" onClick={onClose}>
      <div className="overlayCard" onClick={e => e.stopPropagation()}>
        <header className="overlayHead">
          <b>PixelKit help</b>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close help"><X size={16} /></button>
        </header>
        <div className="overlayBody">
          <div className="helpCol">
            <h3><Keyboard size={15} /> Keyboard shortcuts</h3>
            <dl className="shortcuts">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>
              ))}
            </dl>
          </div>
          <div className="helpCol">
            <h3><Lightbulb size={15} /> Workflow tips</h3>
            <ul className="tips">
              {TIPS.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
