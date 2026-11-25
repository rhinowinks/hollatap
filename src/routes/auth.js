const express = require('express');
const { db } = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const { randomDigits, randomCode, sha256, cleanEmail, addDays } = require('../lib/util');
const { INDUSTRIES } = require('../lib/promos');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Sign in or create your account', email: req.query.email || '', error: null, industries: INDUSTRIES });
});

router.post('/login', async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!email) return res.status(400).render('login', { title: 'Sign in', email: req.body.email || '', error: 'Enter a valid email address.', industries: INDUSTRIES });
  const recent = await db('login_codes').where({ email }).where('created_at', '>', new Date(Date.now() - 60 * 1000)).first();
  if (!recent) {
    const code = randomDigits(6);
    await db('login_codes').insert({ email, code_hash: sha256(`${email}:${code}`), expires_at: new Date(Date.now() + 15 * 60 * 1000) });
    await mailer.send({
      to: email,
      subject: `${code} is your HollaTap code`,
      title: 'Your sign-in code',
      html: `<p>Enter this code to continue:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p><p>It expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
      text: `Your HollaTap code is ${code}. It expires in 15 minutes.`,
    });
  }
  req.session.pendingEmail = email;
  req.session.pendingIndustry = req.body.industry || null;
  req.session.pendingOptIn = req.body.marketing_opt_in === 'on';
  res.redirect('/verify');
});

router.get('/verify', (req, res) => {
  if (!req.session.pendingEmail) return res.redirect('/login');
  res.render('verify', { title: 'Check your email', email: req.session.pendingEmail, error: null, devHint: !config.mailEnabled && !config.isProd });
});

router.post('/verify', async (req, res) => {
  const email = req.session.pendingEmail;
  if (!email) return res.redirect('/login');
  const code = String(req.body.code || '').replace(/\D/g, '');
  const row = await db('login_codes').where({ email }).where('expires_at', '>', new Date()).orderBy('id', 'desc').first();
  const fail = (msg) => res.status(400).render('verify', { title: 'Check your email', email, error: msg, devHint: !config.mailEnabled && !config.isProd });
  if (!row) return fail('That code has expired. Go back and request a new one.');
  if (row.attempts >= 5) return fail('Too many attempts. Request a new code.');
  if (row.code_hash !== sha256(`${email}:${code}`)) {
    await db('login_codes').where({ id: row.id }).increment('attempts', 1);
    return fail("That code isn't right. Check the email and try again.");
  }
  await db('login_codes').where({ email }).del();

  let user = await db('users').where({ email }).first();
  let isNew = false;
  if (!user) {
    isNew = true;
    let referredBy = null;
    if (req.session.ref) {
      const ref = await db('users').where({ ref_code: req.session.ref }).first();
      if (ref) referredBy = ref.id;
    }
    let refCode;
    do refCode = randomCode(6); while (await db('users').where({ ref_code: refCode }).first());
    const [created] = await db('users')
      .insert({
        email,
        industry: req.session.pendingIndustry || null,
        marketing_opt_in: !!req.session.pendingOptIn,
        ref_code: refCode,
        referred_by: referredBy,
        trial_ends_at: addDays(new Date(), config.pricing.trialDays),
        is_admin: config.adminEmails.includes(email),
        last_seen_at: new Date(),
      })
      .returning('id');
    const id = typeof created === 'object' ? created.id : created;
    user = await db('users').where({ id }).first();
    await db('audit').insert({ event: 'signup', user_id: user.id, detail: referredBy ? `ref ${referredBy}` : '' });
  }
  const next = req.session.next;
  req.session.uid = user.id;
  delete req.session.pendingEmail;
  delete req.session.pendingIndustry;
  delete req.session.pendingOptIn;
  delete req.session.next;
  delete req.session.ref;
  if (isNew) req.session.flash = { type: 'success', text: `Welcome to HollaTap. You have ${config.pricing.trialDays} days of Pro free; no card needed.` };
  res.redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : isNew ? '/cards/new' : '/dashboard');
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

module.exports = router;
