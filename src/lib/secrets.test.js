import { describe, it, expect } from 'vitest';
import { detectSecrets, luhnValid, mergeRegions, shannonEntropy } from './secrets.js';

const kinds = (text) => detectSecrets(text).map((h) => h.kind);

describe('detectSecrets — provider key patterns', () => {
  it('detects OpenAI-style sk- keys', () => {
    const hits = detectSecrets('here is sk-abc123DEF456ghi789jklMNO in a paste');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('openai-key');
    expect(hits[0].match.startsWith('sk-')).toBe(true);
  });

  it('detects sk-proj- project keys', () => {
    expect(kinds('sk-proj-Ab12Cd34Ef56Gh78Ij90')).toContain('openai-key');
  });

  it('detects AWS access key ids (AKIA...)', () => {
    const hits = detectSecrets('aws_access_key_id = AKIAIOSFODNN7EXAMPLE');
    expect(hits.some((h) => h.kind === 'aws-access-key')).toBe(true);
  });

  it('detects GitHub personal access tokens (ghp_)', () => {
    const hits = detectSecrets('token: ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('github-token');
  });

  it('detects GitHub oauth tokens (gho_)', () => {
    expect(kinds('gho_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).toContain('github-token');
  });

  it('detects JWTs (three base64url segments)', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const hits = detectSecrets(`Authorization: Bearer ${jwt}`);
    expect(hits.some((h) => h.kind === 'jwt')).toBe(true);
  });

  it('detects Slack bot tokens', () => {
    expect(kinds('xoxb-123456789012-abcdefABCDEF')).toContain('slack-token');
  });

  it('detects Stripe live keys', () => {
    expect(kinds('sk_live_abcdefghij1234567890')).toContain('stripe-key');
  });

  it('detects Google API keys', () => {
    expect(kinds('AIzaSyA1234567890abcdefghijklmnopqrstuv')).toContain('google-api-key');
  });

  it('detects PEM private key headers', () => {
    expect(kinds('-----BEGIN RSA PRIVATE KEY-----')).toContain('private-key');
  });
});

describe('detectSecrets — .env assignment lines', () => {
  it('flags KEY=value lines with sensitive names', () => {
    const hits = detectSecrets('API_KEY=supersecretvalue123');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('env-assignment');
  });

  it('flags exported assignments', () => {
    expect(kinds('export DATABASE_PASSWORD=hunter2hunter2')).toContain('env-assignment');
  });

  it('flags quoted values containing spaces', () => {
    expect(kinds('SECRET_TOKEN="correct horse battery"')).toContain('env-assignment');
  });

  it('finds multiple assignments across a multi-line .env file', () => {
    const env = ['DEBUG=true', 'AUTH_TOKEN=abcdef123456', 'STRIPE_SECRET=whsec_9x8y7z6w5v'].join(
      '\n',
    );
    const hits = detectSecrets(env);
    expect(hits.filter((h) => h.kind === 'env-assignment')).toHaveLength(2);
  });

  it('prefers the specific key kind when the env value is a known key', () => {
    const hits = detectSecrets('OPENAI_API_KEY=sk-abc123DEF456ghi789jklMNO');
    expect(hits.some((h) => h.kind === 'openai-key')).toBe(true);
  });

  it('ignores non-sensitive variable names', () => {
    expect(detectSecrets('NODE_ENV=production')).toHaveLength(0);
  });

  it('ignores sensitive names with short values', () => {
    expect(detectSecrets('API_KEY=short')).toHaveLength(0);
  });
});

describe('detectSecrets — card numbers in text', () => {
  it('flags Luhn-valid card numbers with spaces', () => {
    const hits = detectSecrets('card: 4111 1111 1111 1111 exp 12/28');
    expect(hits.some((h) => h.kind === 'card-number')).toBe(true);
  });

  it('flags Luhn-valid card numbers with dashes', () => {
    expect(kinds('4242-4242-4242-4242')).toContain('card-number');
  });

  it('ignores 16-digit sequences that fail the Luhn check', () => {
    expect(detectSecrets('order id 1234 5678 9012 3456')).toHaveLength(0);
  });

  it('ignores phone numbers (too few digits)', () => {
    expect(detectSecrets('call 555-867-5309 today')).toHaveLength(0);
  });
});

describe('detectSecrets — entropy heuristic', () => {
  it('flags long mixed-case high-entropy tokens', () => {
    const hits = detectSecrets('nonce aB3xK9mQ2rT7wZ5pL8vN1cD4 end');
    expect(hits.some((h) => h.kind === 'high-entropy')).toBe(true);
  });

  it('reports lower confidence for entropy hits than pattern hits', () => {
    const [entropy] = detectSecrets('aB3xK9mQ2rT7wZ5pL8vN1cD4');
    const [pattern] = detectSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(entropy.confidence).toBeLessThan(pattern.confidence);
  });

  it('ignores repetitive low-entropy strings', () => {
    expect(detectSecrets('AAAAAAAAAAAAAAAAAAAAAAAAAA')).toHaveLength(0);
  });

  it('ignores long English words', () => {
    expect(detectSecrets('antidisestablishmentarianism internationalization')).toHaveLength(0);
  });

  it('ignores short hex strings', () => {
    expect(detectSecrets('color #deadbeef hash cafe1234')).toHaveLength(0);
  });

  it('ignores long lowercase hex digests (git SHAs)', () => {
    expect(detectSecrets('commit 3f786850e387550fdab836ed7e6dc881de23001b')).toHaveLength(0);
  });

  it('ignores UUIDs', () => {
    expect(detectSecrets('id 550e8400-e29b-41d4-a716-446655440000')).toHaveLength(0);
  });
});

describe('detectSecrets — general behavior', () => {
  it('returns empty for normal prose', () => {
    expect(
      detectSecrets('The quick brown fox jumps over the lazy dog near the riverbank.'),
    ).toHaveLength(0);
  });

  it('returns empty for empty and non-string input', () => {
    expect(detectSecrets('')).toHaveLength(0);
    expect(detectSecrets(null)).toHaveLength(0);
    expect(detectSecrets(undefined)).toHaveLength(0);
  });

  it('returns hits sorted by index with correct offsets', () => {
    const text = 'a AKIAIOSFODNN7EXAMPLE then ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const hits = detectSecrets(text);
    expect(hits).toHaveLength(2);
    expect(hits[0].index).toBeLessThan(hits[1].index);
    expect(text.slice(hits[0].index, hits[0].index + hits[0].match.length)).toBe(hits[0].match);
  });

  it('never reports the same span twice', () => {
    const hits = detectSecrets('sk-abc123DEF456ghi789jklMNO');
    expect(hits).toHaveLength(1);
  });
});

describe('luhnValid', () => {
  it('accepts known-valid Visa test number', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
  });

  it('accepts known-valid Stripe test number', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
  });

  it('accepts 15-digit Amex test number', () => {
    expect(luhnValid('378282246310005')).toBe(true);
  });

  it('accepts Mastercard test number', () => {
    expect(luhnValid('5555555555554444')).toBe(true);
  });

  it('rejects a near-miss checksum', () => {
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('rejects sequences shorter than 13 digits', () => {
    expect(luhnValid('411111111111')).toBe(false);
  });

  it('rejects sequences longer than 19 digits', () => {
    expect(luhnValid('41111111111111111111')).toBe(false);
  });

  it('rejects non-digit input', () => {
    expect(luhnValid('4111-1111-1111-1111')).toBe(false);
    expect(luhnValid('')).toBe(false);
    expect(luhnValid(4111111111111111)).toBe(false);
  });
});

describe('shannonEntropy', () => {
  it('is 0 for empty and single-symbol strings', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaa')).toBe(0);
  });

  it('is 1 bit for a fair two-symbol string', () => {
    expect(shannonEntropy('abab')).toBeCloseTo(1);
  });

  it('is 4 bits for 16 uniform symbols', () => {
    expect(shannonEntropy('0123456789abcdef')).toBeCloseTo(4);
  });
});

describe('mergeRegions', () => {
  it('returns empty for empty or invalid input', () => {
    expect(mergeRegions([])).toEqual([]);
    expect(mergeRegions(null)).toEqual([]);
  });

  it('passes through a single box unchanged without mutating it', () => {
    const input = [{ x: 1, y: 2, w: 3, h: 4 }];
    const out = mergeRegions(input);
    expect(out).toEqual([{ x: 1, y: 2, w: 3, h: 4 }]);
    expect(out[0]).not.toBe(input[0]);
  });

  it('keeps disjoint boxes separate', () => {
    const out = mergeRegions([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 100, y: 100, w: 10, h: 10 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('merges two overlapping boxes into their union', () => {
    const out = mergeRegions([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 5, y: 5, w: 10, h: 10 },
    ]);
    expect(out).toEqual([{ x: 0, y: 0, w: 15, h: 15 }]);
  });

  it('merges transitive chains (A~B, B~C) into one region', () => {
    const out = mergeRegions([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 8, y: 0, w: 10, h: 10 },
      { x: 16, y: 0, w: 10, h: 10 },
    ]);
    expect(out).toEqual([{ x: 0, y: 0, w: 26, h: 10 }]);
  });

  it('respects the pad parameter for near-touching boxes', () => {
    const boxes = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 14, y: 0, w: 10, h: 10 },
    ];
    expect(mergeRegions(boxes, 0)).toHaveLength(2);
    expect(mergeRegions(boxes, 5)).toHaveLength(1);
  });
});
