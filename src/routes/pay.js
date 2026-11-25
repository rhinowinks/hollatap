const express = require('express');
const { db } = require('../db');
const config = require('../config');
const { requireUser, effectivePlan } = require('../lib/auth');
const { quote, fulfil, foundingAvailable } = require('../lib/billing');
const paystack = require('../lib/paystack');
const { randomCode, clean, cleanPhone } = require('../lib/util');

const router = express.Router();
const KINDS = ['pro', 'footer', 'team', 'nfc', 'nfc_replacement'];

async function quoteFor(req) {
  const kind = req.params.kind;
  if (!KINDS.includes(kind)) return null;
  const body = req.body || {};
  const opts = { quantity: body.qty || req.query.qty, cardId: body.card || req.query.card };
  if (kind === 'footer') {
    const card = await db('cards').where({ id: opts.cardId, user_id: req.user.id }).first();
    if (!card) return null;
    opts.card = card;
  }
  if (kind === 'team') {
    const team = req.user.team_id ? await db('teams').where({ id: req.user.team_id, owner_id: req.user.id }).first() : null;
    if (!team) return null;
    opts.teamId = team.id;
    if (!opts.quantity) opts.quantity = Math.max(config.pricing.teamMinSeats, team.seats || 0);
  }
  const q = await quote(req.user, kind, opts);
  return { kind, q, opts };
}

router.get('/upgrade', async (req, res) => {
  const plan = req.user ? await effectivePlan(req.user) : 'free';
  const founding = await foundingAvailable();
  const cards = req.user ? await db('cards').where({ user_id: req.user.id }).orderBy('id') : [];
  res.render('upgrade', { title: 'Plans and services', plan, founding, cards, sent: req.query.sent === '1' });
});

router.get('/checkout/:kind', requireUser, async (req, res) => {
  const r = await quoteFor(req);
  if (!r) return res.status(404).render('error', { title: 'Not found', message: 'That product is not available.' });
  res.render('checkout', { title: 'Checkout', kind: r.kind, q: r.q, opts: r.opts, needsShipping: r.kind === 'nfc' || r.kind === 'nfc_replacement' });
});

router.post('/checkout/:kind', requireUser, async (req, res) => {
  const r = await quoteFor(req);
  if (!r) return res.status(404).render('error', { title: 'Not found', message: 'That product is not available.' });
  const { kind, q } = r;
  const meta = { ...q.meta, label: q.label };
  if (kind === 'nfc' || kind === 'nfc_replacement') {
    meta.ship_name = clean(req.body.ship_name, 120);
    meta.ship_phone = cleanPhone(req.body.ship_phone);
    meta.ship_address = clean(req.body.ship_address, 500);
    if (!meta.ship_name || !meta.ship_phone || !meta.ship_address) {
      return res.status(400).render('checkout', { title: 'Checkout', kind, q, opts: r.opts, needsShipping: true, error: 'Add a delivery name, phone and address.' });
    }
  }
  const reference = `HT-${kind.toUpperCase().slice(0, 4)}-${Date.now().toString(36).toUpperCase()}-${randomCode(4)}`;
  await db('payments').insert({
    reference,
    user_id: req.user.id,
    kind,
    quantity: meta.seats || meta.quantity || 1,
    target_id: kind === 'footer' ? r.opts.card.id : kind === 'team' ? r.opts.teamId : null,
    amount_naira: q.total,
    credit_used: q.credit,
    discount_naira: q.discount,
    status: 'pending',
    meta_json: JSON.stringify(meta),
  });

  if (!config.paymentsEnabled) {
    if (config.isProd) return res.status(503).render('error', { title: 'Payments unavailable', message: 'Payments are being set up. Please try again shortly.' });
    return res.redirect(`/pay/simulate/${reference}`);
  }
  try {
    const init = await paystack.initialize({
      email: req.user.email,
      amountNaira: q.total,
      reference,
      callbackUrl: `${config.baseUrl}/pay/callback`,
      metadata: { kind, user_id: req.user.id, label: q.label },
    });
    res.redirect(303, init.authorization_url);
  } catch (e) {
    console.error('[paystack init]', e.message);
    res.status(502).render('error', { title: "Couldn't start payment", message: 'Paystack did not respond. Please try again in a minute.' });
  }
});

router.get('/pay/callback', requireUser, async (req, res) => {
  const reference = String(req.query.reference || req.query.trxref || '');
  const pay = await db('payments').where({ reference, user_id: req.user.id }).first();
  if (!pay) return res.redirect('/dashboard');
  try {
    if (pay.status !== 'success') {
      const v = await paystack.verify(reference);
      if (v.status === 'success') await fulfil(reference, { paidAmountNaira: v.amount / 100 });
      else {
        await db('payments').where({ id: pay.id }).update({ status: 'failed', updated_at: new Date() });
        req.session.flash = { type: 'warn', text: 'Payment was not completed. You have not been charged.' };
        return res.redirect('/upgrade');
      }
    }
    req.session.flash = { type: 'success', text: 'Payment received. Thank you!' };
  } catch (e) {
    console.error('[paystack verify]', e.message);
    req.session.flash = { type: 'warn', text: "We're confirming your payment. It will show within a few minutes." };
  }
  res.redirect(pay.kind === 'team' ? '/teams' : '/dashboard');
});

// Development only: simulate a successful payment when Paystack keys are not set.
router.get('/pay/simulate/:ref', requireUser, async (req, res) => {
  if (config.isProd || config.paymentsEnabled) return res.redirect('/dashboard');
  const pay = await db('payments').where({ reference: req.params.ref, user_id: req.user.id }).first();
  if (!pay) return res.redirect('/dashboard');
  res.render('simulate', { title: 'Test payment', pay });
});

router.post('/pay/simulate/:ref', requireUser, async (req, res) => {
  if (config.isProd || config.paymentsEnabled) return res.redirect('/dashboard');
  const pay = await db('payments').where({ reference: req.params.ref, user_id: req.user.id }).first();
  if (!pay) return res.redirect('/dashboard');
  await fulfil(pay.reference);
  req.session.flash = { type: 'success', text: 'Test payment applied.' };
  res.redirect(pay.kind === 'team' ? '/teams' : '/dashboard');
});

module.exports = router;
