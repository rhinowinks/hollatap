const { db } = require('./db');
const config = require('./config');
const mailer = require('./lib/mailer');
const crm = require('./lib/crm');

const INACTIVE_DAYS = 365;
const WARN_BEFORE_DAYS = 30;

async function deleteUserEverything(trx, userId) {
  const cards = await trx('cards').where({ user_id: userId }).select('id');
  const ids = cards.map((c) => c.id);
  if (ids.length) {
    await trx('leads').whereIn('card_id', ids).del();
    await trx('nfc_tags').whereIn('card_id', ids).update({ card_id: null, claimed_at: null });
  }
  await trx('cards').where({ user_id: userId }).del();
  await trx('invites').whereIn('team_id', trx('teams').select('id').where({ owner_id: userId })).del();
  const owned = await trx('teams').where({ owner_id: userId }).select('id');
  for (const t of owned) {
    await trx('users').where({ team_id: t.id }).update({ team_id: null, team_role: null });
    await trx('cards').where({ team_id: t.id }).update({ team_id: null });
  }
  await trx('teams').where({ owner_id: userId }).del();
  await trx('enquiries').where({ user_id: userId }).update({ user_id: null });
  // CRM record goes too: the person asked for their data to be deleted.
  const cc = await trx('crm_contacts').where({ user_id: userId }).first();
  if (cc) {
    for (const t of ['crm_activities', 'crm_tasks', 'crm_messages', 'crm_deals']) await trx(t).where({ contact_id: cc.id }).del();
    await trx('crm_contacts').where({ id: cc.id }).del();
  }
  const user = await trx('users').where({ id: userId }).first();
  if (user) await trx('login_codes').where({ email: user.email }).del();
  await trx('users').where({ id: userId }).del();
  // payments & commissions are kept as financial records, without personal data beyond the user id
}

async function runOnce() {
  const now = new Date();
  await db('login_codes').where('expires_at', '<', now).del();
  await db('commissions').where({ status: 'pending' }).where('payable_at', '<=', now).update({ status: 'payable', updated_at: now });

  // Inactivity: warn at 11 months, delete free accounts 30 days after warning.
  const warnCutoff = new Date(now.getTime() - (INACTIVE_DAYS - WARN_BEFORE_DAYS) * 864e5);
  const toWarn = await db('users').where('last_seen_at', '<', warnCutoff).whereNull('deletion_warned_at').limit(200);
  for (const u of toWarn) {
    await mailer.send({
      to: u.email,
      subject: 'Your HollaTap account will be deleted in 30 days',
      title: 'Still using HollaTap?',
      html: `<p>You haven't signed in for almost a year. To protect your data, we'll delete your account and cards in 30 days.</p><p>To keep them, just <a href="${config.baseUrl}/login" style="color:#C2410C">sign in</a>.</p>`,
      text: `Sign in within 30 days to keep your HollaTap account: ${config.baseUrl}/login`,
    }).catch(() => {});
    await db('users').where({ id: u.id }).update({ deletion_warned_at: now });
  }
  const delCutoff = new Date(now.getTime() - WARN_BEFORE_DAYS * 864e5);
  const toDelete = await db('users').where('deletion_warned_at', '<', delCutoff).where('last_seen_at', '<', warnCutoff).limit(200);
  for (const u of toDelete) {
    const paid = u.plan === 'pro' && u.plan_expires_at && new Date(u.plan_expires_at) > now;
    if (paid) continue;
    await db.transaction((trx) => deleteUserEverything(trx, u.id));
    await db('audit').insert({ event: 'auto_delete_inactive', user_id: u.id, detail: '' });
  }
}

// Monday-morning summary for the owners.
async function weeklySummary(now = new Date()) {
  const lagos = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
  if (lagos.getDay() !== 1 || lagos.getHours() < 8) return false;
  const stamp = `weekly_${lagos.toISOString().slice(0, 10)}`;
  if (await crm.getSetting(stamp)) return false;
  await crm.setSetting(stamp, now.toISOString());
  const since = new Date(now.getTime() - 7 * 864e5);
  const n = async (q) => Number((await q.count({ n: '*' }).first()).n || 0);
  const s = async (q, c) => Number((await q.sum({ s: c }).first()).s || 0);
  const r = {
    signups: await n(db('users').where('created_at', '>=', since).where({ is_demo: false })),
    paid: await n(db('payments').where({ status: 'success', is_demo: false }).where('paid_at', '>=', since)),
    revenue: await s(db('payments').where({ status: 'success', is_demo: false }).where('paid_at', '>=', since), 'amount_naira'),
    leads: await n(db('crm_contacts').where({ is_demo: false }).whereNot({ source: 'signup' }).where('created_at', '>=', since)),
    won: await n(db('crm_deals').where({ stage: 'won', is_demo: false }).where('closed_at', '>=', since)),
    wonValue: await s(db('crm_deals').where({ stage: 'won', is_demo: false }).where('closed_at', '>=', since), 'value_naira'),
    nfc: await n(db('nfc_orders').where({ is_demo: false }).where('created_at', '>=', since)),
  };
  const naira = (v) => '₦' + Math.round(v).toLocaleString('en-NG');
  const rows = [['New sign-ups', r.signups], ['Payments', r.paid], ['Revenue', naira(r.revenue)], ['New leads', r.leads], ['Deals won', `${r.won} (${naira(r.wonValue)})`], ['NFC card orders', r.nfc]];
  const to = config.adminEmails.join(',');
  if (to) {
    await mailer.send({
      to, subject: `HollaTap this week: ${r.signups} sign-ups, ${naira(r.revenue)} revenue`, title: 'Your HollaTap week',
      html: `<table style="border-collapse:collapse;font-size:15px">${rows.map(([a, b]) => `<tr><td style="padding:6px 16px 6px 0;color:#5B6573">${a}</td><td style="padding:6px 0;font-weight:bold">${b}</td></tr>`).join('')}</table><p><a href="${config.baseUrl}/admin" style="color:#C2410C">Open the Team Portal</a></p>`,
      text: rows.map(([a, b]) => `${a}: ${b}`).join('\n'),
    }).catch(() => {});
  }
  return true;
}

function start() {
  const tick = async () => {
    await runOnce().catch((e) => console.error('[jobs]', e.message));
    await crm.syncAll().catch((e) => console.error('[crm sync]', e.message));
    await crm.runOccasions().catch((e) => console.error('[occasions]', e.message));
    await weeklySummary().catch((e) => console.error('[weekly]', e.message));
  };
  setTimeout(tick, 10 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { start, runOnce, deleteUserEverything, weeklySummary };
