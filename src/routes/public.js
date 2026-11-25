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
const { clean, cleanEmail, cleanPhone, waNumber, isFuture, naira } = require('../lib/util');
const { foundingAvailable } = require('../lib/billing');

const QRCode = require('qrcode');
const router = express.Router();
const leadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const enquiryLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

// Mirrors the FAQ on the home page (kept here so search engines get the same answers).
const HOME_FAQ = [
  ['Do the people I meet need an app?', "No. Your card opens in their phone's browser, from a QR scan or a tap. Saving you takes one tap on iPhone and Android."],
  ['Is it really free?', 'Yes. The free plan gives you 2 cards with QR, link, WhatsApp button and 5 links, for as long as you want. You only pay for more cards, no HollaTap line, statistics or a tap card.'],
  ['How does the tap card work?', 'It has a small NFC chip inside. When someone holds it near the back of their phone, the phone opens your HollaTap page. The QR code on the back works for every other phone.'],
  ['What happens after my 14-day Pro trial?', 'Your account goes back to the free plan on its own. Nothing is charged, and your cards keep working.'],
  ['Can I change my details after sharing my card?', 'Yes. Edit your card and the same QR, link and tap card show the new details straight away.'],
  ['What is an Instant Card?', "A one-off card made on your phone with no sign-up. We store nothing. You download the QR and contact file and you're done."],
  ["Can my company manage everyone's cards?", 'Yes, with Teams. You set the design once, invite staff from a spreadsheet, and switch cards off when people leave.'],
];

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
  const B = config.baseUrl;
  const P = config.pricing;
  res.render('home', {
    title: 'HollaTap: your business card, one tap away',
    seoTitle: 'Free Digital Business Card & NFC Card in Nigeria | HollaTap',
    description: `Make a free digital business card with a QR code in 2 minutes. NFC tap business cards from ${naira(P.nfcCard)}, delivered in Lagos. Works on iPhone and Android, no app needed.`,
    canonical: '/',
    founding, marketing: true, demoQr: await qrSvg(`${siteUrl(req)}/demo`),
    jsonld: {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', '@id': `${B}/#org`, name: 'HollaTap', url: `${B}/`, logo: `${B}/brand/app-icon-192.png`, email: config.supportEmail,
          parentOrganization: { '@type': 'Organization', name: config.company }, areaServed: 'NG',
          contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: config.supportEmail, areaServed: 'NG', availableLanguage: 'en' } },
        { '@type': 'WebSite', '@id': `${B}/#site`, url: `${B}/`, name: 'HollaTap', publisher: { '@id': `${B}/#org` }, inLanguage: 'en-NG' },
        { '@type': 'SoftwareApplication', name: 'HollaTap digital business card', applicationCategory: 'BusinessApplication', operatingSystem: 'Web, iOS, Android',
          offers: [
            { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'NGN' },
            { '@type': 'Offer', name: 'Pro (yearly)', price: String(founding.open ? P.proFounding : P.proAnnual), priceCurrency: 'NGN' },
          ], publisher: { '@id': `${B}/#org` } },
        { '@type': 'Product', name: 'HollaTap NFC business card', description: 'A tap-to-share NFC business card with a QR code on the back. Opens your HollaTap digital business card on any phone, no app needed.',
          image: `${B}/brand/nfc-mockup.png`, brand: { '@type': 'Brand', name: 'HollaTap' },
          offers: { '@type': 'Offer', price: String(P.nfcCard), priceCurrency: 'NGN', availability: 'https://schema.org/InStock', areaServed: 'NG', url: `${B}/#nfc` } },
        { '@type': 'FAQPage', mainEntity: HOME_FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
      ],
    },
  });
});

router.get('/for-teams', async (req, res) => {
  res.render('for-teams', {
    sent: req.query.sent === '1',
    endBand: {
      title: 'Give your team a card worth tapping.',
      text: "Set-up takes minutes. We're on WhatsApp if you want help.",
      btns: [{ href: '/signup/company', label: 'Set up my team', cls: 'dark' },
        config.whatsappNumber ? { href: `https://wa.me/${config.whatsappNumber}`, label: 'Chat on WhatsApp', cls: 'clear', ext: true } : { href: '#enterprise', label: 'Enterprise quote', cls: 'clear' }],
    },
    title: 'HollaTap for companies: staff business cards on one dashboard',
    seoTitle: 'Digital Business Cards for Companies & Staff in Nigeria | HollaTap',
    canonical: '/for-teams',
    jsonld: {
      '@context': 'https://schema.org', '@type': 'Service', name: 'HollaTap Teams: digital and NFC business cards for staff',
      provider: { '@type': 'Organization', name: 'HollaTap', url: `${config.baseUrl}/` }, areaServed: 'NG',
      offers: [
        { '@type': 'Offer', name: 'Teams, per staff per year', price: String(config.pricing.teamSeat), priceCurrency: 'NGN' },
        { '@type': 'Offer', name: 'Teams 50+ staff, per staff per year', price: String(config.pricing.teamSeat50), priceCurrency: 'NGN' },
      ],
    },
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
    links: [{ label: 'Make my free card', url: '/signup' }, { label: 'For companies', url: '/for-teams' }],
    footer: true, verified: false, teamName: null, founding: false, onAccent: '#FFFFFF',
    wa: waNumber(DEMO.whatsapp), url: `${siteUrl(req)}/demo`, leadsOpen: false, leadSent: false, isOwner: false, demo: true,
  });
});

router.get('/instant', (req, res) => {
  res.render('instant', {
    title: 'Make an Instant Card: nothing stored', TEMPLATES,
    seoTitle: 'Free QR Code Business Card Maker, No Sign-up | HollaTap',
    description: 'Make a QR code business card on your phone in a minute. No sign-up, nothing stored. Download your QR code, contact file (vCard) and card image for free.',
    canonical: '/instant',
  });
});

router.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy notice' }));
router.get('/terms', (req, res) => res.render('terms', { title: 'Terms of service' }));
router.get('/affiliates', (req, res) => res.render('affiliates', { title: 'Earn with HollaTap' }));

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /$', 'Allow: /instant', 'Allow: /upgrade', 'Allow: /for-teams', 'Allow: /demo', 'Allow: /affiliates',
    'Allow: /signup', 'Allow: /privacy', 'Allow: /terms', 'Allow: /brand/', 'Allow: /css/', 'Allow: /js/',
    'Disallow: /',
    `Sitemap: ${config.baseUrl}/sitemap.xml`,
  ].join('\n') + '\n');
});

router.get('/sitemap.xml', (req, res) => {
  const pages = [['/', '1.0', 'weekly'], ['/for-teams', '0.9', 'weekly'], ['/upgrade', '0.8', 'weekly'], ['/instant', '0.8', 'monthly'],
    ['/demo', '0.6', 'monthly'], ['/signup', '0.6', 'monthly'], ['/affiliates', '0.4', 'monthly'], ['/privacy', '0.2', 'yearly'], ['/terms', '0.2', 'yearly']];
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map(([u, pr, f]) => `  <url><loc>${config.baseUrl}${u}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`)
    .join('\n')}\n</urlset>\n`);
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
    return res.redirect(req.body.back === 'for-teams' ? '/for-teams#enterprise' : '/upgrade#services');
  }
  const row = { user_id: req.user ? req.user.id : null, product, name, email, phone: cleanPhone(req.body.phone), company: clean(req.body.company, 160), message: clean(req.body.message, 2000) };
  await db('enquiries').insert(row);
  for (const admin of config.adminEmails) {
    await mailer.send({
      to: admin,
      subject: `New enquiry: ${product}`,
      title: `New ${product} enquiry`,
      html: (() => { const e = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); return `<p><b>${e(row.name)}</b> (${e(row.email)}${row.phone ? ', ' + e(row.phone) : ''})${row.company ? ' at ' + e(row.company) : ''}</p><p>${e(row.message)}</p>`; })(),
      text: `${row.name} ${row.email} ${row.phone || ''} ${row.company || ''}: ${row.message || ''}`,
    }).catch(() => {});
  }
  res.redirect(req.body.back === 'for-teams' ? '/for-teams?sent=1#enterprise' : '/upgrade?sent=1#services');
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
