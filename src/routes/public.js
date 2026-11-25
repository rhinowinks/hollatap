const express = require('express');
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');
const { db } = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const { effectivePlan } = require('../lib/auth');
const { buildVCard, leadVCard } = require('../lib/vcard');
const { showFooter, publicUrl, TEMPLATES } = require('../lib/cards');
const { onColour } = require('../lib/images');
const { clean, cleanEmail, cleanPhone, waNumber, isFuture } = require('../lib/util');
const { foundingAvailable } = require('../lib/billing');

const QRCode = require('qrcode');
const router = express.Router();
const leadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const enquiryLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

// The address people can actually reach right now (hollatap.com once DNS is live, onrender.com before).
function siteUrl(req) {
  const host = req.get('host') || '';
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `${req.protocol}://${host}`;
  return `https://${host}`;
}
const qrCache = new Map();
async function qrSvg(url) {
  if (!qrCache.has(url)) {
    qrCache.set(url, await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0F1B2D', light: '#FFFFFF' } }));
  }
  return qrCache.get(url);
}

router.get('/', async (req, res) => {
  const founding = await foundingAvailable();
  res.render('home', {
    title: 'HollaTap: your business card, one tap away',
    founding, marketing: true, demoQr: await qrSvg(`${siteUrl(req)}/demo`),
  });
});

router.get('/for-teams', async (req, res) => {
  res.render('for-teams', {
    title: 'HollaTap for companies: staff business cards on one dashboard',
    description: 'Digital and NFC business cards for your whole team. One dashboard, locked company design, verified badge, cards switched off when staff leave. From ₦20,000 per staff a year.',
    marketing: true,
  });
});

// Live demo: HollaTap's own card. Saving it saves HollaTap's contact.
const DEMO = {
  id: 0, slug: 'demo', template: 'classic', accent: '#0F1B2D', logo: true,
  full_name: 'HollaTap', job_title: 'Your business card, one tap away', company: 'Rhinowinks',
  bio: 'This is a live HollaTap card. Tap Save contact to see what your customers will see when they scan your QR or tap your NFC card.',
  phone: '+234 904 736 3235', whatsapp: '+234 904 736 3235', email: 'global@hollatap.com', website: 'https://hollatap.com',
};
router.get('/demo/logo', (req, res) => res.sendFile(require('path').join(__dirname, '..', '..', 'public', 'brand', 'app-icon-180.png')));
router.get('/demo/contact.vcf', async (req, res) => {
  const logoBase64 = (await sharp(require('path').join(__dirname, '..', '..', 'public', 'brand', 'app-icon-180.png')).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer()).toString('base64');
  res.setHeader('Content-Disposition', 'attachment; filename="hollatap.vcf"');
  res.type('text/vcard').send(buildVCard({ ...DEMO, full_name: 'HollaTap', company: 'HollaTap' }, { url: `${siteUrl(req)}/demo`, logoBase64 }));
});
router.get('/demo', (req, res) => {
  res.render('card-public', {
    title: 'HollaTap live demo card', card: DEMO,
    links: [{ label: 'Make my free card', url: '/login' }, { label: 'For companies', url: '/for-teams' }],
    footer: true, verified: false, teamName: null, founding: false, onAccent: '#FFFFFF',
    wa: waNumber(DEMO.whatsapp), url: `${siteUrl(req)}/demo`, leadsOpen: false, leadSent: false, isOwner: false, demo: true,
  });
});

router.get('/instant', (req, res) => {
  res.render('instant', { title: 'Make an Instant Card: nothing stored', TEMPLATES });
});

router.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy notice' }));
router.get('/terms', (req, res) => res.render('terms', { title: 'Terms of service' }));
router.get('/affiliates', (req, res) => res.render('affiliates', { title: 'Earn with HollaTap' }));

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /$\nAllow: /instant\nAllow: /upgrade\nAllow: /affiliates\nAllow: /privacy\nAllow: /terms\nDisallow: /\n');
});

router.get('/go/:id', async (req, res) => {
  const p = await db('promos').where({ id: req.params.id, active: true }).first();
  if (!p) return res.redirect('/');
  await db('promos').where({ id: p.id }).increment('clicks', 1);
  const u = new URL(p.url);
  u.searchParams.set('utm_source', 'hollatap');
  u.searchParams.set('utm_medium', 'promo');
  u.searchParams.set('utm_campaign', `promo-${p.id}`);
  res.redirect(u.toString());
});

router.post('/enquiry', enquiryLimiter, async (req, res) => {
  const product = clean(req.body.product, 60);
  const name = clean(req.body.name, 120);
  const email = cleanEmail(req.body.email);
  if (!product || !name || !email) {
    req.session.flash = { type: 'warn', text: 'Add your name and a valid email so we can reply.' };
    return res.redirect('/upgrade#services');
  }
  const row = { user_id: req.user ? req.user.id : null, product, name, email, phone: cleanPhone(req.body.phone), company: clean(req.body.company, 160), message: clean(req.body.message, 2000) };
  await db('enquiries').insert(row);
  for (const admin of config.adminEmails) {
    await mailer.send({
      to: admin,
      subject: `New enquiry: ${product}`,
      title: `New ${product} enquiry`,
      html: `<p><b>${row.name}</b> (${row.email}${row.phone ? ', ' + row.phone : ''})${row.company ? ' at ' + row.company : ''}</p><p>${(row.message || '').replace(/</g, '&lt;')}</p>`,
      text: `${row.name} ${row.email} ${row.phone || ''} ${row.company || ''}: ${row.message || ''}`,
    }).catch(() => {});
  }
  res.redirect('/upgrade?sent=1#services');
});

// NFC tag: unclaimed -> claim flow; claimed -> the card
router.get('/t/:code', async (req, res) => {
  const tag = await db('nfc_tags').where({ code: String(req.params.code).toUpperCase() }).first();
  if (!tag) return res.status(404).render('error', { title: 'Card not recognised', message: 'This NFC card is not registered.' });
  if (!tag.card_id) return res.redirect(`/claim/${tag.code}`);
  const card = await db('cards').where({ id: tag.card_id }).first();
  if (!card) return res.redirect(`/claim/${tag.code}`);
  res.redirect(`/${card.slug}?src=nfc`);
});

async function loadCard(slug) {
  if (!/^[a-z0-9-]{3,64}$/.test(slug)) return null;
  const card = await db('cards').where({ slug }).first();
  if (!card || !card.active) return null;
  return card;
}

router.get('/:slug/logo', async (req, res) => {
  const card = await loadCard(req.params.slug);
  if (!card || !card.logo) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=3600');
  res.type(card.logo_type || 'image/webp').send(card.logo);
});

router.get('/:slug/contact.vcf', async (req, res) => {
  const card = await loadCard(req.params.slug);
  if (!card) return res.sendStatus(404);
  let logoBase64 = null;
  if (card.logo) {
    try {
      logoBase64 = (await sharp(card.logo).flatten({ background: '#ffffff' }).resize(256, 256, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer()).toString('base64');
    } catch { /* ignore */ }
  }
  await db('cards').where({ id: card.id }).increment('saves', 1);
  const fname = (card.full_name || 'contact').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Disposition', `attachment; filename="${fname}.vcf"`);
  res.type('text/vcard').send(buildVCard(card, { url: publicUrl(card), logoBase64 }));
});

router.post('/:slug/lead', leadLimiter, async (req, res) => {
  const card = await loadCard(req.params.slug);
  if (!card) return res.sendStatus(404);
  if (req.body.website_url) return res.redirect(`/${card.slug}?lead=1`); // honeypot
  const name = clean(req.body.name, 120);
  const email = cleanEmail(req.body.email);
  const phone = cleanPhone(req.body.phone);
  if (!name || (!email && !phone) || req.body.consent !== 'on') {
    req.session.flash = { type: 'warn', text: 'Add your name, an email or phone, and tick the consent box.' };
    return res.redirect(`/${card.slug}#share-back`);
  }
  const owner = await db('users').where({ id: card.user_id }).first();
  const plan = await effectivePlan(owner);
  const lead = { card_id: card.id, name, email, phone, company: clean(req.body.company, 160), message: clean(req.body.message, 1000) };
  await db('leads').insert(lead);
  const vcfFile = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contact';
  await mailer.send({
    attachments: [{ filename: `${vcfFile}.vcf`, content: leadVCard(lead, card.full_name), contentType: 'text/vcard' }],
    to: owner.email,
    subject: `${name} shared their details with you`,
    title: 'New contact from your HollaTap card',
    html: `<p><b>${name.replace(/</g, '&lt;')}</b>${lead.company ? ' (' + lead.company.replace(/</g, '&lt;') + ')' : ''}</p><p>${email ? 'Email: ' + email + '<br>' : ''}${phone ? 'Phone: ' + phone : ''}</p>${lead.message ? '<p>' + lead.message.replace(/</g, '&lt;') + '</p>' : ''}<p><b>To save ${name.replace(/</g, '&lt;').split(' ')[0]} to your phone:</b> open the attached contact file (${vcfFile}.vcf) and tap Save or Add contact.</p><p><a href="${config.baseUrl}/cards/${card.id}/leads" style="color:#C2410C">See all your leads</a></p>`,
    text: `${name} ${email || ''} ${phone || ''}`,
  }).catch(() => {});
  req.session.flash = { type: 'success', text: `Thanks, ${name}. ${card.full_name.split(' ')[0]} has your details.` };
  res.redirect(`/${card.slug}?lead=1`);
});

router.get('/:slug', async (req, res, next) => {
  const card = await loadCard(req.params.slug);
  if (!card) return next();
  const owner = await db('users').where({ id: card.user_id }).first();
  const plan = await effectivePlan(owner);
  const isOwner = req.user && req.user.id === card.user_id;

  // Card modes (paid): QR/NFC hits go straight to the chosen destination.
  if (!isOwner && plan !== 'free' && card.mode !== 'profile' && req.query.view !== 'card') {
    if (card.mode === 'whatsapp' && (card.whatsapp || card.phone)) {
      const n = waNumber(card.whatsapp || card.phone);
      if (n) return res.redirect(`https://wa.me/${n}`);
    } else if (card.mode_url) {
      return res.redirect(card.mode_url);
    }
  }

  if (!isOwner) await db('cards').where({ id: card.id }).increment('views', 1);
  let team = null;
  if (card.team_id) {
    team = await db('teams').where({ id: card.team_id }).first();
  }
  // Lead capture available unless the free monthly allowance is used up
  let leadsOpen = true;
  if (plan === 'free') {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const n = Number((await db('leads').join('cards', 'leads.card_id', 'cards.id').where('cards.user_id', owner.id).where('leads.created_at', '>=', start).count({ n: 'leads.id' }).first()).n);
    leadsOpen = n < config.limits.free.leadsPerMonth;
  }
  res.render('card-public', {
    title: `${card.full_name}${card.company ? ' · ' + card.company : ''}`,
    card,
    links: JSON.parse(card.links_json || '[]'),
    footer: showFooter(card, plan),
    verified: !!(team && team.verified && isFuture(team.paid_until)),
    teamName: team ? team.name : null,
    founding: !!owner.founding_member,
    onAccent: onColour(card.accent),
    wa: waNumber(card.whatsapp || ''),
    url: publicUrl(card),
    leadsOpen,
    leadSent: req.query.lead === '1',
    isOwner,
    noindex: true,
  });
});

module.exports = router;
