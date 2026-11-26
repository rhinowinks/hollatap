// HollaTap Team Portal: how Rhinowinks staff run HollaTap (CRM, messages, money, NFC, affiliates, staff).
const express = require('express');
const { db } = require('../db');
const config = require('../config');
const { clean, cleanUrl, cleanEmail, randomCode, naira, addDays, randomDigits } = require('../lib/util');
const { INDUSTRIES } = require('../lib/promos');
const { foundingAvailable } = require('../lib/billing');
const crm = require('../lib/crm');
const mailer = require('../lib/mailer');
const demo = require('../lib/demo');

const router = express.Router();

// ---------- access ----------
router.use('/admin', (req, res, next) => {
  const role = crm.roleOf(req.user);
  if (!req.user) { req.session.next = req.originalUrl; return res.redirect('/login'); }
  if (!role) return res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
  res.locals.role = role;
  res.locals.perms = role === 'owner' ? ['dashboard', 'contacts', 'pipeline', 'tasks', 'messages', 'bulk', 'occasions', 'money', 'nfc', 'affiliates', 'staff', 'reports', 'settings', 'demo', 'users', 'promos', 'enquiries']
    : role === 'sales' ? ['dashboard', 'contacts', 'pipeline', 'tasks', 'messages', 'occasions', 'nfc', 'enquiries'] : ['dashboard', 'contacts', 'tasks', 'messages', 'nfc'];
  res.locals.C = crm;
  res.locals.naira = naira;
  res.locals.nairaShort = (v) => (Math.abs(v) >= 1e6 ? `₦${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.0+$/, '')}m` : naira(v));
  next();
});
const need = (what) => (req, res, next) => (res.locals.perms.includes(what) ? next() : res.status(403).render('portal/denied', { title: 'Not for your role', section: '' }));
const page = (res, view, title, extra = {}) => res.render(`portal/${view}`, { title, section: '', intro: null, actions: null, ...extra });
const back = (req, res, fallback) => res.redirect(req.get('referer') && req.get('referer').includes('/admin') ? req.get('referer') : fallback);
const flash = (req, type, text) => { req.session.flash = { type, text }; };

const count = async (q) => Number((await q.count({ n: '*' }).first()).n || 0);
const sum = async (q, col) => Number((await q.sum({ s: col }).first()).s || 0);
const staffList = () => db('users').where((w) => w.where({ is_admin: true }).orWhereNotNull('staff_role')).orderBy('email');
const staffName = (s) => (s ? (s.name || s.email.split('@')[0]) : '');
const days = (req) => ([7, 14, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30);
const csvCell = (v) => { const s = String(v == null ? '' : v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
const toInt = (v) => { const n = parseInt(String(v || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
const mmdd = (v) => { const m = String(v || '').match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/); return m ? `${m[1]}-${m[2]}` : null; };

// ---------- dashboard ----------
router.get('/admin', async (req, res) => {
  await crm.syncAll().catch(() => {});
  const d = days(req);
  const since = new Date(Date.now() - d * 864e5);
  const product = req.query.product || '';
  const who = req.query.who || '';
  const acts = String(req.query.acts || '').split(',').filter(Boolean);
  const actQ = db('crm_activities').where('created_at', '>=', since).whereNotIn('type', ['system', 'stage']);
  if (who) actQ.where({ staff_id: Number(who) });
  if (acts.length) actQ.whereIn('type', acts);
  const dealQ = () => { const q = db('crm_deals'); if (product) q.where({ product }); if (who) q.where({ owner_id: Number(who) }); return q; };
  const now = new Date();
  const money = res.locals.perms.includes('money');
  const founding = await foundingAvailable();
  const stats = {
    activities: await count(actQ.clone()),
    signups: await count(db('users').where('created_at', '>=', since)),
    pipeline: await sum(dealQ().whereNotIn('stage', ['won', 'lost']), 'value_naira'),
    openDeals: await count(dealQ().whereNotIn('stage', ['won', 'lost'])),
    warm: await count(db('crm_contacts').where({ stage: 'warm' }).where('updated_at', '>=', since)),
    won: await sum(dealQ().where({ stage: 'won' }).where('closed_at', '>=', since), 'value_naira'),
    wonCount: await count(dealQ().where({ stage: 'won' }).where('closed_at', '>=', since)),
    revenue: money ? await sum(db('payments').where({ status: 'success' }).where('paid_at', '>=', since), 'amount_naira') : null,
    paidNow: await count(db('users').whereIn('plan', ['pro', 'team']).where('plan_expires_at', '>', now)),
    trials: await count(db('users').where('trial_ends_at', '>', now).where((w) => w.whereNull('plan_expires_at').orWhere('plan_expires_at', '<', now))),
    newLeads: await count(db('crm_contacts').where({ stage: 'new' }).whereNot({ source: 'signup' })),
    nfcOpen: await count(db('nfc_orders').whereNotIn('status', ['delivered'])),
  };
  const me = req.user.id;
  const today = {
    tasks: await db('crm_tasks').leftJoin('crm_contacts', 'crm_tasks.contact_id', 'crm_contacts.id').whereNull('crm_tasks.done_at')
      .where('crm_tasks.due_at', '<=', new Date(new Date().setHours(23, 59, 59, 999))).where((w) => (res.locals.role === 'owner' && !who ? w : w.where('crm_tasks.assignee_id', who ? Number(who) : me)))
      .select('crm_tasks.*', 'crm_contacts.name as contact_name').orderBy('crm_tasks.due_at').limit(12),
    leads: await db('crm_contacts').where({ stage: 'new' }).whereNot({ source: 'signup' }).orderBy('created_at', 'desc').limit(8),
    trialsEnding: await db('users').whereBetween('trial_ends_at', [now, addDays(now, 3)]).where((w) => w.whereNull('plan_expires_at').orWhere('plan_expires_at', '<', now)).orderBy('trial_ends_at').limit(8),
    renewals: await db('users').whereIn('plan', ['pro', 'team']).whereBetween('plan_expires_at', [now, addDays(now, 30)]).orderBy('plan_expires_at').limit(8),
    birthdays: await db('crm_contacts').whereIn('birthday', [0, 1, 2, 3, 4, 5, 6].map((i) => { const x = addDays(now, i); return `${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })).limit(8),
  };
  for (const k of ['trialsEnding', 'renewals']) {
    const ids = today[k].map((u) => u.id);
    const map = ids.length ? Object.fromEntries((await db('crm_contacts').whereIn('user_id', ids).select('id', 'user_id')).map((c) => [c.user_id, c.id])) : {};
    today[k].forEach((u) => { u.contact_id = map[u.id]; });
  }
  page(res, 'dashboard', 'Dashboard', {
    section: 'dashboard', intro: 'The whole of HollaTap at a glance. Pick the period, product, person and activities to view.',
    stats, today, founding, d, product, who, acts, staff: await staffList(),
    demoCount: await count(db('crm_contacts').where({ is_demo: true })),
  });
});

router.get('/admin/menu', (req, res) => page(res, 'menu', 'Main menu', { section: 'menu', intro: 'Everything in the portal, one tap away.' }));

// ---------- contacts ----------
router.get('/admin/contacts', need('contacts'), async (req, res) => {
  await crm.syncAll().catch(() => {});
  const seg = crm.segmentFrom(req.query);
  const pg = Math.max(1, toInt(req.query.page) || 1);
  const base = crm.applySegment(db('crm_contacts'), seg);
  const total = await count(base.clone());
  const rows = await base.clone().leftJoin('users as o', 'crm_contacts.owner_id', 'o.id').leftJoin('users as u', 'crm_contacts.user_id', 'u.id')
    .select('crm_contacts.*', 'o.email as owner_email', 'o.name as owner_name', 'u.plan', 'u.plan_expires_at', 'u.trial_ends_at')
    .orderBy('crm_contacts.updated_at', 'desc').limit(50).offset((pg - 1) * 50);
  const tags = [...new Set((await db('crm_contacts').select('tags').whereNot({ tags: '' }).limit(3000)).flatMap((r) => r.tags.split(',').map((t) => t.trim()).filter(Boolean)))].sort();
  page(res, 'contacts', 'Contacts', {
    section: 'crm', intro: 'Every sign-up, customer, lead and enquiry in one list. Filter, then act on the whole list.',
    rows, total, pg, seg, qs: new URLSearchParams(seg).toString(), tags, staff: await staffList(), industries: INDUSTRIES,
    actions: [{ href: '/admin/contacts/new', label: 'Add contact', primary: true }, { href: `/admin/contacts.csv?${new URLSearchParams(seg)}`, label: 'Export CSV' }],
  });
});

router.get('/admin/contacts.csv', need('contacts'), async (req, res) => {
  const seg = crm.segmentFrom(req.query);
  const rows = await crm.applySegment(db('crm_contacts'), seg).orderBy('id').limit(50000);
  const head = ['id', 'name', 'company', 'job_title', 'email', 'phone', 'city', 'industry', 'source', 'stage', 'tags', 'birthday', 'sms_ok', 'email_ok', 'created_at'];
  const lines = [head.join(',')].concat(rows.map((r) => head.map((h) => csvCell(r[h] instanceof Date ? r[h].toISOString() : r[h])).join(',')));
  await db('audit').insert({ event: 'crm_export', user_id: req.user.id, detail: `${rows.length} contacts ${JSON.stringify(seg)}` });
  res.setHeader('Content-Disposition', `attachment; filename="hollatap-contacts-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv').send(lines.join('\r\n'));
});

// Bulk actions on ticked contacts
router.post('/admin/contacts/bulk', need('contacts'), async (req, res) => {
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean);
  if (!ids.length) { flash(req, 'warn', 'Tick at least one contact first.'); return back(req, res, '/admin/contacts'); }
  const a = req.body.action;
  if (a === 'owner') await db('crm_contacts').whereIn('id', ids).update({ owner_id: Number(req.body.owner_id) || null, updated_at: new Date() });
  else if (a === 'stage' && crm.CONTACT_STAGES.some((s) => s[0] === req.body.stage)) await db('crm_contacts').whereIn('id', ids).update({ stage: req.body.stage, updated_at: new Date() });
  else if (a === 'tag' && clean(req.body.tag, 40)) {
    const t = clean(req.body.tag, 40).replace(/,/g, ' ');
    for (const c of await db('crm_contacts').whereIn('id', ids)) {
      const set = new Set(c.tags.split(',').map((x) => x.trim()).filter(Boolean)); set.add(t);
      await db('crm_contacts').where({ id: c.id }).update({ tags: [...set].join(','), updated_at: new Date() });
    }
  } else if (a === 'delete' && res.locals.role === 'owner') {
    for (const t of ['crm_activities', 'crm_tasks', 'crm_messages', 'crm_deals']) await db(t).whereIn('contact_id', ids).del();
    await db('crm_contacts').whereIn('id', ids).whereNull('user_id').del();
  }
  flash(req, 'success', `Updated ${ids.length} contact${ids.length > 1 ? 's' : ''}.`);
  back(req, res, '/admin/contacts');
});

router.post('/admin/contacts/import', need('contacts'), async (req, res) => {
  // Paste rows: name, phone, email, company, city, tags, birthday (MM-DD)
  const lines = String(req.body.rows || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5000);
  let added = 0;
  for (const line of lines) {
    const [name, phone, email, company, city, tags, bday] = line.split(/[,\t]/).map((x) => (x || '').trim());
    if (!name || /^name$/i.test(name)) continue;
    const em = cleanEmail(email);
    if (em && await db('crm_contacts').where({ email: em }).first()) continue;
    await db('crm_contacts').insert({ name: name.slice(0, 160), phone: phone || null, email: em || null, company: company || null, city: city || null, tags: (tags || '').replace(/;/g, ','), birthday: mmdd(bday), source: req.body.source || 'import', owner_id: req.user.id, sms_ok: req.body.consent === 'on', email_ok: req.body.consent === 'on' });
    added++;
  }
  flash(req, 'success', `Imported ${added} contact${added === 1 ? '' : 's'}. Rows with an email already in the CRM were skipped.`);
  res.redirect('/admin/contacts');
});

router.get('/admin/contacts/new', need('contacts'), async (req, res) => {
  page(res, 'contact-form', 'Add a contact', { section: 'crm', c: { stage: 'new', source: 'manual', tags: '' }, staff: await staffList(), industries: INDUSTRIES });
});

function contactFields(b) {
  return {
    name: clean(b.name, 160), company: clean(b.company, 160) || null, job_title: clean(b.job_title, 120) || null,
    email: cleanEmail(b.email) || null, phone: clean(b.phone, 40) || null, city: clean(b.city, 80) || null,
    industry: INDUSTRIES.includes(b.industry) ? b.industry : null,
    source: crm.SOURCES.some((s) => s[0] === b.source) ? b.source : 'manual',
    stage: crm.CONTACT_STAGES.some((s) => s[0] === b.stage) ? b.stage : 'new',
    owner_id: Number(b.owner_id) || null, tags: String(b.tags || '').split(',').map((t) => clean(t, 40)).filter(Boolean).join(','),
    birthday: mmdd(b.birthday), sms_ok: b.sms_ok === 'on', email_ok: b.email_ok === 'on',
  };
}
router.post('/admin/contacts', need('contacts'), async (req, res) => {
  const f = contactFields(req.body);
  if (!f.name) return page(res.status(400), 'contact-form', 'Add a contact', { section: 'crm', c: req.body, staff: await staffList(), industries: INDUSTRIES, error: 'Type the contact\'s name.' });
  if (!f.owner_id) f.owner_id = req.user.id;
  const [row] = await db('crm_contacts').insert(f).returning('id');
  const id = typeof row === 'object' ? row.id : row;
  await crm.log(id, req.user.id, 'system', `Added by ${staffName(req.user)}`);
  flash(req, 'success', `${f.name} added.`);
  res.redirect(`/admin/contacts/${id}`);
});

async function loadContact(req, res) {
  const c = await db('crm_contacts').where({ id: Number(req.params.id) }).first();
  if (!c) { res.status(404).render('error', { title: 'Not found', message: 'That contact no longer exists.' }); return null; }
  return c;
}

router.get('/admin/contacts/:id', need('contacts'), async (req, res) => {
  const c = await loadContact(req, res); if (!c) return;
  const [account, deals, tasks, timeline, messages, templates, staff] = await Promise.all([
    c.user_id ? db('users').where({ id: c.user_id }).first() : null,
    db('crm_deals').where({ contact_id: c.id }).orderBy('id', 'desc'),
    db('crm_tasks').where({ contact_id: c.id }).orderBy([{ column: 'done_at', order: 'desc' }, { column: 'due_at' }]),
    db('crm_activities').leftJoin('users', 'crm_activities.staff_id', 'users.id').where({ contact_id: c.id }).select('crm_activities.*', 'users.email as staff_email', 'users.name as staff_name').orderBy('crm_activities.id', 'desc').limit(200),
    db('crm_messages').where({ contact_id: c.id }).orderBy('id', 'desc').limit(30),
    db('crm_templates').orderBy('name'),
    staffList(),
  ]);
  let extra = {};
  if (account) {
    extra = {
      cards: await db('cards').where({ user_id: account.id }).select('id', 'slug', 'full_name', 'views', 'saves'),
      payments: await db('payments').where({ user_id: account.id, status: 'success' }).orderBy('id', 'desc'),
      nfc: await db('nfc_orders').where({ user_id: account.id }).orderBy('id', 'desc'),
      referrer: account.referred_by ? await db('users').where({ id: account.referred_by }).first() : null,
      team: account.team_id ? await db('teams').where({ id: account.team_id }).first() : null,
    };
  }
  page(res, 'contact', c.name, {
    section: 'crm', crumb: 'CRM · Contact', c, account, deals, tasks, timeline, messages, templates, staff, industries: INDUSTRIES, ...extra,
    wa: c.phone ? require('../lib/sms').intl(c.phone) : null,
  });
});

router.post('/admin/contacts/:id', need('contacts'), async (req, res) => {
  const c = await loadContact(req, res); if (!c) return;
  const f = contactFields(req.body);
  if (!f.name) f.name = c.name;
  if (c.user_id) f.email = c.email; // account email is changed by the customer, not here
  if (f.stage !== c.stage) await crm.log(c.id, req.user.id, 'stage', `Stage: ${crm.label(crm.CONTACT_STAGES, c.stage)} → ${crm.label(crm.CONTACT_STAGES, f.stage)}`);
  await db('crm_contacts').where({ id: c.id }).update({ ...f, updated_at: new Date() });
  flash(req, 'success', 'Saved.');
  res.redirect(`/admin/contacts/${c.id}`);
});

router.post('/admin/contacts/:id/activity', need('contacts'), async (req, res) => {
  const c = await loadContact(req, res); if (!c) return;
  const type = crm.ACTIVITY_TYPES.some((t) => t[0] === req.body.type) ? req.body.type : 'note';
  const summary = clean(req.body.summary, 4000);
  if (!summary) { flash(req, 'warn', 'Write what happened first.'); return res.redirect(`/admin/contacts/${c.id}`); }
  await crm.log(c.id, req.user.id, type, summary);
  if (req.body.stage && crm.CONTACT_STAGES.some((s) => s[0] === req.body.stage) && req.body.stage !== c.stage) {
    await db('crm_contacts').where({ id: c.id }).update({ stage: req.body.stage, updated_at: new Date() });
    await crm.log(c.id, req.user.id, 'stage', `Stage: ${crm.label(crm.CONTACT_STAGES, c.stage)} → ${crm.label(crm.CONTACT_STAGES, req.body.stage)}`);
  }
  if (req.body.follow_up) {
    await db('crm_tasks').insert({ title: clean(req.body.follow_title, 200) || `Follow up with ${c.name}`, contact_id: c.id, assignee_id: c.owner_id || req.user.id, created_by: req.user.id, due_at: new Date(`${req.body.follow_up}T09:00:00+01:00`) });
  }
  flash(req, 'success', 'Logged.');
  res.redirect(`/admin/contacts/${c.id}`);
});

router.post('/admin/contacts/:id/message', need('messages'), async (req, res) => {
  const c = await loadContact(req, res); if (!c) return;
  const channel = ['sms', 'email'].includes(req.body.channel) ? req.body.channel : 'sms';
  const body = String(req.body.body || '').trim().slice(0, 2000);
  if (!body) { flash(req, 'warn', 'Write the message first.'); return res.redirect(`/admin/contacts/${c.id}#message`); }
  const r = await crm.sendToContact(c, { channel, subject: clean(req.body.subject, 200), body, staffId: req.user.id });
  const st = r[0] || { status: 'skipped' };
  if (st.status === 'skipped') flash(req, 'warn', channel === 'sms' ? 'No phone number on this contact.' : 'No email address on this contact.');
  else if (st.status === 'failed') flash(req, 'error', `Not sent: ${st.error || 'the provider refused it'}.`);
  else flash(req, 'success', st.status === 'simulated' ? `Recorded as a test (${channel === 'sms' ? 'Termii key not set yet' : 'demo contact or email not set up'}). Nothing was sent.` : `${channel === 'sms' ? 'SMS' : 'Email'} sent to ${c.name}.`);
  res.redirect(`/admin/contacts/${c.id}`);
});

router.post('/admin/contacts/:id/delete', need('settings'), async (req, res) => {
  const c = await loadContact(req, res); if (!c) return;
  if (c.user_id) { flash(req, 'warn', 'This person has a HollaTap account. Their record is removed when they delete their account.'); return res.redirect(`/admin/contacts/${c.id}`); }
  for (const t of ['crm_activities', 'crm_tasks', 'crm_messages', 'crm_deals']) await db(t).where({ contact_id: c.id }).del();
  await db('crm_contacts').where({ id: c.id }).del();
  await db('audit').insert({ event: 'crm_contact_deleted', user_id: req.user.id, detail: c.name });
  flash(req, 'success', `${c.name} deleted.`);
  res.redirect('/admin/contacts');
});

// ---------- deals ----------
router.get('/admin/pipeline', need('pipeline'), async (req, res) => {
  await crm.syncAll().catch(() => {});
  const product = req.query.product || '';
  const who = req.query.who || '';
  const q = db('crm_deals').leftJoin('crm_contacts', 'crm_deals.contact_id', 'crm_contacts.id').leftJoin('users as o', 'crm_deals.owner_id', 'o.id')
    .select('crm_deals.*', 'crm_contacts.name as contact_name', 'crm_contacts.company as contact_company', 'o.email as owner_email', 'o.name as owner_name');
  if (product) q.where('crm_deals.product', product);
  if (who) q.where('crm_deals.owner_id', Number(who));
  q.where((w) => w.whereNotIn('crm_deals.stage', ['won', 'lost']).orWhere('crm_deals.closed_at', '>=', new Date(Date.now() - 60 * 864e5)));
  const deals = await q.orderBy('crm_deals.updated_at', 'desc').limit(1000);
  page(res, 'pipeline', 'Deals pipeline', {
    section: 'crm', intro: 'Drag a deal to move it to the next stage. Won and lost deals stay on the board for 60 days.',
    deals, product, who, staff: await staffList(), actions: [{ href: '/admin/contacts', label: 'Find a contact to add a deal' }],
  });
});

router.post('/admin/deals', need('pipeline'), async (req, res) => {
  const contactId = Number(req.body.contact_id);
  if (!contactId || !(await db('crm_contacts').where({ id: contactId }).first())) return back(req, res, '/admin/pipeline');
  const product = crm.PRODUCTS.includes(req.body.product) ? req.body.product : crm.PRODUCTS[0];
  await db('crm_deals').insert({
    contact_id: contactId, title: clean(req.body.title, 160) || product, product, value_naira: toInt(req.body.value_naira),
    stage: 'new', expected_month: /^\d{4}-\d{2}$/.test(req.body.expected_month || '') ? req.body.expected_month : null, owner_id: Number(req.body.owner_id) || req.user.id,
  });
  await crm.log(contactId, req.user.id, 'system', `New deal: ${product}${toInt(req.body.value_naira) ? ` worth ${naira(toInt(req.body.value_naira))}` : ''}`);
  flash(req, 'success', 'Deal added.');
  res.redirect(`/admin/contacts/${contactId}`);
});

router.post('/admin/deals/:id', need('pipeline'), async (req, res) => {
  const d = await db('crm_deals').where({ id: Number(req.params.id) }).first();
  if (!d) return back(req, res, '/admin/pipeline');
  const patch = { updated_at: new Date() };
  if (crm.DEAL_STAGES.some((s) => s[0] === req.body.stage)) patch.stage = req.body.stage;
  if (req.body.value_naira !== undefined) patch.value_naira = toInt(req.body.value_naira);
  if (req.body.title) patch.title = clean(req.body.title, 160);
  if (req.body.product && crm.PRODUCTS.includes(req.body.product)) patch.product = req.body.product;
  if (req.body.owner_id !== undefined) patch.owner_id = Number(req.body.owner_id) || null;
  if (req.body.expected_month !== undefined) patch.expected_month = /^\d{4}-\d{2}$/.test(req.body.expected_month) ? req.body.expected_month : null;
  if (req.body.lost_reason !== undefined) patch.lost_reason = crm.LOST_REASONS.includes(req.body.lost_reason) ? req.body.lost_reason : null;
  if (patch.stage && patch.stage !== d.stage) {
    patch.closed_at = ['won', 'lost'].includes(patch.stage) ? new Date() : null;
    await crm.log(d.contact_id, req.user.id, 'stage', `Deal "${d.title}": ${crm.label(crm.DEAL_STAGES, d.stage)} → ${crm.label(crm.DEAL_STAGES, patch.stage)}`, { deal_id: d.id });
    if (patch.stage === 'won') await db('crm_contacts').where({ id: d.contact_id }).update({ stage: 'customer', updated_at: new Date() });
  }
  await db('crm_deals').where({ id: d.id }).update(patch);
  back(req, res, '/admin/pipeline');
});

// ---------- tasks ----------
router.get('/admin/tasks', need('tasks'), async (req, res) => {
  const view = ['mine', 'all', 'done'].includes(req.query.view) ? req.query.view : 'mine';
  const q = db('crm_tasks').leftJoin('crm_contacts', 'crm_tasks.contact_id', 'crm_contacts.id').leftJoin('users as a', 'crm_tasks.assignee_id', 'a.id')
    .select('crm_tasks.*', 'crm_contacts.name as contact_name', 'a.email as assignee_email', 'a.name as assignee_name');
  if (view === 'done') q.whereNotNull('crm_tasks.done_at').orderBy('crm_tasks.done_at', 'desc');
  else q.whereNull('crm_tasks.done_at').orderBy('crm_tasks.due_at');
  if (view === 'mine') q.where('crm_tasks.assignee_id', req.user.id);
  page(res, 'tasks', 'Tasks', { section: 'crm', intro: 'Follow-ups and jobs for the team. Overdue tasks are shown in red.', tasks: await q.limit(300), view, staff: await staffList() });
});
router.post('/admin/tasks', need('tasks'), async (req, res) => {
  const title = clean(req.body.title, 200);
  if (!title) return back(req, res, '/admin/tasks');
  const due = req.body.due ? new Date(`${req.body.due}T${/^\d{2}:\d{2}$/.test(req.body.time || '') ? req.body.time : '09:00'}:00+01:00`) : null;
  await db('crm_tasks').insert({ title, contact_id: Number(req.body.contact_id) || null, assignee_id: Number(req.body.assignee_id) || req.user.id, created_by: req.user.id, due_at: due });
  const assignee = Number(req.body.assignee_id) && Number(req.body.assignee_id) !== req.user.id ? await db('users').where({ id: Number(req.body.assignee_id) }).first() : null;
  if (assignee) await mailer.send({ to: assignee.email, subject: `New task: ${title}`, title: 'New task for you', html: `<p>${staffName(req.user)} gave you a task:</p><p><b>${title.replace(/</g, '&lt;')}</b>${due ? `<br>Due ${due.toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}` : ''}</p><p><a href="${config.baseUrl}/admin/tasks" style="color:#C2410C">Open your tasks</a></p>`, text: `New task: ${title}` }).catch(() => {});
  flash(req, 'success', 'Task added.');
  back(req, res, '/admin/tasks');
});
router.post('/admin/tasks/:id/done', need('tasks'), async (req, res) => {
  const t = await db('crm_tasks').where({ id: Number(req.params.id) }).first();
  if (t) {
    await db('crm_tasks').where({ id: t.id }).update({ done_at: t.done_at ? null : new Date(), updated_at: new Date() });
    if (!t.done_at && t.contact_id) await crm.log(t.contact_id, req.user.id, 'note', `Task done: ${t.title}`);
  }
  back(req, res, '/admin/tasks');
});

// ---------- SMS & email ----------
router.get('/admin/messages', need('messages'), async (req, res) => {
  const seg = crm.segmentFrom(req.query);
  const audience = Object.keys(seg).length ? await count(crm.applySegment(db('crm_contacts'), seg)) : null;
  const reach = Object.keys(seg).length ? {
    sms: await count(crm.applySegment(db('crm_contacts'), seg).where({ sms_ok: true }).whereNotNull('phone')),
    email: await count(crm.applySegment(db('crm_contacts'), seg).where({ email_ok: true }).whereNotNull('email')),
  } : null;
  page(res, 'messages', 'SMS & Email', {
    section: 'crm', intro: 'Send one message, or send to a whole list. SMS goes through Termii; email goes from HollaTap.',
    seg, qs: new URLSearchParams(seg).toString(), audience, reach,
    templates: await db('crm_templates').orderBy('name'),
    campaigns: await db('crm_campaigns').orderBy('id', 'desc').limit(30),
    history: await db('crm_messages').leftJoin('crm_contacts', 'crm_messages.contact_id', 'crm_contacts.id').select('crm_messages.*', 'crm_contacts.name as contact_name').orderBy('crm_messages.id', 'desc').limit(60),
    smsEnabled: config.smsEnabled, mailEnabled: config.mailEnabled, industries: INDUSTRIES, staff: await staffList(),
  });
});

router.post('/admin/campaigns', need('bulk'), async (req, res) => {
  const seg = crm.segmentFrom(JSON.parse(req.body.segment || '{}'));
  const channel = ['sms', 'email', 'both'].includes(req.body.channel) ? req.body.channel : 'sms';
  const body = String(req.body.body || '').trim().slice(0, 2000);
  const name = clean(req.body.name, 160) || `${channel.toUpperCase()} ${new Date().toLocaleDateString('en-GB')}`;
  if (!body) { flash(req, 'warn', 'Write the message first.'); return back(req, res, '/admin/messages'); }
  if (!Object.keys(seg).length && req.body.everyone !== 'yes') { flash(req, 'warn', 'Pick a list with the filters first, or tick "Send to everyone who agreed to messages".'); return back(req, res, '/admin/messages'); }
  const [cid] = await db('crm_campaigns').insert({ name, channel, segment_json: JSON.stringify(seg), subject: clean(req.body.subject, 200), body, status: 'sending', created_by: req.user.id }).returning('id');
  const campaignId = typeof cid === 'object' ? cid.id : cid;
  const people = await crm.applySegment(db('crm_contacts'), seg).limit(20000);
  let sent = 0; let failed = 0; let skipped = 0;
  for (const c of people) {
    const r = await crm.sendToContact(c, { channel, subject: req.body.subject, body, staffId: req.user.id, kind: 'campaign', campaignId, marketing: true });
    for (const x of r) { if (x.status === 'sent' || x.status === 'simulated') sent++; else if (x.status === 'failed') failed++; else skipped++; }
  }
  await db('crm_campaigns').where({ id: campaignId }).update({ status: 'sent', sent_count: sent, failed_count: failed, sent_at: new Date() });
  await db('audit').insert({ event: 'crm_campaign', user_id: req.user.id, detail: `${name}: ${sent} sent, ${failed} failed, ${skipped} skipped` });
  flash(req, failed ? 'warn' : 'success', `"${name}": ${sent} sent${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped (no consent or no number/email)` : ''}.${!config.smsEnabled && channel !== 'email' ? ' SMS are recorded as tests until the Termii key is added.' : ''}`);
  res.redirect('/admin/messages');
});

router.post('/admin/templates', need('messages'), async (req, res) => {
  const row = { name: clean(req.body.name, 120), channel: ['sms', 'email', 'whatsapp'].includes(req.body.channel) ? req.body.channel : 'sms', subject: clean(req.body.subject, 200) || null, body: String(req.body.body || '').trim().slice(0, 2000) };
  if (!row.name || !row.body) { flash(req, 'warn', 'A template needs a name and a message.'); return back(req, res, '/admin/messages'); }
  if (req.body.id) await db('crm_templates').where({ id: Number(req.body.id) }).update({ ...row, updated_at: new Date() });
  else await db('crm_templates').insert(row);
  flash(req, 'success', 'Template saved.');
  res.redirect('/admin/messages#templates');
});
router.post('/admin/templates/:id/delete', need('bulk'), async (req, res) => {
  await db('crm_templates').where({ id: Number(req.params.id) }).del();
  res.redirect('/admin/messages#templates');
});

// ---------- birthdays and special days ----------
router.get('/admin/occasions', need('occasions'), async (req, res) => {
  const occasions = await db('crm_occasions').orderBy([{ column: 'is_birthday', order: 'desc' }, { column: 'date' }]);
  const now = new Date();
  const next30 = [];
  for (let i = 0; i < 30; i++) { const x = addDays(now, i); next30.push(`${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`); }
  const birthdays = await db('crm_contacts').whereIn('birthday', next30).select('id', 'name', 'company', 'birthday', 'phone', 'email', 'sms_ok', 'email_ok').limit(200);
  birthdays.sort((a, b) => next30.indexOf(a.birthday) - next30.indexOf(b.birthday));
  page(res, 'occasions', 'Birthdays & special days', {
    section: 'crm', intro: 'Greetings go out at 8am Lagos time on the day, only to contacts who agreed to messages. Turn on "Send automatically" for each one you want.',
    occasions, birthdays, withBirthday: await count(db('crm_contacts').whereNotNull('birthday')), smsEnabled: config.smsEnabled,
  });
});
router.post('/admin/occasions', need('occasions'), async (req, res) => {
  const row = {
    name: clean(req.body.name, 120), date: mmdd(req.body.date), channel: ['sms', 'email', 'both'].includes(req.body.channel) ? req.body.channel : 'sms',
    subject: clean(req.body.subject, 200) || null, body: String(req.body.body || '').trim().slice(0, 1000), auto: req.body.auto === 'on',
    audience: ['all', 'customers', 'leads'].includes(req.body.audience) ? req.body.audience : 'all',
  };
  const id = Number(req.body.id);
  const existing = id ? await db('crm_occasions').where({ id }).first() : null;
  if (existing && existing.is_birthday) row.date = null;
  if (!row.body || (!existing && (!row.name || !row.date))) { flash(req, 'warn', 'A special day needs a name, a date and a message.'); return res.redirect('/admin/occasions'); }
  if (existing) await db('crm_occasions').where({ id }).update({ ...row, name: row.name || existing.name, updated_at: new Date() });
  else await db('crm_occasions').insert(row);
  flash(req, 'success', 'Saved.');
  res.redirect('/admin/occasions');
});
router.post('/admin/occasions/:id/delete', need('bulk'), async (req, res) => {
  await db('crm_occasions').where({ id: Number(req.params.id), is_birthday: false }).del();
  res.redirect('/admin/occasions');
});

// ---------- enquiries (raw form submissions) ----------
router.get('/admin/enquiries', need('enquiries'), async (req, res) => {
  await crm.syncAll().catch(() => {});
  const rows = await db('enquiries').leftJoin('crm_contacts', 'crm_contacts.enquiry_id', 'enquiries.id').select('enquiries.*', 'crm_contacts.id as contact_id').orderBy('enquiries.id', 'desc').limit(300);
  page(res, 'enquiries', 'Enquiries', { section: 'crm', intro: 'Every "Talk to us" and Enterprise form. Each one is already a contact with a deal in the pipeline.', rows });
});

// ---------- money ----------
router.get('/admin/revenue', need('money'), async (req, res) => {
  const pays = await db('payments').where({ status: 'success' }).select('amount_naira', 'kind', 'paid_at', 'is_demo');
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-GB', { month: 'short' }), total: 0 }); }
  const byKind = {};
  let thisMonth = 0; let thisYear = 0; let all = 0;
  for (const p of pays) {
    const t = new Date(p.paid_at || now);
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
    const m = months.find((x) => x.key === key); if (m) m.total += p.amount_naira;
    byKind[p.kind] = (byKind[p.kind] || 0) + p.amount_naira;
    all += p.amount_naira;
    if (t.getFullYear() === now.getFullYear()) thisYear += p.amount_naira;
    if (key === months[11].key) thisMonth += p.amount_naira;
  }
  const deals = await db('crm_deals').where({ stage: 'won' }).select('product').sum({ v: 'value_naira' }).count({ n: '*' }).groupBy('product');
  const forecast = await db('crm_deals').whereNotIn('stage', ['won', 'lost']).whereNotNull('expected_month').select('expected_month').sum({ v: 'value_naira' }).groupBy('expected_month').orderBy('expected_month');
  page(res, 'revenue', 'Revenue', {
    section: 'biz', intro: 'Money received through Paystack, plus deals won and expected.', months, byKind, thisMonth, thisYear, all, deals, forecast,
    founding: await foundingAvailable(),
  });
});

router.get('/admin/renewals', need('money'), async (req, res) => {
  const now = new Date();
  const withContact = async (rows) => {
    const ids = rows.map((u) => u.id);
    const map = ids.length ? Object.fromEntries((await db('crm_contacts').whereIn('user_id', ids).select('id', 'user_id', 'phone')).map((c) => [c.user_id, c])) : {};
    return rows.map((u) => ({ ...u, contact: map[u.id] }));
  };
  page(res, 'renewals', 'Renewals & trials', {
    section: 'biz', intro: 'Who renews soon, who did not renew, and which trials need a nudge.',
    r30: await withContact(await db('users').whereIn('plan', ['pro', 'team']).whereBetween('plan_expires_at', [now, addDays(now, 30)]).orderBy('plan_expires_at')),
    r90: await withContact(await db('users').whereIn('plan', ['pro', 'team']).whereBetween('plan_expires_at', [addDays(now, 30), addDays(now, 90)]).orderBy('plan_expires_at')),
    lapsed: await withContact(await db('users').whereIn('plan', ['pro', 'team']).whereBetween('plan_expires_at', [addDays(now, -60), now]).orderBy('plan_expires_at', 'desc')),
    trials: await withContact(await db('users').where('trial_ends_at', '>', now).where((w) => w.whereNull('plan_expires_at').orWhere('plan_expires_at', '<', now)).orderBy('trial_ends_at').limit(300)),
    converted: await count(db('users').whereNotNull('trial_ends_at').whereIn('plan', ['pro', 'team'])),
    endedUnpaid: await count(db('users').where('trial_ends_at', '<', now).where((w) => w.where('plan', 'free').orWhereNull('plan_expires_at'))),
  });
});

router.get('/admin/payments', need('money'), async (req, res) => {
  const payments = await db('payments').leftJoin('users', 'payments.user_id', 'users.id').select('payments.*', 'users.email').orderBy('payments.id', 'desc').limit(500);
  page(res, 'payments', 'Payments', { section: 'biz', intro: 'Every Paystack payment. Pending ones were started but not finished.', payments });
});

// ---------- NFC orders ----------
const NFC_STAGES = [['new', 'Paid / new'], ['printing', 'Printing & programming'], ['ready', 'Ready'], ['dispatched', 'Out for delivery'], ['delivered', 'Delivered']];
router.get('/admin/nfc', need('nfc'), async (req, res) => {
  const orders = await db('nfc_orders').leftJoin('users', 'nfc_orders.user_id', 'users.id').leftJoin('teams', 'nfc_orders.team_id', 'teams.id').select('nfc_orders.*', 'users.email', 'teams.name as team_name').orderBy('nfc_orders.id', 'desc').limit(500);
  const batches = await db('nfc_tags').select('batch').count({ total: '*' }).count({ claimed: 'card_id' }).groupBy('batch').orderBy('batch', 'desc');
  page(res, 'nfc', 'NFC card orders', { section: 'biz', intro: 'Move each order along as it is printed, packed and delivered. The customer gets an email at each step.', orders, batches, stages: NFC_STAGES });
});
router.post('/admin/nfc/orders/:id', need('nfc'), async (req, res) => {
  const o = await db('nfc_orders').where({ id: Number(req.params.id) }).first();
  const status = NFC_STAGES.some((s) => s[0] === req.body.status) ? req.body.status : null;
  if (o && status && status !== o.status) {
    await db('nfc_orders').where({ id: o.id }).update({ status, notes: clean(req.body.notes, 500) || o.notes, updated_at: new Date() });
    const u = await db('users').where({ id: o.user_id }).first();
    const text = { printing: 'is being printed and programmed', ready: 'is ready and will be sent out shortly', dispatched: 'is on its way to you', delivered: 'has been delivered' }[status];
    if (u && text && !o.is_demo) {
      await mailer.send({ to: u.email, subject: `Your HollaTap card ${text}`, title: 'Your HollaTap tap card', html: `<p>Your order of ${o.quantity} HollaTap card${o.quantity > 1 ? 's' : ''} ${text}.</p>${status === 'delivered' ? `<p>Tap it on the back of any phone to test it, then link it to your card from your <a href="${config.baseUrl}/dashboard" style="color:#C2410C">dashboard</a>.</p>` : ''}`, text: `Your HollaTap card ${text}.` }).catch(() => {});
    }
    const cc = u ? await db('crm_contacts').where({ user_id: u.id }).first() : null;
    if (cc) await crm.log(cc.id, req.user.id, 'system', `NFC order #${o.id}: ${crm.label(NFC_STAGES, status)}`);
  } else if (o && req.body.notes !== undefined) {
    await db('nfc_orders').where({ id: o.id }).update({ notes: clean(req.body.notes, 500), updated_at: new Date() });
  }
  back(req, res, '/admin/nfc');
});
router.get('/admin/nfc/orders/:id/label', need('nfc'), async (req, res) => {
  const o = await db('nfc_orders').leftJoin('users', 'nfc_orders.user_id', 'users.id').where('nfc_orders.id', Number(req.params.id)).select('nfc_orders.*', 'users.email').first();
  if (!o) return res.sendStatus(404);
  res.render('portal/nfc-label', { o, title: `Delivery note #${o.id}` });
});
router.post('/admin/nfc/batch', need('settings'), async (req, res) => {
  const qty = Math.max(1, Math.min(10000, parseInt(req.body.qty, 10) || 0));
  const batch = clean(req.body.batch, 40) || `B${new Date().toISOString().slice(0, 10)}`;
  const rows = []; const seen = new Set();
  while (rows.length < qty) { const code = randomCode(7); if (seen.has(code)) continue; seen.add(code); rows.push({ code, batch }); }
  for (let i = 0; i < rows.length; i += 500) await db('nfc_tags').insert(rows.slice(i, i + 500)).onConflict('code').ignore();
  res.redirect(`/admin/nfc/batch/${encodeURIComponent(batch)}.csv`);
});
router.get('/admin/nfc/batch/:batch.csv', need('nfc'), async (req, res) => {
  const tags = await db('nfc_tags').where({ batch: req.params.batch }).orderBy('id');
  const lines = ['serial,url'].concat(tags.map((t) => `${t.code},${config.baseUrl}/t/${t.code}`));
  res.setHeader('Content-Disposition', `attachment; filename="hollatap-nfc-${req.params.batch}.csv"`);
  res.type('text/csv').send(lines.join('\r\n'));
});

// ---------- affiliates ----------
router.get('/admin/affiliates', need('affiliates'), async (req, res) => {
  const affs = await db('users').where({ is_affiliate: true }).select('id', 'email', 'name', 'ref_code', 'affiliate_bank', 'created_at');
  const stats = [];
  for (const a of affs) {
    const referred = await count(db('users').where({ referred_by: a.id }));
    const paidRef = await count(db('users').where({ referred_by: a.id }).whereIn('plan', ['pro', 'team']));
    const c = await db('commissions').where({ affiliate_id: a.id }).select('status').sum({ s: 'amount_naira' }).groupBy('status');
    const by = Object.fromEntries(c.map((x) => [x.status, Number(x.s || 0)]));
    stats.push({ ...a, referred, paidRef, pending: by.pending || 0, payable: by.payable || 0, paid: by.paid || 0 });
  }
  stats.sort((x, y) => y.paidRef - x.paidRef || y.referred - x.referred);
  const payouts = await db('commissions').leftJoin('users', 'commissions.affiliate_id', 'users.id').where('commissions.status', 'payable')
    .select('commissions.affiliate_id', 'users.email', 'users.affiliate_bank').sum({ total: 'commissions.amount_naira' }).count({ n: '*' }).groupBy('commissions.affiliate_id', 'users.email', 'users.affiliate_bank');
  const rows = await db('commissions').leftJoin('users', 'commissions.affiliate_id', 'users.id').select('commissions.*', 'users.email').orderBy('commissions.id', 'desc').limit(300);
  page(res, 'affiliates', 'Affiliates & payouts', { section: 'biz', intro: 'Referrals, commission owed and payouts. Commission becomes payable after the 30-day refund window.', stats, payouts, rows, minPayout: config.pricing.minPayout });
});
router.post('/admin/affiliates/:id/payout', need('affiliates'), async (req, res) => {
  const id = Number(req.params.id);
  const total = await sum(db('commissions').where({ affiliate_id: id, status: 'payable' }), 'amount_naira');
  if (total < config.pricing.minPayout) { flash(req, 'warn', `Below the ${naira(config.pricing.minPayout)} minimum payout.`); return res.redirect('/admin/affiliates'); }
  await db('commissions').where({ affiliate_id: id, status: 'payable' }).update({ status: 'paid', paid_at: new Date(), updated_at: new Date() });
  await db('audit').insert({ event: 'affiliate_payout', user_id: req.user.id, detail: `affiliate ${id} ${naira(total)}` });
  flash(req, 'success', `${naira(total)} marked as paid. Make the bank transfer if you haven't yet.`);
  res.redirect('/admin/affiliates');
});
router.post('/admin/commissions/:id/void', need('affiliates'), async (req, res) => {
  await db('commissions').where({ id: Number(req.params.id) }).whereIn('status', ['pending', 'payable']).update({ status: 'void', updated_at: new Date() });
  res.redirect('/admin/affiliates');
});

// ---------- accounts and promos (owner) ----------
router.get('/admin/users', need('users'), async (req, res) => {
  const q = clean(req.query.q, 120);
  let query = db('users').leftJoin('crm_contacts', 'users.id', 'crm_contacts.user_id').select('users.*', 'crm_contacts.id as contact_id').orderBy('users.id', 'desc').limit(300);
  if (q) query = query.where('users.email', 'like', `%${q.toLowerCase()}%`);
  page(res, 'users', 'All accounts', { section: 'biz', intro: 'Every HollaTap account. Open one to see its CRM record.', users: await query, q });
});
router.get('/admin/promos', need('promos'), async (req, res) => {
  page(res, 'promos', 'Card promotions', { section: 'biz', intro: 'The Rhinowinks offers shown to card owners, by industry.', promos: await db('promos').orderBy('id'), industries: INDUSTRIES, error: null });
});
router.post('/admin/promos', need('promos'), async (req, res) => {
  const row = {
    title: clean(req.body.title, 120), body: clean(req.body.body, 300), cta: clean(req.body.cta, 40) || 'Learn more', url: cleanUrl(req.body.url),
    industry: INDUSTRIES.includes(req.body.industry) ? req.body.industry : null, slot: ['any', 'created', 'dashboard'].includes(req.body.slot) ? req.body.slot : 'any', active: req.body.active === 'on',
  };
  if (!row.title || !row.url) { flash(req, 'warn', 'Title and a valid link are required.'); return res.redirect('/admin/promos'); }
  if (req.body.id) await db('promos').where({ id: req.body.id }).update({ ...row, updated_at: new Date() });
  else await db('promos').insert(row);
  res.redirect('/admin/promos');
});
router.post('/admin/promos/:id/delete', need('promos'), async (req, res) => {
  await db('promos').where({ id: req.params.id }).del();
  res.redirect('/admin/promos');
});

// ---------- reports ----------
router.get('/admin/reports', need('reports'), async (req, res) => {
  const d = days(req);
  const since = new Date(Date.now() - d * 864e5);
  const users = await count(db('users').where('created_at', '>=', since));
  const withCard = await count(db('users').where('created_at', '>=', since).whereIn('id', db('cards').select('user_id')));
  const paid = await count(db('users').where('created_at', '>=', since).whereIn('id', db('payments').where({ status: 'success' }).select('user_id')));
  const group = async (col) => db('crm_contacts').where('created_at', '>=', since).select(col).count({ n: '*' }).groupBy(col).orderBy('n', 'desc').limit(12);
  const staff = await staffList();
  const perStaff = [];
  for (const s of staff) {
    perStaff.push({
      name: staffName(s),
      activities: await count(db('crm_activities').where({ staff_id: s.id }).where('created_at', '>=', since).whereNotIn('type', ['system', 'stage'])),
      contacts: await count(db('crm_contacts').where({ owner_id: s.id })),
      won: await count(db('crm_deals').where({ owner_id: s.id, stage: 'won' }).where('closed_at', '>=', since)),
      wonValue: await sum(db('crm_deals').where({ owner_id: s.id, stage: 'won' }).where('closed_at', '>=', since), 'value_naira'),
    });
  }
  const lost = await db('crm_deals').where({ stage: 'lost' }).where('closed_at', '>=', since).select('lost_reason').count({ n: '*' }).groupBy('lost_reason').orderBy('n', 'desc');
  page(res, 'reports', 'Reports', {
    section: 'biz', intro: 'Where people come from, where they drop off, and how the team is doing.', d,
    funnel: [['Signed up', users], ['Made a card', withCard], ['Paid', paid]],
    bySource: await group('source'), byIndustry: await group('industry'), byCity: await group('city'), perStaff, lost,
  });
});

// ---------- staff ----------
router.get('/admin/staff', need('staff'), async (req, res) => {
  page(res, 'staff', 'Staff & roles', { section: 'staff', intro: 'Who can use the Team Portal. Staff log in at hollatap.com/login with their email; they get a code by email each time.', staff: await staffList() });
});
router.post('/admin/staff', need('staff'), async (req, res) => {
  const email = cleanEmail(req.body.email);
  const role = ['owner', 'sales', 'support'].includes(req.body.role) ? req.body.role : 'sales';
  if (!email) { flash(req, 'warn', 'Type the staff member\'s email.'); return res.redirect('/admin/staff'); }
  let u = await db('users').where({ email }).first();
  if (!u) {
    let ref; do ref = randomCode(6); while (await db('users').where({ ref_code: ref }).first());
    await db('users').insert({ email, name: clean(req.body.name, 120) || null, ref_code: ref, last_seen_at: new Date() });
    u = await db('users').where({ email }).first();
  } else if (clean(req.body.name, 120)) await db('users').where({ id: u.id }).update({ name: clean(req.body.name, 120) });
  await db('users').where({ id: u.id }).update({ staff_role: role, updated_at: new Date() });
  await db('audit').insert({ event: 'staff_added', user_id: req.user.id, detail: `${email} as ${role}` });
  await mailer.send({ to: email, subject: 'You have access to the HollaTap Team Portal', title: 'Welcome to the team', html: `<p>You now have <b>${role}</b> access to the HollaTap Team Portal.</p><p>Log in at <a href="${config.baseUrl}/login" style="color:#C2410C">hollatap.com/login</a> with this email. We'll send you a 6-digit code. Then open <a href="${config.baseUrl}/admin" style="color:#C2410C">the Team Portal</a>.</p>`, text: `You now have ${role} access to the HollaTap Team Portal: ${config.baseUrl}/admin` }).catch(() => {});
  flash(req, 'success', `${email} can now use the Team Portal as ${role}.`);
  res.redirect('/admin/staff');
});
router.post('/admin/staff/:id', need('staff'), async (req, res) => {
  const u = await db('users').where({ id: Number(req.params.id) }).first();
  if (!u) return res.redirect('/admin/staff');
  if (u.id === req.user.id) { flash(req, 'warn', 'You can\'t change your own access.'); return res.redirect('/admin/staff'); }
  if (u.is_admin || config.adminEmails.includes(u.email)) { flash(req, 'warn', 'Main owner accounts are set on the server (ADMIN_EMAILS) and can\'t be changed here.'); return res.redirect('/admin/staff'); }
  const role = ['owner', 'sales', 'support'].includes(req.body.role) ? req.body.role : null;
  await db('users').where({ id: u.id }).update({ staff_role: req.body.remove === '1' ? null : role, updated_at: new Date() });
  if (req.body.remove === '1') await db('crm_contacts').where({ owner_id: u.id }).update({ owner_id: null });
  await db('audit').insert({ event: req.body.remove === '1' ? 'staff_removed' : 'staff_role', user_id: req.user.id, detail: `${u.email} ${req.body.remove === '1' ? 'removed' : role}` });
  flash(req, 'success', req.body.remove === '1' ? `${u.email} no longer has access. Their contacts are now unassigned.` : `${u.email} is now ${role}.`);
  res.redirect('/admin/staff');
});

router.get('/admin/audit', need('staff'), async (req, res) => {
  const audit = await db('audit').leftJoin('users', 'audit.user_id', 'users.id').select('audit.*', 'users.email').orderBy('audit.id', 'desc').limit(300);
  const acts = await db('crm_activities').leftJoin('users', 'crm_activities.staff_id', 'users.id').leftJoin('crm_contacts', 'crm_activities.contact_id', 'crm_contacts.id')
    .whereNotNull('crm_activities.staff_id').select('crm_activities.*', 'users.email', 'crm_contacts.name as contact_name').orderBy('crm_activities.id', 'desc').limit(300);
  page(res, 'audit', 'Activity log', { section: 'staff', intro: 'Who did what, and when.', audit, acts });
});

// ---------- settings and demo data ----------
router.get('/admin/settings', need('settings'), async (req, res) => {
  page(res, 'settings', 'Settings & demo data', {
    section: 'staff', intro: 'Connections, and the demo data used for testing before launch.',
    demoCounts: {
      contacts: await count(db('crm_contacts').where({ is_demo: true })), deals: await count(db('crm_deals').where({ is_demo: true })),
      users: await count(db('users').where({ is_demo: true })), payments: await count(db('payments').where({ is_demo: true })),
    },
    smsEnabled: config.smsEnabled, mailEnabled: config.mailEnabled, googleEnabled: config.googleEnabled, paymentsEnabled: config.paymentsEnabled,
    termii: { sender: config.termii.senderId, base: config.termii.baseUrl },
  });
});
router.post('/admin/settings/test-sms', need('settings'), async (req, res) => {
  const r = await require('../lib/sms').sendOne(req.body.phone, 'HollaTap test: your Termii SMS connection works.');
  flash(req, r.status === 'sent' ? 'success' : r.status === 'simulated' ? 'warn' : 'error', r.status === 'sent' ? `Test SMS sent to ${r.to}.` : r.status === 'simulated' ? 'No Termii key yet, so nothing was sent.' : `Termii said: ${r.error}`);
  res.redirect('/admin/settings');
});
router.post('/admin/demo/load', need('demo'), async (req, res) => {
  const n = await demo.load(req.user.id);
  await db('audit').insert({ event: 'demo_load', user_id: req.user.id, detail: JSON.stringify(n) });
  flash(req, 'success', `Demo data loaded: ${n.contacts} contacts, ${n.deals} deals, ${n.users} accounts, ${n.payments} payments. Clear it before launch.`);
  res.redirect('/admin');
});
router.post('/admin/demo/clear', need('demo'), async (req, res) => {
  if (req.body.confirm !== 'CLEAR') { flash(req, 'warn', 'Type CLEAR to confirm.'); return res.redirect('/admin/settings'); }
  const n = await demo.clear();
  await db('audit').insert({ event: 'demo_clear', user_id: req.user.id, detail: JSON.stringify(n) });
  flash(req, 'success', 'All demo data has been removed. Real data was not touched.');
  res.redirect('/admin/settings');
});

module.exports = router;
