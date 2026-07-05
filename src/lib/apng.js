/* ------------------------------------------------------------------ */
/* Dependency-free APNG (animated PNG) encoder                          */
/* APNG keeps full 8-bit alpha, so soft contact shadows survive — GIF's */
/* 1-bit transparency would destroy them. Pixel data is written with    */
/* stored (uncompressed) DEFLATE blocks, the same trick as the ZIP      */
/* writer, so no compression dependency is needed.                      */
/* ------------------------------------------------------------------ */
import { crc32 } from './zip.js';

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function u32(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function u16be(n) { return new Uint8Array([(n >> 8) & 255, n & 255]); }
function u16le(n) { return new Uint8Array([n & 255, (n >> 8) & 255]); }
function ascii(s) { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; }

function concat(arrays) {
  let len = 0; for (const a of arrays) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

function chunk(type, data) {
  const body = concat([ascii(type), data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

function adler32(bytes) {
  let a = 1, b = 0; const MOD = 65521;
  let i = 0; const n = bytes.length;
  while (i < n) {
    let tlen = Math.min(n - i, 5552);
    while (tlen--) { a += bytes[i++]; b += a; }
    a %= MOD; b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// Wrap raw bytes in a zlib stream using stored (BTYPE=00) DEFLATE blocks.
function zlibStore(raw) {
  const parts = [new Uint8Array([0x78, 0x01])]; // CMF=deflate/32K, FLG valid (mod 31 == 0)
  let i = 0; const n = raw.length;
  do {
    const len = Math.min(65535, n - i);
    const final = (i + len >= n) ? 1 : 0;
    parts.push(new Uint8Array([final]), u16le(len), u16le((~len) & 0xffff), raw.subarray(i, i + len));
    i += len;
  } while (i < n);
  parts.push(u32(adler32(raw))); // zlib trailer is big-endian
  return concat(parts);
}

// Filtered, unfiltered (filter type 0) scanlines for an RGBA canvas.
function rawScanlines(canvas, width, height) {
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    raw.set(data.subarray(y * stride, y * stride + stride), o);
    o += stride;
  }
  return raw;
}

// frames: array of canvases, each exactly width×height with alpha.
// fps controls the frame delay (1/fps seconds). numPlays 0 = loop forever.
export function encodeAPNG(frames, { width, height, fps = 12, numPlays = 0 }) {
  const parts = [
    SIGNATURE,
    chunk('IHDR', concat([u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0])])), // 8-bit, RGBA
    chunk('acTL', concat([u32(frames.length), u32(numPlays)])),
  ];
  const delayDen = Math.max(1, Math.round(fps));
  let seq = 0;
  frames.forEach((frame, f) => {
    const fctl = concat([
      u32(seq++), u32(width), u32(height), u32(0), u32(0),
      u16be(1), u16be(delayDen), // delay = 1/fps s
      new Uint8Array([0, 0]),    // dispose: none, blend: source
    ]);
    parts.push(chunk('fcTL', fctl));
    const comp = zlibStore(rawScanlines(frame, width, height));
    parts.push(f === 0 ? chunk('IDAT', comp) : chunk('fdAT', concat([u32(seq++), comp])));
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return new Blob([concat(parts)], { type: 'image/png' });
}
