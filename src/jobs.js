const { db } = require('./db');
const config = require('./config');
const mailer = require('./lib/mailer');

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

function start() {
  const tick = () => runOnce().catch((e) => console.error('[jobs]', e.message));
  setTimeout(tick, 10 * 1000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { start, runOnce, deleteUserEverything };
