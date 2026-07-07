// CLOAK — the operator console: source picker, safe-feed canvas, toggles,
// leak counter, event log. The event log records kind + time only; secret
// text is never stored or rendered anywhere.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePipeline } from './pipeline.jsx';
import { createDemoScene, SCENE_W, SCENE_H } from './lib/demo-scene.js';

const MAX_LOG_ENTRIES = 40;

const KIND_LABELS = {
  'bystander-face': 'BYSTANDER FACE BLURRED',
  'card-number': 'CARD NUMBER MASKED',
  'env-assignment': 'ENV SECRET BLACKED OUT',
  'high-entropy': 'HIGH-ENTROPY TOKEN BLACKED OUT',
  'aws-access-key': 'AWS KEY BLACKED OUT',
  'github-token': 'GITHUB TOKEN BLACKED OUT',
  'openai-key': 'OPENAI KEY BLACKED OUT',
  'stripe-key': 'STRIPE KEY BLACKED OUT',
  'slack-token': 'SLACK TOKEN BLACKED OUT',
  'google-api-key': 'GOOGLE KEY BLACKED OUT',
  jwt: 'JWT BLACKED OUT',
  'private-key': 'PRIVATE KEY BLACKED OUT',
};

const labelFor = (kind) => KIND_LABELS[kind] || `${kind.replace(/-/g, ' ').toUpperCase()} REDACTED`;

const timeStamp = () =>
  new Date().toLocaleTimeString('en-US', { hour12: false });

export default function App() {
  const [source, setSource] = useState('demo'); // 'demo' | 'webcam'
  const [toggles, setToggles] = useState({ faces: true, cards: true, secrets: true });
  const [enrolled, setEnrolled] = useState(true);
  const [events, setEvents] = useState([]);
  const [leakCount, setLeakCount] = useState(0);
  const [error, setError] = useState(null);

  const videoRef = useRef(null);
  const demoCanvasRef = useRef(null);
  const sourceRef = useRef(null);
  const safeCanvasRef = useRef(null);

  const onCatch = useCallback(({ kind }) => {
    setLeakCount((n) => n + 1);
    setEvents((prev) =>
      [{ id: crypto.randomUUID(), kind, at: timeStamp() }, ...prev].slice(0, MAX_LOG_ENTRIES),
    );
  }, []);

  const onError = useCallback((err) => {
    setError(err?.message || String(err));
  }, []);

  // wire the active source element into sourceRef + manage webcam/demo lifecycle
  useEffect(() => {
    setError(null);
    if (source === 'demo') {
      const canvas = demoCanvasRef.current;
      sourceRef.current = canvas;
      const scene = createDemoScene(canvas);
      scene.start();
      return () => scene.stop();
    }

    const video = videoRef.current;
    sourceRef.current = video;
    let stream = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: SCENE_W }, height: { ideal: SCENE_H } } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .catch((err) => setError(`webcam unavailable — ${err.message}`));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [source]);

  usePipeline({
    sourceRef,
    safeCanvasRef,
    toggles,
    enrolled,
    faceCapable: source === 'webcam',
    onCatch,
    onError,
  });

  const flipToggle = (key) => setToggles((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">
          <span className="wordmark-block" aria-hidden="true" />
          CLOAK
        </h1>
        <p className="tagline">nothing leaves this machine</p>
        <div className="leak-counter" role="status" aria-live="polite">
          <span className="leak-counter-label">leaks caught</span>
          <span className="leak-counter-value">{String(leakCount).padStart(3, '0')}</span>
        </div>
      </header>

      <main className="stage">
        <section className="feed" aria-labelledby="feed-heading">
          <div className="feed-chrome">
            <h2 id="feed-heading" className="feed-title">
              SAFE FEED <span className="live-dot" aria-hidden="true" /> LIVE
            </h2>
            <span className="feed-note">this canvas is the virtual camera output</span>
          </div>
          <div className="feed-frame">
            <canvas ref={safeCanvasRef} className="safe-canvas" width={SCENE_W} height={SCENE_H} />
          </div>
          {error && (
            <p className="feed-error" role="alert">
              {error}
            </p>
          )}
          {/* raw sources: never displayed */}
          <video ref={videoRef} className="offscreen" muted playsInline />
          <canvas ref={demoCanvasRef} className="offscreen" />
        </section>

        <aside className="panel" aria-label="Controls">
          <fieldset className="panel-group">
            <legend>source</legend>
            <div className="segmented" role="radiogroup" aria-label="Input source">
              {['demo', 'webcam'].map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={source === s}
                  className={source === s ? 'seg-btn is-active' : 'seg-btn'}
                  onClick={() => setSource(s)}
                >
                  {s === 'demo' ? 'demo scene' : 'webcam'}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="panel-group">
            <legend>redactions</legend>
            {[
              ['faces', 'blur bystander faces'],
              ['cards', 'mask card numbers'],
              ['secrets', 'black out API keys / env'],
            ].map(([key, label]) => (
              <label key={key} className="toggle-row">
                <input
                  type="checkbox"
                  checked={toggles[key]}
                  onChange={() => flipToggle(key)}
                />
                <span className="toggle-track" aria-hidden="true" />
                <span className="toggle-label">{label}</span>
              </label>
            ))}
            {source === 'webcam' && (
              <label className="toggle-row">
                <input type="checkbox" checked={enrolled} onChange={() => setEnrolled((e) => !e)} />
                <span className="toggle-track" aria-hidden="true" />
                <span className="toggle-label">keep largest face sharp (you)</span>
              </label>
            )}
          </fieldset>

          <section className="panel-group event-log" aria-label="Redaction event log">
            <h3 className="log-heading">event log</h3>
            <p className="log-note">kinds + timestamps only — redacted content is never stored</p>
            <ol className="log-list">
              {events.length === 0 && <li className="log-empty">watching…</li>}
              {events.map((e) => (
                <li key={e.id} className="log-entry">
                  <span className="log-time">{e.at}</span>
                  <span className="log-kind">{labelFor(e.kind)}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </main>

      <footer className="colophon">
        <span>zero backend · zero API keys · all inference in-browser (wasm)</span>
        <span>OCR every 1.2s · faces every frame</span>
      </footer>
    </div>
  );
}
