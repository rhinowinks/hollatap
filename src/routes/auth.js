const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const { randomDigits, randomCode, sha256, cleanEmail, addDays } = require('../lib/util');
const { hashPassword, checkPassword, passwordProblem, cleanUsername } = require('../lib/passwords');
const { INDUSTRIES } = require('../lib/promos');

const router = express.Router();

// ---------- helpers ----------

const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null);

async function sendCode(email, purpose) {
  const recent = await db('login_codes').where({ email }).where('created_at', '>', new Date(Date.now() - 60 * 1000)).first();
  if (recent) return false; // one code a minute
  const code = randomDigits(6);
  await db('login_codes').insert({ email, code_hash: sha256(`${email}:${code}`), expires_at: new Date(Date.now() + 15 * 60 * 1000) });
  const what = { signup: 'finish creating your account', company: 'finish setting up your company login', reset: 'reset your password' }[purpose] || 'log in';
  await mailer.send({
    to: email,
    subject: `${code} is your HollaTap code`,
    title: 'Your HollaTap code',
    html: `<p>Enter this code to ${what}:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p><p>It expires in 15 minutes. If you didn't ask for it, ignore this email. Nobody can get into your account without it.</p>`,
    text: `Your HollaTap code is ${code}. Enter it to ${what}. It expires in 15 minutes.`,
  });
  return true;
}

async function createUser(email, { industry, optIn, ref, username, passwordHash, googleSub } = {}) {
  let referredBy = null;
  if (ref) {
    const r = await db('users').where({ ref_code: ref }).first();
    if (r) referredBy = r.id;
  }
  let refCode;
  do refCode = randomCode(6); while (await db('users').where({ ref_code: refCode }).first());
  const [created] = await db('users')
    .insert({
      email,
      industry: industry || null,
      marketing_opt_in: !!optIn,
      ref_code: refCode,
      referred_by: referredBy,
      trial_ends_at: addDays(new Date(), config.pricing.trialDays),
      is_admin: config.adminEmails.includes(email),
      last_seen_at: new Date(),
      username: username || null,
      password_hash: passwordHash || null,
      password_set_at: passwordHash ? new Date() : null,
      google_sub: googleSub || null,
    })
    .returning('id');
  const id = typeof created === 'object' ? created.id : created;
  await db('audit').insert({ event: 'signup', user_id: id, detail: referredBy ? `ref ${referredBy}` : '' });
  return db('users').where({ id }).first();
}

function startSession(req, user, keep90) {
  const next = safeNext(req.session.next);
  const ref = req.session.ref;
  // fresh session on log-in
  for (const k of Object.keys(req.session)) delete req.session[k];
  req.session.uid = user.id;
  if (keep90) req.session.keep90 = true;
  req.sessionOptions.maxAge = (keep90 ? 90 : 30) * 24 * 3600 * 1000;
  void ref;
  return next;
}

function render(res, view, title, extra = {}) {
  res.render(view, { title, error: null, notice: null, email: '', industries: INDUSTRIES, google: config.googleEnabled, ...extra });
}

// ---------- pages ----------

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  render(res, 'login', 'Log in', { email: req.query.email || '' });
});

router.get('/signup', (req, res) => {
  if (req.query.for === 'company' || req.query.for === 'team') return res.redirect('/signup/company');
  if (req.user) return res.redirect('/dashboard');
  render(res, 'signup', 'Create your free account', { email: req.query.email || '', seoTitle: 'Create a Free Digital Business Card | HollaTap', description: 'Sign up free and make your digital business card with QR code in 2 minutes. 14 days of Pro free, no bank card needed.', canonical: '/signup' });
});

router.get('/signup/company', (req, res) => {
  if (req.user && req.user.password_hash) return res.redirect('/teams');
  render(res, 'signup-company', "Set up your company's cards", { email: req.user ? req.user.email : '', username: '', loggedIn: !!req.user });
});

router.get('/login/company', (req, res) => {
  if (req.user) return res.redirect('/teams');
  render(res, 'login-company', 'Company admin log in', { username: '' });
});

router.get('/forgot-password', (req, res) => render(res, 'forgot', 'Reset your password'));

// ---------- personal: log in and sign up with an email code ----------

router.post('/login', async (req, res) => {
  const email = cleanEmail(req.body.email);
  const keep90 = req.body.keep === 'on';
  if (!email) return res.status(400).render('login', { title: 'Log in', email: req.body.email || '', error: 'Type your email address, for example name@gmail.com.', notice: null, google: config.googleEnabled });
  const user = await db('users').where({ email }).first();
  if (!user) {
    return res.status(404).render('login', { title: 'Log in', email, error: null, google: config.googleEnabled, notice: 'unknown' });
  }
  if (user.password_hash) {
    return res.status(400).render('login', { title: 'Log in', email, error: null, google: config.googleEnabled, notice: 'company' });
  }
  await sendCode(email, 'login');
  req.session.pending = { email, mode: 'login', keep90 };
  res.redirect('/verify');
});

router.post('/signup', async (req, res) => {
  const email = cleanEmail(req.body.email);
  const keep90 = req.body.keep === 'on';
  if (!email) return res.status(400).render('signup', { title: 'Create your free account', email: req.body.email || '', error: 'Type your email address, for example name@gmail.com.', notice: null, industries: INDUSTRIES, google: config.googleEnabled });
  const user = await db('users').where({ email }).first();
  if (user && user.password_hash) {
    return res.status(400).render('login', { title: 'Log in', email, error: null, google: config.googleEnabled, notice: 'company' });
  }
  await sendCode(email, user ? 'login' : 'signup');
  req.session.pending = { email, mode: user ? 'login' : 'signup', keep90, industry: req.body.industry || null, optIn: req.body.marketing_opt_in === 'on', existed: !!user };
  res.redirect('/verify');
});

// ---------- company admins: username + password, then an email code ----------

router.post('/signup/company', async (req, res) => {
  const loggedIn = !!req.user;
  const email = loggedIn ? req.user.email : cleanEmail(req.body.email);
  const username = cleanUsername(req.body.username);
  const keep90 = req.body.keep === 'on';
  const again = (error) => res.status(400).render('signup-company', { title: "Set up your company's cards", email: email || req.body.email || '', username: req.body.username || '', loggedIn, error, notice: null, google: config.googleEnabled });
  if (!email) return again('Type your work email address, for example name@yourcompany.com.');
  if (!username) return again('Choose a username of 3 to 30 letters or numbers. You can also use dots, dashes and underscores.');
  const pwErr = passwordProblem(req.body.password, req.body.password2);
  if (pwErr) return again(pwErr);
  const taken = await db('users').where({ username }).first();
  if (taken && taken.email !== email) return again('That username is taken. Try another, for example your company name.');
  const existing = await db('users').where({ email }).first();
  if (existing && existing.password_hash && !loggedIn) return again('This email already has a company login. Use "Log in" instead.');
  await sendCode(email, 'company');
  req.session.pending = { email, mode: 'company-signup', keep90, username, pw: hashPassword(req.body.password), optIn: req.body.marketing_opt_in === 'on' };
  res.redirect('/verify');
});

router.post('/login/company', async (req, res) => {
  const id = String(req.body.username || '').trim().toLowerCase();
  const keep90 = req.body.keep === 'on';
  const user = id ? await db('users').where(id.includes('@') ? { email: id } : { username: id }).first() : null;
  const ok = user && user.password_hash && checkPassword(req.body.password || '', user.password_hash);
  if (!ok) {
    return res.status(400).render('login-company', { title: 'Company admin log in', username: req.body.username || '', error: "That username or password isn't right. Check them and try again, or reset your password.", notice: null, google: config.googleEnabled });
  }
  await sendCode(user.email, 'login');
  req.session.pending = { email: user.email, mode: 'company-login', keep90, uid: user.id };
  res.redirect('/verify');
});

router.post('/forgot-password', async (req, res) => {
  const id = String(req.body.email || '').trim().toLowerCase();
  const user = id ? await db('users').where(id.includes('@') ? { email: id } : { username: id }).first() : null;
  // Same answer either way, so nobody can test which emails have accounts.
  if (user && user.password_hash) {
    await sendCode(user.email, 'reset');
    req.session.pending = { email: user.email, mode: 'reset', uid: user.id };
    return res.redirect('/verify');
  }
  res.render('forgot', { title: 'Reset your password', error: null, notice: 'sent', google: config.googleEnabled });
});

router.get('/reset-password', (req, res) => {
  if (!req.session.resetUid) return res.redirect('/forgot-password');
  res.render('reset', { title: 'Choose a new password', error: null });
});

router.post('/reset-password', async (req, res) => {
  const uid = req.session.resetUid;
  if (!uid) return res.redirect('/forgot-password');
  const pwErr = passwordProblem(req.body.password, req.body.password2);
  if (pwErr) return res.status(400).render('reset', { title: 'Choose a new password', error: pwErr });
  await db('users').where({ id: uid }).update({ password_hash: hashPassword(req.body.password), password_set_at: new Date() });
  await db('audit').insert({ event: 'password_reset', user_id: uid, detail: '' });
  const user = await db('users').where({ id: uid }).first();
  startSession(req, user, false);
  req.session.flash = { type: 'success', text: 'Your new password is saved. You are logged in.' };
  res.redirect(user.team_id ? '/teams' : '/dashboard');
});

// ---------- the code page ----------

router.get('/verify', (req, res) => {
  const p = req.session.pending;
  if (!p) return res.redirect('/login');
  res.render('verify', { title: 'Check your email', email: p.email, mode: p.mode, existed: !!p.existed, error: null, devHint: !config.mailEnabled && !config.isProd });
});

router.post('/verify/resend', async (req, res) => {
  const p = req.session.pending;
  if (!p) return res.redirect('/login');
  const sent = await sendCode(p.email, p.mode === 'reset' ? 'reset' : p.mode === 'company-signup' ? 'company' : p.mode === 'signup' ? 'signup' : 'login');
  req.session.flash = sent ? { type: 'success', text: `We sent a new code to ${p.email}.` } : { type: 'warn', text: 'Wait one minute, then ask for a new code.' };
  res.redirect('/verify');
});

router.post('/verify', async (req, res) => {
  const p = req.session.pending;
  if (!p) return res.redirect('/login');
  const { email } = p;
  const code = String(req.body.code || '').replace(/\D/g, '');
  const row = await db('login_codes').where({ email }).where('expires_at', '>', new Date()).orderBy('id', 'desc').first();
  const fail = (msg) => res.status(400).render('verify', { title: 'Check your email', email, mode: p.mode, existed: !!p.existed, error: msg, devHint: !config.mailEnabled && !config.isProd });
  if (!row) return fail('That code has expired. Tap "Send a new code" below.');
  if (row.attempts >= 5) return fail('Too many wrong tries. Tap "Send a new code" below.');
  if (row.code_hash !== sha256(`${email}:${code}`)) {
    await db('login_codes').where({ id: row.id }).increment('attempts', 1);
    return fail("That code isn't right. Check the email and type the 6 numbers again.");
  }
  await db('login_codes').where({ email }).del();

  if (p.mode === 'reset') {
    delete req.session.pending;
    req.session.resetUid = p.uid;
    return res.redirect('/reset-password');
  }

  let user = await db('users').where({ email }).first();
  let isNew = false;
  if (p.mode === 'company-signup') {
    if (user) {
      await db('users').where({ id: user.id }).update({ username: p.username, password_hash: p.pw, password_set_at: new Date() });
      user = await db('users').where({ id: user.id }).first();
    } else {
      isNew = true;
      user = await createUser(email, { optIn: p.optIn, ref: req.session.ref, username: p.username, passwordHash: p.pw });
    }
    await db('audit').insert({ event: 'company_login_set', user_id: user.id, detail: p.username });
    startSession(req, user, p.keep90);
    req.session.flash = { type: 'success', text: `Your company login is ready. Next, add your company details. Log in next time with your username "${user.username}" and password.` };
    return res.redirect('/teams');
  }

  if (p.mode === 'company-login') {
    if (!user || user.id !== p.uid) return fail('Something went wrong. Start again from Log in.');
  } else if (!user) {
    isNew = true;
    user = await createUser(email, { industry: p.industry, optIn: p.optIn, ref: req.session.ref });
  }
  const next = startSession(req, user, p.keep90);
  if (isNew) req.session.flash = { type: 'success', text: `Welcome to HollaTap. You have ${config.pricing.trialDays} days of Pro free; no card needed.` };
  if (p.mode === 'company-login') return res.redirect(next || '/teams');
  res.redirect(next || (isNew ? '/cards/new' : '/dashboard'));
});

// ---------- Google ----------

router.get('/auth/google', (req, res) => {
  if (!config.googleEnabled) return res.redirect('/login');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.gstate = state;
  req.session.gkeep = req.query.keep === '1';
  const q = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: `${config.baseUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});

router.get('/auth/google/callback', async (req, res) => {
  const back = (text) => { req.session.flash = { type: 'error', text }; res.redirect('/login'); };
  if (!config.googleEnabled) return res.redirect('/login');
  if (!req.query.code || !req.query.state || req.query.state !== req.session.gstate) return back("Google log-in didn't finish. Try again, or use your email instead.");
  delete req.session.gstate;
  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code), client_id: config.google.clientId, client_secret: config.google.clientSecret,
        redirect_uri: `${config.baseUrl}/auth/google/callback`, grant_type: 'authorization_code',
      }),
    });
    const tok = await r.json();
    if (!tok.id_token) throw new Error('no id_token');
    // Received straight from Google over TLS, so the token's contents can be read without re-verifying the signature.
    info = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
    if (info.aud !== config.google.clientId) throw new Error('aud');
  } catch (e) {
    return back("Google log-in didn't work. Try again, or use your email instead.");
  }
  const email = cleanEmail(info.email);
  if (!email || !info.email_verified) return back("Your Google account doesn't have a confirmed email. Use your email instead.");
  let user = await db('users').where({ email }).first();
  if (user && user.password_hash) {
    req.session.flash = { type: 'warn', text: 'This is a company admin account. Log in with your username and password.' };
    return res.redirect('/login/company');
  }
  let isNew = false;
  if (!user) {
    isNew = true;
    user = await createUser(email, { ref: req.session.ref, googleSub: info.sub });
    if (info.name) await db('users').where({ id: user.id }).update({ name: String(info.name).slice(0, 120) });
  } else if (!user.google_sub) {
    await db('users').where({ id: user.id }).update({ google_sub: info.sub });
  }
  const next = startSession(req, user, req.session.gkeep);
  if (isNew) req.session.flash = { type: 'success', text: `Welcome to HollaTap. You have ${config.pricing.trialDays} days of Pro free; no card needed.` };
  res.redirect(next || (isNew ? '/cards/new' : '/dashboard'));
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

module.exports = router;
