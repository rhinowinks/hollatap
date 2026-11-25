const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { db } = require('../db');
const config = require('../config');
const { requireUser, effectivePlan, limitsFor } = require('../lib/auth');
const { processLogo } = require('../lib/images');
const { TEMPLATES, MODES, uniqueSlug, cardFieldsFrom, publicUrl } = require('../lib/cards');
const { pickPromo, INDUSTRIES } = require('../lib/promos');
const { clean, slugify, RESERVED, isFuture } = require('../lib/util');
const { foundingAvailable } = require('../lib/billing');
const { deleteUserEverything } = require('../jobs');

const csrf = require('../lib/csrf');
const { leadVCard } = require('../lib/vcard');
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype)),
});

async function ownCard(req, res) {
  const card = await db('cards').where({ id: req.params.id, user_id: req.user.id }).first();
  if (!card) {
    res.status(404).render('error', { title: 'Not found', message: 'That card does not exist.' });
    return null;
  }
  return card;
}

async function monthLeadCount(userId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const row = await db('leads')
    .join('cards', 'leads.card_id', 'cards.id')
    .where('cards.user_id', userId)
    .where('leads.created_at', '>=', start)
    .count({ n: 'leads.id' })
    .first();
  return Number(row.n || 0);
}

router.get('/dashboard', requireUser, async (req, res) => {
  const plan = await effectivePlan(req.user);
  const cards = await db('cards').where({ user_id: req.user.id }).orderBy('id');
  const team = req.user.team_id ? await db('teams').where({ id: req.user.team_id }).first() : null;
  let companyTeam = null;
  if (!team) {
    const domain = req.user.email.split('@')[1];
    companyTeam = await db('teams').where({ email_domain: domain }).first();
  }
  const promo = await pickPromo(req.query.created ? 'created' : 'dashboard', req.user.industry);
  const leadCount = await monthLeadCount(req.user.id);
  const founding = await foundingAvailable();
  res.render('dashboard', {
    title: 'Your cards',
    plan,
    limits: limitsFor(plan),
    cards,
    team,
    companyTeam,
    promo,
    leadCount,
    founding,
    justCreated: req.query.created ? Number(req.query.created) : null,
    refLink: `${config.baseUrl}/?ref=${req.user.ref_code}`,
    trialDaysLeft: isFuture(req.user.trial_ends_at) ? Math.ceil((new Date(req.user.trial_ends_at) - Date.now()) / 864e5) : 0,
  });
});

router.get('/cards/new', requireUser, async (req, res) => {
  const plan = await effectivePlan(req.user);
  const limits = limitsFor(plan);
  const count = (await db('cards').where({ user_id: req.user.id }).count({ n: '*' }).first()).n;
  if (Number(count) >= limits.cards && !req.user.team_id) {
    req.session.flash = { type: 'warn', text: `Your plan allows ${limits.cards} card${limits.cards > 1 ? 's' : ''}. Upgrade to Pro for up to 5.` };
    return res.redirect('/upgrade');
  }
  res.render('card-edit', { title: 'Create your card', card: { template: 'classic', accent: '#0F1B2D', mode: 'profile', links_json: '[]' }, isNew: true, plan, limits, TEMPLATES, MODES, error: null });
});

router.post('/cards', requireUser, upload.single('logo'), csrf.after, async (req, res) => {
  const plan = await effectivePlan(req.user);
  const limits = limitsFor(plan);
  const count = Number((await db('cards').where({ user_id: req.user.id }).count({ n: '*' }).first()).n);
  if (count >= limits.cards && !req.user.team_id) return res.redirect('/upgrade');
  const fields = cardFieldsFrom(req.body, limits);
  if (!fields.full_name) {
    return res.status(400).render('card-edit', { title: 'Create your card', card: { ...fields }, isNew: true, plan, limits, TEMPLATES, MODES, error: 'Enter your name.' });
  }
  if (plan === 'free' && fields.mode !== 'profile') fields.mode = 'profile';
  if (req.file) {
    try {
      const logo = await processLogo(req.file.buffer);
      fields.logo = logo.data;
      fields.logo_type = logo.type;
      if (req.body.accent_auto === '1' && logo.accent) fields.accent = logo.accent;
    } catch {
      return res.status(400).render('card-edit', { title: 'Create your card', card: { ...fields }, isNew: true, plan, limits, TEMPLATES, MODES, error: "We couldn't read that logo. Try a PNG or JPG." });
    }
  }
  if (req.user.team_id) {
    const team = await db('teams').where({ id: req.user.team_id }).first();
    if (team) {
      Object.assign(fields, { team_id: team.id, template: team.template, accent: team.accent, company: team.name });
      if (team.logo && !fields.logo) Object.assign(fields, { logo: team.logo, logo_type: team.logo_type });
    }
  }
  fields.slug = await uniqueSlug(req.body.slug || fields.full_name);
  fields.user_id = req.user.id;
  const [row] = await db('cards').insert(fields).returning('id');
  const id = typeof row === 'object' ? row.id : row;
  if (!req.user.name) await db('users').where({ id: req.user.id }).update({ name: fields.full_name });
  res.redirect(`/dashboard?created=${id}`);
});

router.get('/cards/:id/edit', requireUser, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  const plan = await effectivePlan(req.user);
  res.render('card-edit', { title: 'Edit card', card, isNew: false, plan, limits: limitsFor(plan), TEMPLATES, MODES, error: null });
});

router.post('/cards/:id', requireUser, upload.single('logo'), csrf.after, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  const plan = await effectivePlan(req.user);
  const limits = limitsFor(plan);
  const fields = cardFieldsFrom(req.body, limits);
  if (!fields.full_name) {
    return res.status(400).render('card-edit', { title: 'Edit card', card: { ...card, ...fields }, isNew: false, plan, limits, TEMPLATES, MODES, error: 'Enter your name.' });
  }
  if (plan === 'free' && fields.mode !== 'profile') fields.mode = 'profile';
  // Team cards keep the company's locked design.
  if (card.team_id) {
    const team = await db('teams').where({ id: card.team_id }).first();
    if (team) {
      fields.template = team.template;
      fields.accent = team.accent;
      fields.company = team.name;
    }
  }
  if (req.body.remove_logo === '1') {
    fields.logo = null;
    fields.logo_type = null;
  }
  if (req.file) {
    try {
      const logo = await processLogo(req.file.buffer);
      fields.logo = logo.data;
      fields.logo_type = logo.type;
      if (req.body.accent_auto === '1' && logo.accent && !card.team_id) fields.accent = logo.accent;
    } catch {
      return res.status(400).render('card-edit', { title: 'Edit card', card: { ...card, ...fields }, isNew: false, plan, limits, TEMPLATES, MODES, error: "We couldn't read that logo. Try a PNG or JPG." });
    }
  }
  const wanted = slugify(req.body.slug || '');
  if (wanted && wanted !== card.slug) {
    if (RESERVED.has(wanted) || wanted.length < 3) {
      return res.status(400).render('card-edit', { title: 'Edit card', card: { ...card, ...fields }, isNew: false, plan, limits, TEMPLATES, MODES, error: 'That web address is not available. Try another.' });
    }
    const clash = await db('cards').where({ slug: wanted }).whereNot({ id: card.id }).first();
    if (clash) {
      return res.status(400).render('card-edit', { title: 'Edit card', card: { ...card, ...fields }, isNew: false, plan, limits, TEMPLATES, MODES, error: 'That web address is taken. Try another.' });
    }
    fields.slug = wanted;
  }
  fields.updated_at = new Date();
  await db('cards').where({ id: card.id }).update(fields);
  req.session.flash = { type: 'success', text: 'Card saved.' };
  res.redirect('/dashboard');
});

router.post('/cards/:id/delete', requireUser, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  await db.transaction(async (trx) => {
    await trx('leads').where({ card_id: card.id }).del();
    await trx('nfc_tags').where({ card_id: card.id }).update({ card_id: null, claimed_at: null });
    await trx('cards').where({ id: card.id }).del();
  });
  await db('audit').insert({ event: 'card_deleted', user_id: req.user.id, detail: '' });
  req.session.flash = { type: 'success', text: 'Card and its data deleted permanently.' };
  res.redirect('/dashboard');
});

router.get('/cards/:id/share', requireUser, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  const plan = await effectivePlan(req.user);
  const url = publicUrl(card);
  const qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, color: { dark: '#0F1B2D', light: '#FFFFFF' } });
  res.render('card-share', { title: 'Share your card', card, url, qrSvg, plan });
});

router.get(['/cards/:id/qr.png', '/cards/:id/qr.svg'], requireUser, async (req, res) => {
  req.params.fmt = req.path.endsWith('.svg') ? 'svg' : 'png';
  const card = await ownCard(req, res);
  if (!card) return;
  const url = publicUrl(card);
  const opts = { errorCorrectionLevel: 'H', margin: 4, color: { dark: '#0F1B2D', light: '#FFFFFF' } };
  res.setHeader('Content-Disposition', `attachment; filename="hollatap-${card.slug}-qr.${req.params.fmt}"`);
  if (req.params.fmt === 'svg') {
    res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
  } else {
    res.type('image/png').send(await QRCode.toBuffer(url, { ...opts, width: 1200 }));
  }
});

router.get('/cards/:id/leads', requireUser, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  const plan = await effectivePlan(req.user);
  const leads = await db('leads').where({ card_id: card.id }).orderBy('id', 'desc').limit(500);
  res.render('leads', { title: `Leads for ${card.full_name}`, card, leads, plan });
});

router.get('/cards/:id/leads.csv', requireUser, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  const plan = await effectivePlan(req.user);
  if (plan === 'free') return res.redirect('/upgrade');
  const leads = await db('leads').where({ card_id: card.id }).orderBy('id', 'desc');
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [['Date', 'Name', 'Email', 'Phone', 'Company', 'Message']].concat(
    leads.map((l) => [new Date(l.created_at).toISOString().slice(0, 10), l.name, l.email, l.phone, l.company, l.message])
  );
  res.setHeader('Content-Disposition', `attachment; filename="hollatap-leads-${card.slug}.csv"`);
  res.type('text/csv').send(rows.map((r) => r.map(esc).join(',')).join('\r\n'));
});

function vcfName(s) {
  return String(s || 'contact').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contact';
}

router.get('/cards/:id/leads.vcf', requireUser, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  const leads = await db('leads').where({ card_id: card.id }).orderBy('id', 'desc');
  res.setHeader('Content-Disposition', `attachment; filename="hollatap-contacts-${card.slug}.vcf"`);
  res.type('text/vcard').send(leads.map((l) => leadVCard(l, card.full_name)).join(''));
});

router.get('/cards/:id/leads/:lid.vcf', requireUser, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  const lead = await db('leads').where({ id: req.params.lid, card_id: card.id }).first();
  if (!lead) return res.sendStatus(404);
  res.setHeader('Content-Disposition', `attachment; filename="${vcfName(lead.name)}.vcf"`);
  res.type('text/vcard').send(leadVCard(lead, card.full_name));
});

router.post('/cards/:id/leads/:lid/delete', requireUser, async (req, res) => {
  const card = await ownCard(req, res);
  if (!card) return;
  await db('leads').where({ id: req.params.lid, card_id: card.id }).del();
  res.redirect(`/cards/${card.id}/leads`);
});

router.get('/signature', requireUser, async (req, res) => {
  const plan = await effectivePlan(req.user);
  const cards = await db('cards').where({ user_id: req.user.id }).orderBy('id');
  const card = cards.find((c) => String(c.id) === String(req.query.card)) || cards[0] || null;
  res.render('signature', { title: 'Email signature', cards, card, plan, url: card ? publicUrl(card) : null });
});

router.get('/account', requireUser, async (req, res) => {
  const plan = await effectivePlan(req.user);
  const payments = await db('payments').where({ user_id: req.user.id, status: 'success' }).orderBy('id', 'desc').limit(50);
  res.render('account', { title: 'Your account', plan, payments, industries: INDUSTRIES });
});

router.post('/account', requireUser, async (req, res) => {
  await db('users').where({ id: req.user.id }).update({
    name: clean(req.body.name, 120),
    industry: INDUSTRIES.includes(req.body.industry) ? req.body.industry : null,
    marketing_opt_in: req.body.marketing_opt_in === 'on',
    updated_at: new Date(),
  });
  req.session.flash = { type: 'success', text: 'Account updated.' };
  res.redirect('/account');
});

router.post('/account/delete', requireUser, async (req, res) => {
  if (String(req.body.confirm || '').trim().toUpperCase() !== 'DELETE') {
    req.session.flash = { type: 'warn', text: 'Type DELETE to confirm.' };
    return res.redirect('/account');
  }
  const email = req.user.email;
  const uid = req.user.id;
  await db.transaction((trx) => deleteUserEverything(trx, uid));
  await db('audit').insert({ event: 'account_deleted', user_id: uid, detail: '' });
  req.session = null;
  require('../lib/mailer').send({
    to: email,
    subject: 'Your HollaTap data has been deleted',
    title: 'Data deleted',
    html: '<p>Your HollaTap account, cards, logos and leads have been permanently deleted. Payment records we must keep by law no longer link to your details.</p>',
    text: 'Your HollaTap account and data have been permanently deleted.',
  }).catch(() => {});
  res.render('deleted', { title: 'Your data has been deleted' });
});

// Affiliate programme
router.get('/affiliate', requireUser, async (req, res) => {
  const commissions = await db('commissions').where({ affiliate_id: req.user.id }).orderBy('id', 'desc').limit(200);
  const referred = Number((await db('users').where({ referred_by: req.user.id }).count({ n: '*' }).first()).n);
  const sum = (s) => commissions.filter((c) => c.status === s).reduce((a, c) => a + c.amount_naira, 0);
  res.render('affiliate', {
    title: 'Affiliate programme',
    commissions,
    referred,
    totals: { pending: sum('pending'), payable: sum('payable'), paid: sum('paid') },
    refLink: `${config.baseUrl}/?ref=${req.user.ref_code}`,
  });
});

router.post('/affiliate/join', requireUser, async (req, res) => {
  const bank = clean(req.body.bank, 255);
  if (!bank) {
    req.session.flash = { type: 'warn', text: 'Add your bank name, account name and account number so we can pay you.' };
    return res.redirect('/affiliate');
  }
  await db('users').where({ id: req.user.id }).update({ is_affiliate: true, affiliate_bank: bank, updated_at: new Date() });
  req.session.flash = { type: 'success', text: "You're now a HollaTap affiliate. Share your link to start earning." };
  res.redirect('/affiliate');
});

// NFC tag claim (after /t/:code redirects here)
router.get('/claim/:code', requireUser, async (req, res) => {
  const tag = await db('nfc_tags').where({ code: String(req.params.code).toUpperCase() }).first();
  if (!tag) return res.status(404).render('error', { title: 'Card not recognised', message: 'This NFC card is not registered. Email ' + config.supportEmail + '.' });
  if (tag.card_id) return res.redirect(`/t/${tag.code}`);
  const cards = await db('cards').where({ user_id: req.user.id }).orderBy('id');
  res.render('claim', { title: 'Link your NFC card', tag, cards });
});

router.post('/claim/:code', requireUser, async (req, res) => {
  const tag = await db('nfc_tags').where({ code: String(req.params.code).toUpperCase() }).first();
  if (!tag || tag.card_id) return res.redirect('/dashboard');
  const card = await db('cards').where({ id: req.body.card_id, user_id: req.user.id }).first();
  if (!card) return res.redirect(`/claim/${tag.code}`);
  if (tag.team_id && card.team_id !== tag.team_id) {
    req.session.flash = { type: 'warn', text: 'This card belongs to a company team. Join the team first, then tap again.' };
    return res.redirect('/dashboard');
  }
  await db('nfc_tags').where({ id: tag.id }).update({ card_id: card.id, claimed_at: new Date() });
  req.session.flash = { type: 'success', text: 'NFC card linked. Tap it on any phone to share your card.' };
  res.redirect('/dashboard');
});

module.exports = router;
