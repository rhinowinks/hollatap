function esc(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  if (parts.length < 2) return { first: parts[0] || '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

// vCard 3.0 — widest phone support (iOS & Android contacts).
function buildVCard(card, { url, logoBase64 } = {}) {
  const { first, last } = splitName(card.full_name);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(last)};${esc(first)};;;`, `FN:${esc(card.full_name)}`];
  if (card.company) lines.push(`ORG:${esc(card.company)}`);
  if (card.job_title) lines.push(`TITLE:${esc(card.job_title)}`);
  if (card.phone) lines.push(`TEL;TYPE=CELL:${esc(card.phone)}`);
  if (card.whatsapp && card.whatsapp !== card.phone) lines.push(`TEL;TYPE=WORK:${esc(card.whatsapp)}`);
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(card.email)}`);
  if (card.website) lines.push(`URL:${esc(card.website)}`);
  if (url) lines.push(`URL;TYPE=HollaTap:${esc(url)}`);
  if (card.address) lines.push(`ADR;TYPE=WORK:;;${esc(card.address)};;;;`);
  if (logoBase64) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${logoBase64}`);
  lines.push('END:VCARD');
  return lines.join('\r\n') + '\r\n';
}

module.exports = { buildVCard };
