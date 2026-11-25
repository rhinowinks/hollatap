const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const { requireUser } = require('../lib/auth');
const { processLogo, safeHex } = require('../lib/images');
const { TEMPLATES, uniqueSlug } = require('../lib/cards');
const { clean, cleanEmail, cleanPhone, cleanUrl, token, isFuture } = require('../lib/util');
const { teamSeatPrice } = require('../lib/billing');

const csrf = require('../lib/csrf');
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^(image\/(png|jpe?g|webp|gif|svg\+xml)|text\/csv|application\/vnd\.ms-excel|text\/plain)$/.test(file.mimetype)),
});

async function myTeam(req) {
  if (!req.user.team_id) return null;
  return db('teams').where({ id: req.user.team_id }).first();
}

function isTeamAdmin(req, team) {
  return team && (team.owner_id === req.user.id || req.user.team_role === 'admin');
}

router.get('/teams', (req, res, next) => {
  if (!req.user) { req.session.next = '/teams'; return res.redirect('/login/company'); }
  next();
}, async (req, res) => {
  const team = await myTeam(req);
  if (!team && !req.user.password_hash) return res.redirect('/signup/company');
  if (!team) return res.render('team-new', { title: 'HollaTap Teams', error: null, pricing: config.pricing });
  const admin = isTeamAdmin(req, team);
  const members = await db('users').where({ team_id: team.id }).orderBy('id');
  const cards = await db('cards').where({ team_id: team.id });
  const invites = admin ? await db('invites').where({ team_id: team.id }).whereNull('accepted_at').orderBy('id', 'desc') : [];
  const orders = admin ? await db('nfc_orders').where({ team_id: team.id }).orderBy('id', 'desc') : [];
  res.render('team', {
    title: team.name,
    team,
    admin,
    members,
    cards,
    invites,
    orders,
    paid: isFuture(team.paid_until),
    TEMPLATES,
    seatPrice: teamSeatPrice(team.seats || config.pricing.teamMinSeats),
    used: members.length + invites.length,
  });
});

router.post('/teams', requireUser, async (req, res) => {
  if (req.user.team_id) return res.redirect('/teams');
  if (!req.user.password_hash) return res.redirect('/signup/company');
  const name = clean(req.body.name, 160);
  if (!name) return res.status(400).render('team-new', { title: 'HollaTap Teams', error: 'Enter your company name.', pricing: config.pricing });
  const domain = req.user.email.split('@')[1];
  const freeMail = /^(gmail|yahoo|hotmail|outlook|icloud|live|aol|proton|protonmail|ymail)\./i.test(domain);
  const [row] = await db('teams')
    .insert({ name, owner_id: req.user.id, email_domain: freeMail ? null : domain, seats: 0, accent: '#0F1B2D', template: 'classic' })
    .returning('id');
  const id = typeof row === 'object' ? row.id : row;
  await db('users').where({ id: req.user.id }).update({ team_id: id, team_role: 'admin' });
  req.session.flash = { type: 'success', text: 'Team created. Set your company design, then add your staff.' };
  res.redirect('/teams');
});

router.post('/teams/settings', requireUser, upload.single('logo'), csrf.after, async (req, res) => {
  const team = await myTeam(req);
  if (!isTeamAdmin(req, team)) return res.redirect('/teams');
  const upd = {
    name: clean(req.body.name, 160) || team.name,
    template: TEMPLATES.find((t) => t.id === req.body.template) ? req.body.template : team.template,
    accent: safeHex(req.body.accent, team.accent),
    website: cleanUrl(req.body.website),
    address: clean(req.body.address, 255),
    phone: cleanPhone(req.body.phone),
    updated_at: new Date(),
  };
  if (req.file && req.file.mimetype.startsWith('image/')) {
    try {
      const logo = await processLogo(req.file.buffer);
      upd.logo = logo.data;
      upd.logo_type = logo.type;
      if (req.body.accent_auto === '1' && logo.accent) upd.accent = logo.accent;
    } catch {
      req.session.flash = { type: 'warn', text: "We couldn't read that logo. Try a PNG or JPG." };
      return res.redirect('/teams');
    }
  }
  await db('teams').where({ id: team.id }).update(upd);
  // Push the locked design to every staff card
  const cardUpd = { template: upd.template, accent: upd.accent, company: upd.name, updated_at: new Date() };
  if (upd.logo) Object.assign(cardUpd, { logo: upd.logo, logo_type: upd.logo_type });
  if (upd.website) cardUpd.website = upd.website;
  if (upd.address) cardUpd.address = upd.address;
  await db('cards').where({ team_id: team.id }).update(cardUpd);
  req.session.flash = { type: 'success', text: 'Company design saved and applied to all staff cards.' };
  res.redirect('/teams');
});

function parseRows(text) {
  // Accepts "email" or "email, full name, job title, phone" per line (CSV or pasted list)
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const email = cleanEmail(cells[0]);
    if (!email) continue;
    out.push({ email, full_name: clean(cells[1], 120), job_title: clean(cells[2], 120), phone: cleanPhone(cells[3]) });
  }
  return out;
}

router.post('/teams/invite', requireUser, upload.single('csv'), csrf.after, async (req, res) => {
  const team = await myTeam(req);
  if (!isTeamAdmin(req, team)) return res.redirect('/teams');
  const text = req.file && !req.file.mimetype.startsWith('image/') ? req.file.buffer.toString('utf8') : req.body.emails;
  const rows = parseRows(text).slice(0, 1000);
  if (!rows.length) {
    req.session.flash = { type: 'warn', text: 'Add at least one email address, one per line.' };
    return res.redirect('/teams');
  }
  const members = Number((await db('users').where({ team_id: team.id }).count({ n: '*' }).first()).n);
  const pending = Number((await db('invites').where({ team_id: team.id }).whereNull('accepted_at').count({ n: '*' }).first()).n);
  const seats = isFuture(team.paid_until) ? team.seats : Infinity; // before paying, invite freely; pay for the number you need
  if (members + pending + rows.length > seats) {
    req.session.flash = { type: 'warn', text: `Your plan has ${seats} seats. Add seats before inviting more staff.` };
    return res.redirect('/teams');
  }
  let sent = 0;
  for (const r of rows) {
    const existing = await db('invites').where({ team_id: team.id, email: r.email }).whereNull('accepted_at').first();
    if (existing) continue;
    const tk = token(24);
    await db('invites').insert({ team_id: team.id, email: r.email, full_name: r.full_name, job_title: r.job_title, phone: r.phone, token: tk });
    await mailer.send({
      to: r.email,
      subject: `${team.name} has set up your digital business card`,
      title: 'Your company card is ready to claim',
      html: `<p>${team.name} uses HollaTap for staff business cards. Claim yours in under a minute:</p><p><a href="${config.baseUrl}/join/${tk}" style="display:inline-block;background:#FF5A1F;color:#0F1B2D;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Claim my card</a></p>`,
      text: `Claim your ${team.name} card: ${config.baseUrl}/join/${tk}`,
    }).catch(() => {});
    sent++;
  }
  req.session.flash = { type: 'success', text: `${sent} invitation${sent === 1 ? '' : 's'} sent.` };
  res.redirect('/teams');
});

router.get('/join/:token', async (req, res) => {
  const inv = await db('invites').where({ token: req.params.token }).first();
  if (!inv || inv.accepted_at) return res.status(404).render('error', { title: 'Invitation not found', message: 'This invitation has been used or withdrawn. Ask your company admin for a new one.' });
  const team = await db('teams').where({ id: inv.team_id }).first();
  if (!req.user) {
    req.session.next = req.originalUrl;
    return res.redirect(`/login?email=${encodeURIComponent(inv.email)}`);
  }
  if (req.user.email !== inv.email) {
    return res.status(403).render('error', { title: 'Different email', message: `This invitation is for ${inv.email}. Sign out and sign in with that email.` });
  }
  if (req.user.team_id && req.user.team_id !== team.id) {
    return res.status(409).render('error', { title: 'Already in a team', message: 'You are already part of another company team.' });
  }
  const slug = await uniqueSlug(inv.full_name || req.user.email.split('@')[0]);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: req.user.id }).update({ team_id: team.id, team_role: 'member', name: req.user.name || inv.full_name });
    await trx('invites').where({ id: inv.id }).update({ accepted_at: new Date() });
    const has = await trx('cards').where({ user_id: req.user.id, team_id: team.id }).first();
    if (!has) {
      await trx('cards').insert({
        user_id: req.user.id,
        team_id: team.id,
        slug,
        full_name: inv.full_name || req.user.name || req.user.email.split('@')[0],
        job_title: inv.job_title,
        phone: inv.phone,
        email: inv.email,
        company: team.name,
        website: team.website,
        address: team.address,
        template: team.template,
        accent: team.accent,
        logo: team.logo,
        logo_type: team.logo_type,
        links_json: '[]',
      });
    }
  });
  req.session.flash = { type: 'success', text: `Welcome to ${team.name}. Check your details and save.` };
  res.redirect('/dashboard');
});

router.post('/teams/members/:uid/remove', requireUser, async (req, res) => {
  const team = await myTeam(req);
  if (!isTeamAdmin(req, team)) return res.redirect('/teams');
  const member = await db('users').where({ id: req.params.uid, team_id: team.id }).first();
  if (!member || member.id === team.owner_id) return res.redirect('/teams');
  await db.transaction(async (trx) => {
    // The company keeps control: staff cards are switched off and detached.
    const cards = await trx('cards').where({ user_id: member.id, team_id: team.id });
    for (const c of cards) {
      await trx('nfc_tags').where({ card_id: c.id }).update({ card_id: null, claimed_at: null });
    }
    await trx('cards').where({ user_id: member.id, team_id: team.id }).update({ active: false, team_id: null });
    await trx('users').where({ id: member.id }).update({ team_id: null, team_role: null });
  });
  await db('audit').insert({ event: 'team_member_removed', user_id: req.user.id, detail: `member ${member.id}` });
  req.session.flash = { type: 'success', text: `${member.email} removed. Their company card is switched off.` };
  res.redirect('/teams');
});

router.post('/teams/invites/:id/cancel', requireUser, async (req, res) => {
  const team = await myTeam(req);
  if (!isTeamAdmin(req, team)) return res.redirect('/teams');
  await db('invites').where({ id: req.params.id, team_id: team.id }).whereNull('accepted_at').del();
  res.redirect('/teams');
});

router.post('/teams/orders/:id/shipping', requireUser, async (req, res) => {
  const team = await myTeam(req);
  if (!isTeamAdmin(req, team)) return res.redirect('/teams');
  await db('nfc_orders').where({ id: req.params.id, team_id: team.id, status: 'new' }).update({
    ship_name: clean(req.body.ship_name, 120),
    ship_phone: cleanPhone(req.body.ship_phone),
    ship_address: clean(req.body.ship_address, 500),
    updated_at: new Date(),
  });
  req.session.flash = { type: 'success', text: 'Delivery details saved.' };
  res.redirect('/teams');
});

module.exports = router;
