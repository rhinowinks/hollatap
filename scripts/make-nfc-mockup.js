// Builds the NFC card mock-up artwork from the brand pack.
// Output: public/brand/nfc-front.svg, nfc-back.svg, nfc-mockup.png (+ .webp)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');

const brand = path.join(__dirname, '..', 'public', 'brand');
const inner = (file) => {
  const s = fs.readFileSync(path.join(brand, file), 'utf8');
  const vb = s.match(/viewBox="([^"]+)"/)[1];
  const body = s.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/, '');
  return { vb, body };
};
const navyLogo = inner('hollatap-logo-horizontal-mono-navy.svg');
const whiteLogo = inner('hollatap-logo-horizontal-mono-white.svg');
const whiteMark = inner('hollatap-mark-mono-white.svg');

const W = 856, H = 540, R = 34;
const ripple = (x, y, c, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round">
  <circle r="9" fill="${c}" stroke="none"/>
  <path d="M22 -30 a40 40 0 0 1 0 60"/><path d="M48 -56 a76 76 0 0 1 0 112"/><path d="M74 -82 a112 112 0 0 1 0 164"/></g>`;

const front = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><clipPath id="c"><rect width="${W}" height="${H}" rx="${R}"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="${W}" height="${H}" fill="#FF5A1F"/>
    <circle cx="${W - 40}" cy="${H + 60}" r="360" fill="#FF7A47"/>
    <circle cx="${W - 40}" cy="${H + 60}" r="230" fill="#FF5A1F"/>
    <svg x="64" y="60" width="420" height="${420 / 3.513}" viewBox="${navyLogo.vb}">${navyLogo.body}</svg>
    <text x="68" y="${H - 70}" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="40" font-weight="800" fill="#0F1B2D">Tap to save my contact</text>
    ${ripple(W - 150, 170, '#0F1B2D', 1.05)}
  </g></svg>`;

async function back() {
  const qr = await QRCode.toString('https://hollatap.com/t/HT7Q2K', { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0F1B2D', light: '#FFFFFF' } });
  const qvb = qr.match(/viewBox="([^"]+)"/)[1];
  const qbody = qr.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs><clipPath id="c"><rect width="${W}" height="${H}" rx="${R}"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="${W}" height="${H}" fill="#0F1B2D"/>
    <text x="64" y="128" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="52" font-weight="800" fill="#FFFFFF">Your Name</text>
    <text x="64" y="180" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="30" font-weight="500" fill="#C9D1DC">Your title · Your company</text>
    <text x="64" y="${H - 64}" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="26" font-weight="600" fill="#C9D1DC">hollatap.com/your-name</text>
    <svg x="64" y="${H - 190}" width="230" height="${230 / 3.513}" viewBox="${whiteLogo.vb}">${whiteLogo.body}</svg>
    <rect x="${W - 300}" y="${H - 300}" width="236" height="236" rx="18" fill="#FFFFFF"/>
    <svg x="${W - 282}" y="${H - 282}" width="200" height="200" viewBox="${qvb}">${qbody}</svg>
    ${ripple(W - 120, 120, '#FF5A1F', 0.7)}
  </g></svg>`;
}

(async () => {
  const backSvg = await back();
  fs.writeFileSync(path.join(brand, 'nfc-front.svg'), front);
  fs.writeFileSync(path.join(brand, 'nfc-back.svg'), backSvg);
  // Composite mock-up: back card behind, front card on top, both tilted, soft shadow.
  const S = 1640, SH = 1180;
  const card = async (svg, angle) => sharp(Buffer.from(svg), { density: 144 }).resize(W).png().toBuffer()
    .then((b) => sharp(b).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  const shadow = async (angle) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W + 120}" height="${H + 120}"><rect x="60" y="80" width="${W}" height="${H}" rx="${R}" fill="#0F1B2D" fill-opacity=".28"/></svg>`))
    .blur(28).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const b = await card(backSvg, -14), f = await card(front, 8);
  const sb = await shadow(-14), sf = await shadow(8);
  const out = await sharp({ create: { width: S, height: SH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: sb, left: 70, top: 40 }, { input: b, left: 120, top: 60 },
      { input: sf, left: 600, top: 470 }, { input: f, left: 640, top: 480 },
    ]).png().toBuffer();
  await sharp(out).resize(1200).png().toFile(path.join(brand, 'nfc-mockup.png'));
  await sharp(out).resize(1200).webp({ quality: 88 }).toFile(path.join(brand, 'nfc-mockup.webp'));
  console.log('done');
})();
