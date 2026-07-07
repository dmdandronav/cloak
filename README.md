# CLOAK

**A virtual camera that redacts leaks before they leave your machine.** Your
webcam, screen share, or a video file passes through an in-browser pipeline that
blurs bystander faces, masks credit-card numbers, and blacks out API keys and
`.env` lines the instant they enter frame — then hands you a "safe feed" you can
pipe into any call. A live counter tallies every leak it caught.

Everything runs client-side. Nothing you point the camera at is ever uploaded.

## The 30-second demo

1. Pick a source — your webcam or the bundled **demo frame** (a mock screen with
   a fake `.env` file and a card number).
2. The **SAFE FEED** shows your face sharp while a bystander's is blurred; hold up
   a card and it's masked the moment it appears; the on-screen secrets are blacked
   out with a ⚠ box.
3. The **leaks caught** counter climbs, and the event log lists each catch by
   *kind and time* — never the secret text itself.
4. Kill shot: *"nothing you just saw ever left this laptop — airplane mode is on."*

## How it works

```
 source (webcam / demo)
        │  frame
        ▼
   ┌────────────────────────────── pipeline.jsx ──────────────────────────────┐
   │  faces.js   MediaPipe FaceDetector, every frame → blur all but enrolled  │
   │  ocr.js     tesseract.js worker, ~1200ms interval → word boxes           │
   │  secrets.js detectSecrets(text): key/JWT/entropy + luhn cards → regions  │
   │  compose:   draw source → blur face boxes → ⚠ black-box secret regions   │
   └───────────────────────────────────┬──────────────────────────────────────┘
                                        ▼
                              safe-feed <canvas>  (captureStream() → virtual cam)
```

- **`src/lib/secrets.js`** — pure, fully unit-tested: `detectSecrets` (regex bank +
  Shannon-entropy gate), `luhnValid`, `mergeRegions` (union of overlapping boxes).
- **`src/lib/ocr.js`** — tesseract.js worker, interval-scanned so it never blocks
  the render loop.
- **`src/lib/faces.js`** — MediaPipe face detection; "enroll my face" keeps the
  largest/known face sharp and blurs the rest.
- **`src/pipeline.jsx`** — the `usePipeline` hook compositing everything onto the
  safe-feed canvas.
- **`src/lib/demo-scene.js`** — a generated leaky frame so the whole thing is
  demoable with no webcam, in CI, and in screenshots.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest — 49 tests over the detection core
npm run build
```

## Performance notes

- Face detection runs every frame; OCR is interval-scanned (~1200ms) on a worker
  so text redaction adds latency to *appearing* but never stutters the video.
- Between OCR passes, the last known secret regions are held, so a key stays
  covered even on frames OCR didn't scan.

## Threat model & limits

- **Defensive, best-effort.** CLOAK reduces accidental leaks (a card, a key on a
  slide, a bystander); it is not a guarantee against a determined adversary. A
  secret visible only for a sub-second flash between OCR passes can slip through.
- **Client-side by design** — no frame is uploaded, but that also means detection
  quality is bounded by in-browser OCR/face models.
- Face "enrollment" is a size/position heuristic, not identity recognition.
- The event log deliberately records only the *kind* of leak and a timestamp,
  never the matched text, so the log itself can't leak.

## License

MIT — see [LICENSE](LICENSE).
