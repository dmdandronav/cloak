// OCR scanning — tesseract.js worker, interval-driven (~1 fps).
// Maps recognized text lines to redaction regions via the pure detection core.
import { detectSecrets, mergeRegions } from './secrets.js';

export const OCR_INTERVAL_MS = 1200;
const REGION_PAD = 6;

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) =>
      createWorker('eng', 1, { logger: () => {} }),
    );
  }
  return workerPromise;
}

/**
 * Recognize text in a frame and return redaction regions for any line that
 * contains a detected secret or card number. Regions are in canvas pixels.
 *
 * @param {HTMLCanvasElement} canvas - the current composited frame
 * @returns {Promise<Array<{x:number,y:number,w:number,h:number,kind:string,confidence:number}>>}
 */
export async function scanFrame(canvas) {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  const regions = [];

  for (const line of iterLines(data)) {
    const text = (line.text || '').trim();
    if (!text) continue;
    const hits = detectSecrets(text);
    if (hits.length === 0) continue;
    // Redact the whole line: word-level alignment of OCR output to regex
    // offsets is brittle, and over-redacting is the safe failure mode.
    const { x0, y0, x1, y1 } = line.bbox;
    const merged = mergeRegions(
      [{ x: x0 - REGION_PAD, y: y0 - REGION_PAD, w: x1 - x0 + REGION_PAD * 2, h: y1 - y0 + REGION_PAD * 2 }],
      0,
    );
    for (const box of merged) {
      regions.push({ ...box, kind: hits[0].kind, confidence: hits[0].confidence });
    }
  }
  return regions;
}

function* iterLines(data) {
  if (Array.isArray(data.lines)) {
    yield* data.lines;
    return;
  }
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      yield* paragraph.lines || [];
    }
  }
}

/** Terminate the shared worker (used on teardown). */
export async function disposeOcr() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}
