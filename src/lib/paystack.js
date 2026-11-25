const crypto = require('crypto');
const config = require('../config');

const API = 'https://api.paystack.co';

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${config.paystack.secret}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    const err = new Error(json.message || `Paystack error ${res.status}`);
    err.response = json;
    throw err;
  }
  return json.data;
}

// amount in naira; Paystack expects kobo
function initialize({ email, amountNaira, reference, callbackUrl, metadata }) {
  return call('/transaction/initialize', {
    method: 'POST',
    body: { email, amount: Math.round(amountNaira * 100), reference, callback_url: callbackUrl, currency: 'NGN', metadata },
  });
}

function verify(reference) {
  return call(`/transaction/verify/${encodeURIComponent(reference)}`);
}

function validSignature(rawBody, signature) {
  if (!signature || !config.paystack.secret) return false;
  const hash = crypto.createHmac('sha512', config.paystack.secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

module.exports = { initialize, verify, validSignature };
