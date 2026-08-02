/* ------------------------------------------------------------------ */
/* Video → frames                                                      */
/*                                                                     */
/* Frames are pulled by seeking, not by playing: a play-through drops   */
/* frames whenever the main thread is busy (and the removal recipe      */
/* keeps it busy), while seek → `seeked` → drawImage is deterministic   */
/* and gives the exact requested timestamps every run. Extraction is    */
/* therefore sequential and cancellable rather than fast.               */
/* Everything stays local: the file is only ever an object URL fed to   */
/* a detached <video> element.                                          */
/* ------------------------------------------------------------------ */

const SEEK_TIMEOUT_MS = 10000;
const DURATION_TIMEOUT_MS = 4000;

// Streamed WebM/MKV files report Infinity until something forces the demuxer
// to walk to the end; seeking far past the end does exactly that.
function resolveDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return Promise.resolve(video.duration);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('durationchange', onChange); };
    const onChange = () => {
      if (!Number.isFinite(video.duration)) return;
      cleanup();
      video.currentTime = 0;
      resolve(video.duration);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Could not read the video duration')); }, DURATION_TIMEOUT_MS);
    video.addEventListener('durationchange', onChange);
    video.currentTime = 1e6;
  });
}

// Decode a File/Blob into a detached <video>. The caller owns the object URL
// and must revoke it when done (see releaseVideo).
export function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const fail = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode that video')); };
    video.addEventListener('error', fail, { once: true });
    video.addEventListener('loadedmetadata', () => {
      resolveDuration(video).then(
        duration => resolve({ video, url, duration, width: video.videoWidth, height: video.videoHeight }),
        fail,
      );
    }, { once: true });
    video.src = url;
  });
}

export function releaseVideo(handle) {
  if (!handle) return;
  handle.video.removeAttribute('src');
  handle.video.load();
  URL.revokeObjectURL(handle.url);
}

export function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', ok);
      video.removeEventListener('error', bad);
    };
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error(`Could not seek to ${time.toFixed(2)}s`)); };
    const timer = setTimeout(bad, SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', ok);
    video.addEventListener('error', bad);
    video.currentTime = time;
  });
}

// `seeked` fires once the frame is decoded; one paint tick later it is
// guaranteed to be what drawImage reads.
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

export function grabVideoFrame(video, scale = 1) {
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, w, h);
  return c;
}

// Small preview image for the filmstrip, so the UI never holds a full-size
// data URL per frame. JPEG for opaque source frames, PNG when alpha matters.
export function thumbnailURL(canvas, max = 112, type = 'image/png') {
  const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * k));
  c.height = Math.max(1, Math.round(canvas.height * k));
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL(type, 0.72);
}

// Timestamps to sample, clamped to the trimmed range and the frame budget.
export function frameTimes({ start, end, fps, maxFrames }) {
  const step = 1 / Math.max(1, fps);
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(from, end);
  const times = [];
  for (let t = from; t <= to + 1e-4 && times.length < maxFrames; t += step) times.push(+t.toFixed(4));
  return times;
}

// Walk the timestamps, returning one canvas (plus a thumbnail) per frame.
// `isCancelled` is polled between frames so a long extraction can be stopped.
export async function extractVideoFrames(video, { times, scale = 1, thumbSize = 112, onProgress, isCancelled }) {
  const frames = [];
  // The very last timestamp can sit exactly on the duration, where some
  // decoders return the black frame past the end.
  const last = Math.max(0, (video.duration || 0) - 1e-3);
  for (let i = 0; i < times.length; i++) {
    if (isCancelled?.()) break;
    await seekVideo(video, Math.min(times[i], last));
    await nextPaint();
    const canvas = grabVideoFrame(video, scale);
    frames.push({ index: i, time: times[i], canvas, thumb: thumbnailURL(canvas, thumbSize, 'image/jpeg') });
    onProgress?.(i + 1, times.length);
  }
  return frames;
}

export function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}
