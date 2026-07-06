// CLOAK detection core — pure functions, no DOM, no network.
// Everything in this file is unit-testable in plain Node.

const ENTROPY_THRESHOLD = 4.0;
const ENTROPY_MIN_LENGTH = 20;
const ENV_VALUE_MIN_LENGTH = 8;
const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;

/**
 * Known-prefix secret patterns. Order matters: more specific first.
 * Each entry: { kind, re, confidence }
 */
const SECRET_PATTERNS = [
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g, confidence: 0.99 },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, confidence: 0.99 },
  { kind: 'openai-key', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g, confidence: 0.97 },
  { kind: 'stripe-key', re: /\b[rps]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, confidence: 0.98 },
  { kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, confidence: 0.98 },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, confidence: 0.98 },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    confidence: 0.95,
  },
  {
    kind: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    confidence: 0.99,
  },
];

/**
 * .env-style assignment lines: KEY=value where KEY smells sensitive.
 */
const ENV_LINE_RE =
  /^[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?|AUTH)[A-Z0-9_]*)[ \t]*=[ \t]*("[^"\n]{4,}"|'[^'\n]{4,}'|\S+)/gm;

/** Candidate card sequences: 13-19 digits, optional space/dash separators. */
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

/** Candidate high-entropy tokens (base64-ish charset). */
const ENTROPY_CANDIDATE_RE = /[A-Za-z0-9+/_=-]{20,}/g;

/**
 * Shannon entropy of a string in bits per character.
 * @param {string} s
 * @returns {number}
 */
export function shannonEntropy(s) {
  if (!s) return 0;
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Luhn checksum validation for card numbers.
 * @param {string} digits - digits only (separators must be stripped by caller)
 * @returns {boolean}
 */
export function luhnValid(digits) {
  if (typeof digits !== 'string') return false;
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length < CARD_MIN_DIGITS || digits.length > CARD_MAX_DIGITS) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function isEntropyCandidate(token) {
  if (token.length < ENTROPY_MIN_LENGTH) return false;
  // Require mixed character classes so lowercase hex blobs, UUIDs, and long
  // English words never trip the detector.
  const hasLower = /[a-z]/.test(token);
  const hasUpper = /[A-Z]/.test(token);
  const hasDigit = /\d/.test(token);
  if (!(hasLower && hasUpper && hasDigit)) return false;
  return shannonEntropy(token) > ENTROPY_THRESHOLD;
}

function overlapsAny(start, end, taken) {
  return taken.some(([s, e]) => start < e && end > s);
}

/**
 * Scan free text for secrets.
 * @param {string} text
 * @returns {Array<{match: string, kind: string, confidence: number, index: number}>}
 *   Sorted by index. Overlapping hits are deduped, most specific wins.
 */
export function detectSecrets(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const hits = [];
  const taken = [];

  const claim = (match, kind, confidence, index) => {
    if (overlapsAny(index, index + match.length, taken)) return;
    taken.push([index, index + match.length]);
    hits.push({ match, kind, confidence, index });
  };

  for (const { kind, re, confidence } of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) claim(m[0], kind, confidence, m.index);
  }

  for (const m of text.matchAll(ENV_LINE_RE)) {
    const value = m[2].replace(/^["']|["']$/g, '');
    if (value.length < ENV_VALUE_MIN_LENGTH) continue;
    claim(m[0], 'env-assignment', 0.85, m.index);
  }

  for (const m of text.matchAll(CARD_CANDIDATE_RE)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (luhnValid(digits)) claim(m[0], 'card-number', 0.9, m.index);
  }

  for (const m of text.matchAll(ENTROPY_CANDIDATE_RE)) {
    if (isEntropyCandidate(m[0])) claim(m[0], 'high-entropy', 0.7, m.index);
  }

  return [...hits].sort((a, b) => a.index - b.index);
}

function boxesOverlap(a, b, pad) {
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

function unionBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * Merge overlapping (or near-touching, within `pad` px) redaction boxes into
 * their unions. Pure: never mutates the input boxes.
 * @param {Array<{x:number,y:number,w:number,h:number}>} boxes
 * @param {number} [pad=0]
 * @returns {Array<{x:number,y:number,w:number,h:number}>}
 */
export function mergeRegions(boxes, pad = 0) {
  if (!Array.isArray(boxes)) return [];
  let regions = boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  let merged = true;
  while (merged) {
    merged = false;
    const next = [];
    for (const box of regions) {
      const hitIndex = next.findIndex((existing) => boxesOverlap(existing, box, pad));
      if (hitIndex === -1) {
        next.push(box);
      } else {
        next[hitIndex] = unionBox(next[hitIndex], box);
        merged = true;
      }
    }
    regions = next;
  }
  return regions;
}
