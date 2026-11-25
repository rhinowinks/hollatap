const crypto = require('crypto');

const N = 16384, R = 8, P = 1, LEN = 64;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, LEN, { N, r: R, p: P });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, h] = stored.split('$');
  const expected = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), expected.length, { N, r: R, p: P });
  return crypto.timingSafeEqual(expected, got);
}

// Plain-language rules, checked the same way on sign-up and reset.
function passwordProblem(pw, confirm) {
  if (!pw || pw.length < 8) return 'Use at least 8 characters for your password.';
  if (pw.length > 200) return 'That password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number in your password.';
  if (confirm !== undefined && pw !== confirm) return "The two passwords don't match. Type them again.";
  return null;
}

function cleanUsername(u) {
  const s = String(u || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(s) ? s : null;
}

module.exports = { hashPassword, checkPassword, passwordProblem, cleanUsername };
