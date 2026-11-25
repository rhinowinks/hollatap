import { renderCard, readForm, onColour } from './cardview.js';
import { fillFromPdf } from './autofill.js';

const form = document.getElementById('instant-form');
const preview = document.getElementById('preview');
const qrBox = document.getElementById('qr');
const qrNote = document.getElementById('qr-note');
let logoUrl = null;
let logoImg = null;
let lastVcard = '';

form.addEventListener('submit', (e) => e.preventDefault());

function vEsc(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function buildVCard(d) {
  const parts = (d.full_name || '').trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop() : '';
  const first = parts.join(' ');
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(last)};${vEsc(first)};;;`, `FN:${vEsc(d.full_name)}`];
  if (d.company) L.push(`ORG:${vEsc(d.company)}`);
  if (d.job_title) L.push(`TITLE:${vEsc(d.job_title)}`);
  if (d.phone) L.push(`TEL;TYPE=CELL:${vEsc(d.phone)}`);
  if (d.whatsapp && d.whatsapp !== d.phone) L.push(`TEL;TYPE=WORK:${vEsc(d.whatsapp)}`);
  if (d.email) L.push(`EMAIL:${vEsc(d.email)}`);
  if (d.website) L.push(`URL:${vEsc(/^https?:/.test(d.website) ? d.website : 'https://' + d.website)}`);
  if (d.address) L.push(`ADR;TYPE=WORK:;;${vEsc(d.address)};;;;`);
  L.push('END:VCARD');
  return L.join('\r\n');
}

function makeQr(text) {
  // eslint-disable-next-line no-undef
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  // eslint-disable-next-line no-undef
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  return qr;
}

function drawQr(qr, size, dark = '#0F1B2D') {
  const n = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.floor(size / (n + quiet * 2));
  const px = cell * (n + quiet * 2);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c;
}

function update() {
  const d = readForm(form);
  d.logoUrl = logoUrl;
  d.footer = false;
  d.instant = true;
  preview.innerHTML = renderCard(d);
  if (!d.full_name) {
    qrBox.innerHTML = '<p class="small muted">Add your name to create your QR code.</p>';
    qrNote.textContent = '';
    lastVcard = '';
    return;
  }
  lastVcard = buildVCard(d);
  try {
    const qr = makeQr(lastVcard);
    const canvas = drawQr(qr, 480);
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `QR code for ${d.full_name}`);
    qrBox.replaceChildren(canvas);
    qrNote.textContent = 'Scan it with any phone camera to test.';
  } catch {
    qrBox.innerHTML = '<p class="small muted">Too much text for one QR code. Shorten your address.</p>';
  }
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const fileBase = () => (readForm(form).full_name || 'my-card').toLowerCase().replace(/[^a-z0-9]+/g, '-');

document.getElementById('dl-qr').addEventListener('click', () => {
  if (!lastVcard) return update();
  drawQr(makeQr(lastVcard), 1200).toBlob((b) => download(`${fileBase()}-qr.png`, b));
});
document.getElementById('dl-vcf').addEventListener('click', () => {
  if (!lastVcard) return update();
  download(`${fileBase()}.vcf`, new Blob([lastVcard + '\r\n'], { type: 'text/vcard' }));
});
document.getElementById('dl-card').addEventListener('click', async () => {
  if (!lastVcard) return update();
  const d = readForm(form);
  const W = 1050, H = 600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const accent = /^#[0-9a-f]{6}$/i.test(d.accent) ? d.accent : '#0F1B2D';
  const on = onColour(accent);
  await document.fonts.ready;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, W, 210);
  if (logoImg) {
    ctx.fillStyle = '#fff'; ctx.fillRect(50, 45, 120, 120);
    const s = Math.min(100 / logoImg.width, 100 / logoImg.height);
    ctx.drawImage(logoImg, 110 - (logoImg.width * s) / 2, 105 - (logoImg.height * s) / 2, logoImg.width * s, logoImg.height * s);
  }
  const tx = logoImg ? 200 : 50;
  ctx.fillStyle = on;
  ctx.font = '800 46px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText(d.full_name, tx, 110, W - tx - 40);
  ctx.font = '500 26px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText([d.job_title, d.company].filter(Boolean).join(' · '), tx, 155, W - tx - 40);
  ctx.fillStyle = '#0F1B2D';
  ctx.font = '500 26px "Plus Jakarta Sans", Arial, sans-serif';
  let y = 275;
  for (const line of [d.phone, d.email, d.website, d.address].filter(Boolean)) {
    ctx.fillText(line, 50, y, 600);
    y += 52;
  }
  const qrc = drawQr(makeQr(lastVcard), 330);
  ctx.drawImage(qrc, W - 50 - 300, 240, 300, 300);
  ctx.fillStyle = '#5B6573';
  ctx.font = '500 18px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText('Scan to save my contact', W - 50 - 300 + 50, 570);
  c.toBlob((b) => download(`${fileBase()}-card.png`, b));
});

document.getElementById('f_logo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (logoUrl) URL.revokeObjectURL(logoUrl);
  logoUrl = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => { logoImg = img; update(); };
  img.src = logoUrl;
});
document.getElementById('pdf').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) fillFromPdf(f, form, document.getElementById('pdf-status'));
});
form.addEventListener('input', update);
form.addEventListener('change', update);
update();
