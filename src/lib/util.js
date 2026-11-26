const crypto = require('crypto');

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function randomCode(len = 6, alphabet = ALPHA) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function randomDigits(len = 6) {
  let out = '';
  while (out.length < len) out += crypto.randomInt(0, 10).toString();
  return out;
}

function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const RESERVED = new Set([
  'unsubscribe', 'team-portal',
  'admin', 'api', 'login', 'logout', 'verify', 'dashboard', 'cards', 'card', 'pay', 'teams', 'team', 'instant',
  'privacy', 'terms', 'upgrade', 'services', 'go', 't', 'c', 'vendor', 'brand', 'css', 'js', 'static', 'public',
  'signature', 'affiliates', 'affiliate', 'account', 'help', 'pricing', 'join', 'invite', 'webhooks', 'health',
  'leads', 'hollatap', 'demo', 'for-teams', 'for-business', 'faq', 'nfc', 'support', 'about', 'contact', 'favicon.ico', 'robots.txt', 'sitemap.xml',
]);

function clean(s, max = 255) {
  if (s === undefined || s === null) return null;
  const v = String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  return v === '' ? null : v;
}

function cleanUrl(s) {
  const v = clean(s, 500);
  if (!v) return null;
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function cleanEmail(s) {
  const v = clean(s, 254);
  if (!v) return null;
  const e = v.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

function cleanPhone(s) {
  const v = clean(s, 40);
  if (!v) return null;
  return v.replace(/[^\d+()\-\s]/g, '').trim() || null;
}

function waNumber(s) {
  if (!s) return null;
  let d = String(s).replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = `234${d.slice(1)}`; // Nigerian local -> intl
  return d.length >= 8 ? d : null;
}

function naira(n) {
  return `₦${Number(n || 0).toLocaleString('en-NG')}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function isFuture(d) {
  return d && new Date(d).getTime() > Date.now();
}

module.exports = {
  randomCode, randomDigits, token, sha256, slugify, RESERVED, clean, cleanUrl, cleanEmail, cleanPhone, waNumber,
  naira, addDays, addYears, isFuture,
};
