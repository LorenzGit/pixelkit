/* ------------------------------------------------------------------ */
/* Canvas helpers (pure, DOM canvas only)                              */
/* ------------------------------------------------------------------ */
import { ALPHA_VISIBLE } from './constants.js';

// Decode a File/Blob into an <img>, returning the element and its object URL.
// The caller owns the URL and must revoke it when done.
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });
}

export function drawImageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  // Create the context with willReadFrequently up front: getContext caches the
  // first context, so passing the flag on a later getImageData call is ignored.
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  return c;
}

export function dataURL(canvas) {
  return canvas.toDataURL('image/png');
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export function cropCanvas(src, x, y, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }).drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

export function scaleCanvas(src, factor, pixel) {
  if (factor === 1) return src;
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * factor);
  c.height = Math.round(src.height * factor);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = !pixel;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Crop to the tight bounding box of visible pixels. Returns null if empty.
export function trimCanvas(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > ALPHA_VISIBLE) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const tw = maxX - minX + 1, th = maxY - minY + 1;
  return { canvas: cropCanvas(canvas, minX, minY, tw, th), x: minX, y: minY, w: tw, h: th };
}
