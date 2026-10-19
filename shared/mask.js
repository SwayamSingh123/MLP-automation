/**
 * Masks personal data before it is written anywhere (results JSON, report,
 * published site). Applied in Node, so unmasked values never touch disk.
 */

const EMAIL_RE = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
// 10-digit Indian mobile numbers, optionally prefixed with +91 / 91.
const PHONE_RE = /(?<!\d)(?:\+?91[- ]?)?(\d{6})(\d{4})(?!\d)/g;

function maskEmail(value) {
  return String(value == null ? '' : value).replace(
    EMAIL_RE,
    (_, local, domain) => `${local[0]}****${local.length > 2 ? local[local.length - 1] : ''}@${domain}`
  );
}

function maskPhone(value) {
  return String(value == null ? '' : value).replace(PHONE_RE, '******$2');
}

function maskName(value) {
  return String(value == null ? '' : value)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] + '*'.repeat(Math.max(1, w.length - 1)))
    .join(' ');
}

/** Masks emails and phone numbers anywhere inside a string. */
function maskText(value) {
  // Request URLs carry the address URL-encoded (%40).
  return maskPhone(maskEmail(String(value == null ? '' : value).replace(/%40/gi, '@')));
}

/** Masks emails and phone numbers in every string of a plain JSON value. */
function maskDeep(value) {
  if (typeof value === 'string') return maskText(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskDeep(v);
    return out;
  }
  return value;
}

module.exports = { maskEmail, maskPhone, maskName, maskText, maskDeep };
