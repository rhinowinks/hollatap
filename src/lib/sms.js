// SMS through Termii. Without TERMII_API_KEY the message is recorded as "simulated" and nothing is sent.
const config = require('../config');

// Nigerian numbers to international format: 0803… → 234803…
function intl(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1);
  if (d.length === 10 && /^[789]/.test(d)) d = '234' + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

async function post(path, body) {
  const r = await fetch(`${config.termii.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: config.termii.apiKey, from: config.termii.senderId, type: 'plain', ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || (data.code && data.code !== 'ok')) throw new Error(data.message || `Termii error ${r.status}`);
  return data;
}

// channel: 'dnd' for one-to-one service messages (reaches DND numbers), 'generic' for promotional bulk.
async function sendOne(phone, text, channel = 'dnd') {
  const to = intl(phone);
  if (!to) return { status: 'failed', error: 'Not a valid phone number' };
  if (!config.smsEnabled) return { status: 'simulated', to };
  try {
    const d = await post('/api/sms/send', { to, sms: text, channel });
    return { status: 'sent', to, ref: String(d.message_id_str || d.message_id || '') };
  } catch (e) {
    return { status: 'failed', to, error: String(e.message).slice(0, 300) };
  }
}

// Termii accepts up to 100 numbers per bulk call.
async function sendBulk(phones, text, channel = 'generic') {
  const list = [...new Set(phones.map(intl).filter(Boolean))];
  const results = [];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    if (!config.smsEnabled) { chunk.forEach((to) => results.push({ to, status: 'simulated' })); continue; }
    try {
      const d = await post('/api/sms/send/bulk', { to: chunk, sms: text, channel });
      chunk.forEach((to) => results.push({ to, status: 'sent', ref: String(d.message_id_str || d.message_id || '') }));
    } catch (e) {
      chunk.forEach((to) => results.push({ to, status: 'failed', error: String(e.message).slice(0, 300) }));
    }
  }
  return results;
}

module.exports = { intl, sendOne, sendBulk };
