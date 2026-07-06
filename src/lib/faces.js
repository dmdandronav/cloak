// Face detection — MediaPipe tasks-vision, per-frame.
// "Enroll" is a hackathon-grade heuristic: the enrolled presenter is assumed
// to be the largest face in frame; every other face is a bystander → blurred.

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let detectorPromise = null;

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      });
    })().catch((err) => {
      detectorPromise = null;
      throw err;
    });
  }
  return detectorPromise;
}

/** Preload the model so first frame isn't slow. Safe to call repeatedly. */
export function warmUpFaces() {
  return getDetector().catch(() => null);
}

/**
 * Detect faces in a video frame.
 * @param {HTMLVideoElement} video
 * @param {number} timestampMs
 * @param {{enrolled: boolean}} options - when enrolled, the largest face is
 *   treated as the presenter and excluded from the returned bystander list.
 * @returns {Promise<Array<{x:number,y:number,w:number,h:number}>>} faces to blur
 */
export async function detectBystanderFaces(video, timestampMs, { enrolled } = {}) {
  const detector = await getDetector();
  const result = detector.detectForVideo(video, timestampMs);
  const faces = (result.detections || [])
    .map((d) => d.boundingBox)
    .filter(Boolean)
    .map((b) => ({ x: b.originX, y: b.originY, w: b.width, h: b.height }));

  if (!enrolled || faces.length === 0) return faces;
  const largest = faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  return faces.filter((f) => f !== largest);
}
