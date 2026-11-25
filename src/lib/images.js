const sharp = require('sharp');

// Re-encode any uploaded logo to a safe, small WebP. Never store or serve the original bytes.
async function processLogo(buffer) {
  const img = sharp(buffer, { failOn: 'error', limitInputPixels: 40e6 }).rotate();
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('Not an image');
  const out = await img
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  const accent = await dominantColour(out);
  return { data: out, type: 'image/webp', accent };
}

async function dominantColour(buffer) {
  try {
    const { dominant } = await sharp(buffer).flatten({ background: '#ffffff' }).stats();
    const { r, g, b } = dominant;
    // Ignore near-white / near-grey results
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 235 && min > 225) return null;
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    return hex;
  } catch {
    return null;
  }
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Text colour that reads on the given background.
function onColour(bg) {
  try {
    return contrast(bg, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#0F1B2D';
  } catch {
    return '#FFFFFF';
  }
}

function safeHex(s, fallback = '#0F1B2D') {
  return /^#[0-9a-fA-F]{6}$/.test(String(s || '')) ? String(s).toUpperCase() : fallback;
}

module.exports = { processLogo, onColour, safeHex, contrast };
