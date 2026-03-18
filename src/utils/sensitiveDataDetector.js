/**
 * Detects sensitive data patterns in packet payload bytes.
 *
 * Scans ASCII-printable content for credentials, PII, API keys, and other
 * secrets that users may not want displayed or sent to external APIs.
 */

// Each pattern: { name, regex, severity }
// severity: 'high' = credentials/secrets, 'medium' = PII
const PATTERNS = [
  // Credentials & secrets
  { name: 'Authorization header', re: /Authorization:\s*\S+/i, severity: 'high' },
  { name: 'Bearer token', re: /Bearer\s+[A-Za-z0-9\-_\.]{20,}/i, severity: 'high' },
  { name: 'Basic auth', re: /Basic\s+[A-Za-z0-9+\/=]{8,}/i, severity: 'high' },
  { name: 'API key parameter', re: /[?&](?:api[_-]?key|apikey|token|access_token|secret)=[^\s&]{8,}/i, severity: 'high' },
  { name: 'API key header/value', re: /(?:api[_-]?key|x-api-key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9\-_]{16,}/i, severity: 'high' },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/, severity: 'high' },
  { name: 'AWS secret key', re: /(?:aws_secret|secret_key)\s*[:=]\s*['"]?[A-Za-z0-9\/+=]{30,}/i, severity: 'high' },
  { name: 'Private key marker', re: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY/, severity: 'high' },
  { name: 'Password field', re: /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{4,}/i, severity: 'high' },
  { name: 'Cookie header', re: /Cookie:\s*\S+/i, severity: 'high' },
  { name: 'Set-Cookie header', re: /Set-Cookie:\s*\S+/i, severity: 'high' },

  // PII
  { name: 'Email address', re: /[a-zA-Z0-9._%+\-]{2,}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, severity: 'medium' },
  { name: 'SSN pattern', re: /\b\d{3}-\d{2}-\d{4}\b/, severity: 'high' },
  { name: 'Credit card (Visa/MC)', re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\b/, severity: 'high' },
];

/**
 * Scan a Uint8Array payload for sensitive patterns.
 * @param {Uint8Array} bytes - Raw payload bytes
 * @returns {{ detected: boolean, matches: Array<{name: string, severity: string}> }}
 */
export function detectSensitiveData(bytes) {
  // Convert to printable ASCII for pattern matching
  const ascii = Array.from(bytes)
    .map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ' ')
    .join('');

  const matches = [];
  for (const pat of PATTERNS) {
    if (pat.re.test(ascii)) {
      matches.push({ name: pat.name, severity: pat.severity });
    }
  }

  return { detected: matches.length > 0, matches };
}

/**
 * Scan a string for sensitive patterns (for tshark JSON payloads).
 * @param {string} text
 * @returns {{ detected: boolean, matches: Array<{name: string, severity: string}> }}
 */
export function detectSensitiveString(text) {
  const matches = [];
  for (const pat of PATTERNS) {
    if (pat.re.test(text)) {
      matches.push({ name: pat.name, severity: pat.severity });
    }
  }
  return { detected: matches.length > 0, matches };
}

/**
 * List of field keys that contain raw payload content and should be
 * stripped before sending to external APIs.
 */
export const PAYLOAD_FIELD_KEYS = new Set([
  'hex_dump', 'ascii', 'payload_hex', 'payload_ascii',
  'data', 'raw_data', 'payload_data',
]);
