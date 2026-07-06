// The CLOAK pipeline: raw source → hidden work canvas → redaction pass →
// visible "safe feed" canvas. The safe canvas's captureStream() is the
// virtual-camera output; the raw frame never renders to the page.
import { useEffect, useRef } from 'react';
import { scanFrame, OCR_INTERVAL_MS } from './lib/ocr.js';
import { detectBystanderFaces, warmUpFaces } from './lib/faces.js';
import { mergeRegions } from './lib/secrets.js';

const REGION_TTL_MS = 2.5 * OCR_INTERVAL_MS;
const FACE_BLUR_PX = 22;
const LABELS = {
  'card-number': 'CARD',
  'env-assignment': 'ENV SECRET',
  'high-entropy': 'HIGH ENTROPY',
  'bystander-face': 'BYSTANDER',
};

const labelFor = (kind) => LABELS[kind] || kind.replace(/-/g, ' ').toUpperCase();

/**
 * Drives the redaction loop onto `safeCanvasRef`.
 * @param {object} p
 * @param {React.RefObject} p.sourceRef - <video>, <img>, or <canvas> raw source
 * @param {React.RefObject} p.safeCanvasRef - visible safe-feed canvas
 * @param {{faces:boolean, cards:boolean, secrets:boolean}} p.toggles
 * @param {boolean} p.enrolled - presenter face enrolled (largest face kept)
 * @param {boolean} p.faceCapable - source supports MediaPipe video detection
 * @param {(e:{kind:string}) => void} p.onCatch - fired once per new redaction
 * @param {(err:Error) => void} p.onError
 */
export function usePipeline({ sourceRef, safeCanvasRef, toggles, enrolled, faceCapable, onCatch, onError }) {
  const stateRef = useRef({ ocrRegions: [], faces: [], seen: new Set(), faceCount: 0 });
  const togglesRef = useRef(toggles);
  const enrolledRef = useRef(enrolled);
  togglesRef.current = toggles;
  enrolledRef.current = enrolled;
  const onCatchRef = useRef(onCatch);
  onCatchRef.current = onCatch;

  useEffect(() => {
    const state = stateRef.current;
    let raf = 0;
    let disposed = false;
    let ocrBusy = false;
    let faceBusy = false;

    if (faceCapable && toggles.faces) warmUpFaces();

    const ocrTimer = setInterval(async () => {
      const src = sourceRef.current;
      const t = togglesRef.current;
      if (!src || ocrBusy || (!t.secrets && !t.cards) || !sourceReady(src)) return;
      ocrBusy = true;
      try {
        const snap = snapshot(src);
        const regions = await scanFrame(snap);
        if (disposed) return;
        const now = performance.now();
        const fresh = regions
          .filter((r) => (r.kind === 'card-number' ? t.cards : t.secrets))
          .map((r) => ({ ...r, lastSeen: now }));
        state.ocrRegions = [
          ...fresh,
          ...state.ocrRegions.filter(
            (old) => now - old.lastSeen < REGION_TTL_MS && !fresh.some((f) => intersects(f, old)),
          ),
        ];
        for (const r of fresh) {
          const key = `${r.kind}:${Math.round(r.x / 40)}:${Math.round(r.y / 40)}`;
          if (!state.seen.has(key)) {
            state.seen.add(key);
            onCatchRef.current?.({ kind: r.kind });
          }
        }
      } catch (err) {
        if (!disposed) onError?.(err);
      } finally {
        ocrBusy = false;
      }
    }, OCR_INTERVAL_MS);

    const drawFrame = () => {
      const src = sourceRef.current;
      const canvas = safeCanvasRef.current;
      if (!src || !canvas || !sourceReady(src)) {
        raf = requestAnimationFrame(drawFrame);
        return;
      }
      const w = src.videoWidth || src.naturalWidth || src.width;
      const h = src.videoHeight || src.naturalHeight || src.height;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      ctx.filter = 'none';
      ctx.drawImage(src, 0, 0, w, h);
      const t = togglesRef.current;

      // faces: every frame, non-blocking (last result drawn until next lands)
      if (t.faces && faceCapable && !faceBusy) {
        faceBusy = true;
        detectBystanderFaces(src, performance.now(), { enrolled: enrolledRef.current })
          .then((faces) => {
            if (disposed) return;
            if (faces.length > state.faceCount) onCatchRef.current?.({ kind: 'bystander-face' });
            state.faceCount = faces.length;
            state.faces = faces;
          })
          .catch((err) => !disposed && onError?.(err))
          .finally(() => {
            faceBusy = false;
          });
      }
      if (t.faces) {
        for (const f of state.faces) blurRegion(ctx, src, f, w, h);
      }

      const now = performance.now();
      state.ocrRegions = state.ocrRegions.filter((r) => now - r.lastSeen < REGION_TTL_MS);
      const boxes = mergeRegions(
        state.ocrRegions.filter((r) => (r.kind === 'card-number' ? t.cards : t.secrets)),
        8,
      );
      const kindAt = (box) =>
        state.ocrRegions.find((r) => intersects(r, box))?.kind || 'secret';
      for (const box of boxes) drawRedaction(ctx, box, labelFor(kindAt(box)));

      raf = requestAnimationFrame(drawFrame);
    };
    raf = requestAnimationFrame(drawFrame);

    return () => {
      disposed = true;
      clearInterval(ocrTimer);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceRef, safeCanvasRef, faceCapable]);
}

function sourceReady(src) {
  if (src.tagName === 'VIDEO') return src.readyState >= 2 && src.videoWidth > 0;
  if (src.tagName === 'IMG') return src.complete && src.naturalWidth > 0;
  return src.width > 0;
}

function snapshot(src) {
  const w = src.videoWidth || src.naturalWidth || src.width;
  const h = src.videoHeight || src.naturalHeight || src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  return c;
}

function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function blurRegion(ctx, src, f, w, h) {
  const pad = Math.max(f.w, f.h) * 0.25;
  const x = Math.max(0, f.x - pad);
  const y = Math.max(0, f.y - pad);
  const bw = Math.min(w - x, f.w + pad * 2);
  const bh = Math.min(h - y, f.h + pad * 2);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x + bw / 2, y + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.filter = `blur(${FACE_BLUR_PX}px)`;
  ctx.drawImage(src, 0, 0, w, h);
  ctx.restore();
}

function drawRedaction(ctx, box, label) {
  ctx.save();
  ctx.fillStyle = '#0a0c0e';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = '#ffb224';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.setLineDash([]);
  const tag = `⚠ ${label}`;
  ctx.font = '600 15px ui-monospace, Menlo, monospace';
  const tw = ctx.measureText(tag).width + 14;
  ctx.fillStyle = '#ffb224';
  ctx.fillRect(box.x, box.y - 22 < 0 ? box.y : box.y - 22, tw, 22);
  ctx.fillStyle = '#0a0c0e';
  ctx.fillText(tag, box.x + 7, (box.y - 22 < 0 ? box.y : box.y - 22) + 16);
  ctx.restore();
}
