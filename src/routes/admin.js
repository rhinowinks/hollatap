const express = require('express');
const { db } = require('../db');
const config = require('../config');
const { requireAdmin } = require('../lib/auth');
const { clean, cleanUrl, randomCode } = require('../lib/util');
const { INDUSTRIES } = require('../lib/promos');

const router = express.Router();
router.use('/admin', requireAdmin);

const count = async (q) => Number((await q.count({ n: '*' }).first()).n || 0);
const sum = async (q, col) => Number((await q.sum({ s: col }).first()).s || 0);

router.get('/admin', async (req, res) => {
  const since = new Date(Date.now() - 30 * 864e5);
  const stats = {
    users: await count(db('users')),
    users30: await count(db('users').where('created_at', '>=', since)),
    cards: await count(db('cards')),
    pro: await count(db('users').where({ plan: 'pro' }).where('plan_expires_at', '>', new Date())),
    founding: await count(db('users').where({ founding_member: true })),
    teams: await count(db('teams').where('paid_until', '>', new Date())),
    revenue: await sum(db('payments').where({ status: 'success' }), 'amount_naira'),
    revenue30: await sum(db('payments').where({ status: 'success' }).where('paid_at', '>=', since), 'amount_naira'),
    enquiriesNew: await count(db('enquiries').where({ status: 'new' })),
    nfcNew: await count(db('nfc_orders').where({ status: 'new' })),
    payable: await sum(db('commissions').where({ status: 'payable' }), 'amount_naira'),
    leads: await count(db('leads')),
  };
  const promos = await db('promos').orderBy('clicks', 'desc').limit(5);
  res.render('admin/index', { title: 'Admin', stats, promos });
});

router.get('/admin/users', async (req, res) => {
  const q = clean(req.query.q, 120);
  let query = db('users').orderBy('id', 'desc').limit(200);
  if (q) query = query.where('email', 'like', `%${q.toLowerCase()}%`);
  res.render('admin/users', { title: 'Users', users: await query, q });
});

router.get('/admin/payments', async (req, res) => {
  const payments = await db('payments').leftJoin('users', 'payments.user_id', 'users.id').select('payments.*', 'users.email').orderBy('payments.id', 'desc').limit(300);
  res.render('admin/payments', { title: 'Payments', payments });
});

router.get('/admin/enquiries', async (req, res) => {
  res.render('admin/enquiries', { title: 'Enquiries', enquiries: await db('enquiries').orderBy('id', 'desc').limit(300) });
});
router.post('/admin/enquiries/:id', async (req, res) => {
  await db('enquiries').where({ id: req.params.id }).update({ status: ['new', 'contacted', 'won', 'lost'].includes(req.body.status) ? req.body.status : 'new', updated_at: new Date() });
  res.redirect('/admin/enquiries');
});

router.get('/admin/promos', async (req, res) => {
  res.render('admin/promos', { title: 'Promotions', promos: await db('promos').orderBy('id'), industries: INDUSTRIES, error: null });
});
router.post('/admin/promos', async (req, res) => {
  const row = {
    title: clean(req.body.title, 120),
    body: clean(req.body.body, 300),
    cta: clean(req.body.cta, 40) || 'Learn more',
    url: cleanUrl(req.body.url),
    industry: INDUSTRIES.includes(req.body.industry) ? req.body.industry : null,
    slot: ['any', 'created', 'dashboard'].includes(req.body.slot) ? req.body.slot : 'any',
    active: req.body.active === 'on',
  };
  if (!row.title || !row.url) {
    return res.status(400).render('admin/promos', { title: 'Promotions', promos: await db('promos').orderBy('id'), industries: INDUSTRIES, error: 'Title and a valid link are required.' });
  }
  if (req.body.id) await db('promos').where({ id: req.body.id }).update({ ...row, updated_at: new Date() });
  else await db('promos').insert(row);
  res.redirect('/admin/promos');
});
router.post('/admin/promos/:id/delete', async (req, res) => {
  await db('promos').where({ id: req.params.id }).del();
  res.redirect('/admin/promos');
});

router.get('/admin/commissions', async (req, res) => {
  const rows = await db('commissions')
    .leftJoin('users', 'commissions.affiliate_id', 'users.id')
    .select('commissions.*', 'users.email', 'users.affiliate_bank')
    .orderBy('commissions.id', 'desc')
    .limit(500);
  res.render('admin/commissions', { title: 'Affiliate commissions', rows, minPayout: config.pricing.minPayout });
});
router.post('/admin/commissions/:id/paid', async (req, res) => {
  await db('commissions').where({ id: req.params.id, status: 'payable' }).update({ status: 'paid', paid_at: new Date(), updated_at: new Date() });
  res.redirect('/admin/commissions');
});
router.post('/admin/commissions/:id/void', async (req, res) => {
  await db('commissions').where({ id: req.params.id }).whereIn('status', ['pending', 'payable']).update({ status: 'void', updated_at: new Date() });
  res.redirect('/admin/commissions');
});

router.get('/admin/nfc', async (req, res) => {
  const orders = await db('nfc_orders').leftJoin('users', 'nfc_orders.user_id', 'users.id').leftJoin('teams', 'nfc_orders.team_id', 'teams.id').select('nfc_orders.*', 'users.email', 'teams.name as team_name').orderBy('nfc_orders.id', 'desc').limit(300);
  const batches = await db('nfc_tags').select('batch').count({ total: '*' }).count({ claimed: 'card_id' }).groupBy('batch').orderBy('batch', 'desc');
  res.render('admin/nfc', { title: 'NFC cards', orders, batches });
});
router.post('/admin/nfc/orders/:id', async (req, res) => {
  const status = ['new', 'dispatched', 'delivered'].includes(req.body.status) ? req.body.status : 'new';
  await db('nfc_orders').where({ id: req.params.id }).update({ status, updated_at: new Date() });
  res.redirect('/admin/nfc');
});
// Generate a batch of unique tag codes for the factory to encode (URL + printed serial)
router.post('/admin/nfc/batch', async (req, res) => {
  const qty = Math.max(1, Math.min(10000, parseInt(req.body.qty, 10) || 0));
  const batch = clean(req.body.batch, 40) || `B${new Date().toISOString().slice(0, 10)}`;
  const rows = [];
  const seen = new Set();
  while (rows.length < qty) {
    const code = randomCode(7);
    if (seen.has(code)) continue;
    seen.add(code);
    rows.push({ code, batch });
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db('nfc_tags').insert(rows.slice(i, i + 500)).onConflict('code').ignore();
  }
  res.redirect(`/admin/nfc/batch/${encodeURIComponent(batch)}.csv`);
});
router.get('/admin/nfc/batch/:batch.csv', async (req, res) => {
  const tags = await db('nfc_tags').where({ batch: req.params.batch }).orderBy('id');
  const lines = ['serial,url'].concat(tags.map((t) => `${t.code},${config.baseUrl}/t/${t.code}`));
  res.setHeader('Content-Disposition', `attachment; filename="hollatap-nfc-${req.params.batch}.csv"`);
  res.type('text/csv').send(lines.join('\r\n'));
});

module.exports = router;
