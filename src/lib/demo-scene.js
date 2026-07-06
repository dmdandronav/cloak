// Synthetic "demo video" source: a procedurally animated canvas that mimics a
// jittery screen-share of an editor with secrets plus a card in frame.
// Shipping this as code instead of a binary video keeps the repo lean and the
// content auditable (every credential is fake).

export const SCENE_W = 1280;
export const SCENE_H = 720;

const ENV_LINES = [
  'NODE_ENV=production',
  'PORT=8080',
  'OPENAI_API_KEY=sk-Fk3q9Lm2Xw8Zt5Vb7Nc1',
  'AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE',
  'GITHUB_TOKEN=ghp_Qw3Er5Ty7Ui9Op1As3Df5Gh7Jk9Lz',
  'DATABASE_PASSWORD=tr0ub4dor-and-3',
  'APP_NAME=cloak-demo',
  'LOG_LEVEL=debug',
];

/**
 * Create an animated demo scene bound to a canvas. Returns a handle with
 * start/stop. The canvas can then be used exactly like a webcam frame source.
 * @param {HTMLCanvasElement} canvas
 */
export function createDemoScene(canvas) {
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let running = false;

  const draw = (t) => {
    const jx = Math.sin(t / 900) * 6 + Math.sin(t / 173) * 1.5;
    const jy = Math.cos(t / 1100) * 4 + Math.cos(t / 211) * 1.2;

    ctx.fillStyle = '#e8eaed';
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    ctx.save();
    ctx.translate(jx, jy);

    // editor window
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#c4c9cf';
    ctx.fillRect(60, 50, 760, 560);
    ctx.strokeRect(60, 50, 760, 560);
    ctx.fillStyle = '#d7dbe0';
    ctx.fillRect(60, 50, 760, 44);
    ctx.fillStyle = '#4a5158';
    ctx.font = '20px Menlo, monospace';
    ctx.fillText('.env — my-startup', 180, 79);

    ctx.fillStyle = '#22262a';
    ctx.font = '30px Menlo, monospace';
    ENV_LINES.forEach((line, i) => {
      ctx.fillText(line, 100, 160 + i * 55);
    });
    // blinking cursor
    if (Math.floor(t / 530) % 2 === 0) {
      ctx.fillRect(100 + ctx.measureText(ENV_LINES.at(-1)).width + 8, 522, 14, 32);
    }

    // credit card drifting slightly, as if held up to the camera
    ctx.save();
    ctx.translate(880 + Math.sin(t / 700) * 10, 180 + Math.cos(t / 800) * 8);
    ctx.rotate(-0.07 + Math.sin(t / 1500) * 0.02);
    ctx.fillStyle = '#2b3440';
    roundRect(ctx, 0, 0, 340, 210, 18);
    ctx.fill();
    ctx.fillStyle = '#c9a24b';
    ctx.fillRect(26, 36, 52, 38);
    ctx.fillStyle = '#f2f4f6';
    ctx.font = '31px Menlo, monospace';
    ctx.fillText('4242 4242 4242 4242', 26, 126);
    ctx.fillStyle = '#aab4be';
    ctx.font = '17px Menlo, monospace';
    ctx.fillText('VALID THRU 12/28', 26, 166);
    ctx.fillText('JANE A DEVELOPER', 26, 192);
    ctx.restore();

    ctx.fillStyle = '#9aa2aa';
    ctx.font = '18px Menlo, monospace';
    ctx.fillText('CLOAK demo scene — all credentials are fake test values', 60, 680);
    ctx.restore();
  };

  const loop = (t) => {
    draw(t);
    if (running) raf = requestAnimationFrame(loop);
  };

  return {
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
