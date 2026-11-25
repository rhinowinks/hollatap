const { db } = require('../db');
const config = require('../config');
const { addYears, addDays, isFuture } = require('./util');
const mailer = require('./mailer');

const P = config.pricing;

async function foundingAvailable() {
  if (Date.now() > new Date(P.foundingEnds).getTime()) return { open: false, left: 0 };
  const row = await db('users').where({ founding_member: true }).count({ n: '*' }).first();
  const used = Number(row.n || 0);
  return { open: used < P.foundingLimit, left: Math.max(0, P.foundingLimit - used) };
}

function teamSeatPrice(seats) {
  return seats >= 50 ? P.teamSeat50 : P.teamSeat;
}

// Returns { base, discount, credit, total, label, meta }
async function quote(user, kind, { quantity = 1, cardId, teamId } = {}) {
  let base = 0;
  let label = '';
  const meta = {};
  if (kind === 'pro') {
    const f = await foundingAvailable();
    const alreadyPro = user.plan === 'pro' && user.plan_expires_at;
    if (f.open && !alreadyPro) {
      base = P.proFounding;
      meta.founding = true;
      label = 'HollaTap Pro, 1 year (founding member price)';
    } else {
      base = P.proAnnual;
      label = 'HollaTap Pro, 1 year';
    }
  } else if (kind === 'footer') {
    base = P.footerRemoval;
    label = 'Footer removal, 1 card, 1 year';
    meta.cardId = cardId;
  } else if (kind === 'team') {
    const seats = Math.max(P.teamMinSeats, parseInt(quantity, 10) || P.teamMinSeats);
    base = seats * teamSeatPrice(seats);
    label = `HollaTap Teams, ${seats} staff, 1 year`;
    meta.seats = seats;
    meta.teamId = teamId;
    meta.cardsIncluded = seats >= P.teamCardIncludedFrom;
  } else if (kind === 'nfc') {
    const q = Math.max(1, Math.min(500, parseInt(quantity, 10) || 1));
    base = q * P.nfcCard;
    label = `HollaTap NFC card × ${q}`;
    meta.quantity = q;
  } else if (kind === 'nfc_replacement') {
    base = P.nfcReplacement;
    label = 'Replacement NFC card';
    meta.quantity = 1;
  } else {
    throw new Error('Unknown product');
  }

  // Friend discount: first paid purchase by a referred user
  let discount = 0;
  if (user.referred_by) {
    const prior = await db('payments').where({ user_id: user.id, status: 'success' }).first();
    if (!prior) discount = Math.round((base * P.friendDiscountPct) / 100);
  }
  const afterDiscount = base - discount;
  const credit = Math.min(user.credit_naira || 0, Math.max(0, afterDiscount - 100)); // Paystack minimum ₦100
  const total = afterDiscount - credit;
  return { base, discount, credit, total, label, meta };
}

async function commissionRate(affiliateId, kind, conn = db) {
  if (kind === 'nfc' || kind === 'nfc_replacement') return P.affiliateNfcPct;
  const now = new Date();
  const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const row = await conn('commissions')
    .where({ affiliate_id: affiliateId })
    .whereNot({ status: 'void' })
    .where('created_at', '>=', qStart)
    .count({ n: '*' })
    .first();
  const n = Number(row.n || 0);
  let rate = P.affiliatePct;
  if (Date.now() <= new Date(P.launchEnds).getTime()) rate = Math.max(rate, P.affiliateLaunchPct);
  if (n >= P.affiliateTopThreshold) rate = Math.max(rate, P.affiliateTopPct);
  return rate;
}

// Idempotent: apply a successful payment exactly once.
async function fulfil(reference, { paidAmountNaira } = {}) {
  return db.transaction(async (trx) => {
    const pay = await trx('payments').where({ reference }).forUpdate().first();
    if (!pay) throw new Error('Unknown payment');
    if (pay.status === 'success') return { already: true, payment: pay };
    if (paidAmountNaira !== undefined && Math.round(paidAmountNaira) < pay.amount_naira) {
      await trx('payments').where({ id: pay.id }).update({ status: 'failed', updated_at: new Date() });
      throw new Error('Amount mismatch');
    }
    const meta = JSON.parse(pay.meta_json || '{}');
    const user = await trx('users').where({ id: pay.user_id }).first();
    const now = new Date();

    if (pay.kind === 'pro') {
      const from = isFuture(user.plan_expires_at) ? new Date(user.plan_expires_at) : now;
      const upd = { plan: 'pro', plan_expires_at: addYears(from, 1), updated_at: now };
      if (meta.founding) upd.founding_member = true;
      await trx('users').where({ id: user.id }).update(upd);
    } else if (pay.kind === 'footer') {
      const card = await trx('cards').where({ id: pay.target_id, user_id: user.id }).first();
      if (card) {
        const from = isFuture(card.footer_paid_until) ? new Date(card.footer_paid_until) : now;
        await trx('cards').where({ id: card.id }).update({ footer_removed: true, footer_paid_until: addYears(from, 1), updated_at: now });
      }
    } else if (pay.kind === 'team') {
      const team = await trx('teams').where({ id: pay.target_id }).first();
      if (team) {
        const from = isFuture(team.paid_until) ? new Date(team.paid_until) : now;
        await trx('teams').where({ id: team.id }).update({
          seats: Math.max(team.seats || 0, meta.seats || 0),
          paid_until: addYears(from, 1),
          verified: true,
          updated_at: now,
        });
        if (meta.cardsIncluded) {
          await trx('nfc_orders').insert({ user_id: user.id, team_id: team.id, quantity: meta.seats, kind: 'included', status: 'new', payment_id: pay.id });
        }
      }
    } else if (pay.kind === 'nfc' || pay.kind === 'nfc_replacement') {
      await trx('nfc_orders').insert({
        user_id: user.id,
        team_id: user.team_id || null,
        quantity: meta.quantity || 1,
        kind: pay.kind === 'nfc' ? 'paid' : 'replacement',
        ship_name: meta.ship_name || null,
        ship_phone: meta.ship_phone || null,
        ship_address: meta.ship_address || null,
        status: 'new',
        payment_id: pay.id,
      });
    }

    if (pay.credit_used > 0) {
      await trx('users').where({ id: user.id }).update({ credit_naira: Math.max(0, (user.credit_naira || 0) - pay.credit_used) });
    }

    await trx('payments').where({ id: pay.id }).update({ status: 'success', paid_at: now, updated_at: now });

    // Referral rewards: only once per referred user (first successful payment)
    if (user.referred_by) {
      const prior = await trx('payments').where({ user_id: user.id, status: 'success' }).whereNot({ id: pay.id }).first();
      const referrer = await trx('users').where({ id: user.referred_by }).first();
      if (referrer && referrer.id !== user.id) {
        const inFirstYear = Date.now() - new Date(user.created_at).getTime() < 365 * 864e5;
        if (referrer.is_affiliate && inFirstYear) {
          const rate = await commissionRate(referrer.id, pay.kind, trx);
          const gross = pay.amount_naira + pay.credit_used; // commission on what the customer was charged
          const amount = Math.floor((gross * rate) / 100);
          if (amount > 0) {
            await trx('commissions').insert({
              affiliate_id: referrer.id,
              payment_id: pay.id,
              rate_pct: rate,
              amount_naira: amount,
              status: 'pending',
              payable_at: addDays(now, P.refundWindowDays),
            });
          }
        } else if (!prior) {
          await trx('users').where({ id: referrer.id }).update({ credit_naira: (referrer.credit_naira || 0) + P.userCredit });
        }
      }
    }

    await trx('audit').insert({ event: 'payment_success', user_id: user.id, detail: `${pay.kind} ${pay.reference} ₦${pay.amount_naira}` });
    return { payment: { ...pay, status: 'success' } };
  }).then(async (r) => {
    if (!r.already) {
      const user = await db('users').where({ id: r.payment.user_id }).first();
      await mailer.send({
        to: user.email,
        subject: 'Payment received: thank you',
        title: 'Payment received',
        html: `<p>We received ₦${r.payment.amount_naira.toLocaleString('en-NG')} for <b>${JSON.parse(r.payment.meta_json || '{}').label || r.payment.kind}</b>.</p><p>Reference: ${r.payment.reference}</p><p><a href="${config.baseUrl}/dashboard" style="color:#C2410C">Go to your dashboard</a></p>`,
        text: `We received ₦${r.payment.amount_naira} (ref ${r.payment.reference}).`,
      }).catch(() => {});
    }
    return r;
  });
}

module.exports = { quote, fulfil, foundingAvailable, teamSeatPrice, commissionRate };
