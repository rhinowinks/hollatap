// Team Portal CRM helpers: who can do what, keeping contacts in step with sign-ups and enquiries,
// logging activity, segments and sending SMS / email to contacts.
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const mailer = require('./mailer');
const sms = require('./sms');

const CONTACT_STAGES = [
  ['new', 'New'], ['contacted', 'Contacted'], ['warm', 'Interested'], ['customer', 'Customer'], ['lost', 'Not now'],
];
const DEAL_STAGES = [
  ['new', 'New'], ['contacted', 'Contacted'], ['demo', 'Meeting / demo'], ['proposal', 'Proposal sent'], ['won', 'Won'], ['lost', 'Lost'],
];
const PRODUCTS = ['HollaTap Pro', 'HollaTap Teams', 'HollaTap Enterprise', 'NFC cards', 'AI Agents & Trainings', 'rhinoRETAIL', 'RhinoVMS', 'rhinoEVENTS', 'Website'];
const SOURCES = [
  ['signup', 'Website sign-up'], ['enquiry', 'Enquiry form'], ['enterprise', 'Enterprise quote'], ['manual', 'Added by staff'],
  ['import', 'Imported'], ['ads', 'Ads'], ['whatsapp', 'WhatsApp'], ['referral', 'Referral / affiliate'], ['event', 'Event'],
];
const ACTIVITY_TYPES = [
  ['call', 'Call'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['sms', 'SMS'], ['visit', 'Visit'], ['meeting', 'Meeting'], ['social', 'Social DM'], ['note', 'Note'],
];
const LOST_REASONS = ['Price', 'Timing', 'Chose a competitor', 'No budget', 'No reply', 'Not a fit', 'Other'];
const label = (list, key) => (list.find((x) => x[0] === key) || [key, key])[1];

// ---------- roles ----------
function roleOf(user) {
  if (!user) return null;
  if (user.is_admin || config.adminEmails.includes(user.email)) return 'owner';
  return ['owner', 'sales', 'support'].includes(user.staff_role) ? user.staff_role : null;
}
const CAN = {
  owner: ['dashboard', 'contacts', 'pipeline', 'tasks', 'messages', 'bulk', 'occasions', 'money', 'nfc', 'affiliates', 'staff', 'reports', 'settings', 'demo', 'users', 'promos', 'enquiries'],
  sales: ['dashboard', 'contacts', 'pipeline', 'tasks', 'messages', 'occasions', 'nfc', 'enquiries'],
  support: ['dashboard', 'contacts', 'tasks', 'messages', 'nfc'],
};
const can = (user, what) => { const r = roleOf(user); return !!(r && CAN[r].includes(what)); };

// ---------- keep contacts in step with the rest of HollaTap ----------
async function upsertFromUser(u, conn = db) {
  const existing = await conn('crm_contacts').where({ user_id: u.id }).first();
  const paid = (u.plan === 'pro' || u.plan === 'team') && u.plan_expires_at && new Date(u.plan_expires_at) > new Date();
  if (existing) {
    const patch = { email: u.email, updated_at: new Date() };
    if (paid && existing.stage !== 'customer') patch.stage = 'customer';
    if (u.marketing_opt_in && !existing.email_ok) patch.email_ok = true;
    if (u.industry && !existing.industry) patch.industry = u.industry;
    await conn('crm_contacts').where({ id: existing.id }).update(patch);
    return existing.id;
  }
  const [row] = await conn('crm_contacts').insert({
    user_id: u.id, name: u.name || u.email.split('@')[0], email: u.email, industry: u.industry || null,
    source: u.referred_by ? 'referral' : 'signup', stage: paid ? 'customer' : 'new',
    email_ok: !!u.marketing_opt_in, sms_ok: false, is_demo: !!u.is_demo,
  }).returning('id');
  return typeof row === 'object' ? row.id : row;
}

async function upsertFromEnquiry(e, conn = db) {
  if (await conn('crm_contacts').where({ enquiry_id: e.id }).first()) return null;
  let c = e.email ? await conn('crm_contacts').where({ email: e.email.toLowerCase() }).first() : null;
  const enterprise = /enterprise/i.test(e.product);
  if (!c) {
    const [row] = await conn('crm_contacts').insert({
      enquiry_id: e.id, name: e.name, company: e.company || null, email: (e.email || '').toLowerCase() || null, phone: e.phone || null,
      source: enterprise ? 'enterprise' : 'enquiry', stage: 'new', is_demo: !!e.is_demo,
    }).returning('id');
    c = { id: typeof row === 'object' ? row.id : row };
  } else {
    await conn('crm_contacts').where({ id: c.id }).update({ enquiry_id: e.id, phone: c.phone || e.phone || null, company: c.company || e.company || null, updated_at: new Date() });
  }
  const product = enterprise ? 'HollaTap Enterprise' : (PRODUCTS.find((p) => p.toLowerCase() === String(e.product).toLowerCase()) || e.product);
  await conn('crm_deals').insert({ contact_id: c.id, title: `${e.company || e.name}: ${product}`, product, value_naira: 0, stage: 'new', is_demo: !!e.is_demo });
  await conn('crm_activities').insert({ contact_id: c.id, type: 'system', summary: `Enquiry about ${e.product}: ${e.message || '(no message)'}`, is_demo: !!e.is_demo });
  return c.id;
}

// Cheap catch-up: any user or enquiry not yet in the CRM gets added.
async function syncAll() {
  const users = await db('users').leftJoin('crm_contacts', 'users.id', 'crm_contacts.user_id').whereNull('crm_contacts.id').select('users.*').limit(5000);
  for (const u of users) await upsertFromUser(u);
  const paidUsers = await db('users').whereIn('plan', ['pro', 'team']).where('plan_expires_at', '>', new Date()).select('id');
  if (paidUsers.length) await db('crm_contacts').whereIn('user_id', paidUsers.map((u) => u.id)).whereNot('stage', 'customer').update({ stage: 'customer' });
  const enq = await db('enquiries').whereNotIn('id', db('crm_contacts').whereNotNull('enquiry_id').select('enquiry_id')).limit(2000);
  for (const e of enq) await upsertFromEnquiry(e);
}

async function log(contactId, staffId, type, summary, extra = {}) {
  await db('crm_activities').insert({ contact_id: contactId, staff_id: staffId || null, type, summary: String(summary || '').slice(0, 4000), ...extra });
  if (contactId && !['system', 'stage', 'note'].includes(type)) {
    await db('crm_contacts').where({ id: contactId }).update({ last_contacted_at: new Date(), updated_at: new Date() });
    await db('crm_contacts').where({ id: contactId, stage: 'new' }).update({ stage: 'contacted' });
  }
}

// ---------- segments ----------
// A segment is a set of filters shared by the contacts list, exports and bulk messages.
function applySegment(q, s = {}) {
  if (s.q) {
    const like = `%${String(s.q).toLowerCase()}%`;
    q.where((w) => w.whereRaw('lower(crm_contacts.name) like ?', [like]).orWhereRaw('lower(crm_contacts.email) like ?', [like])
      .orWhereRaw('lower(coalesce(crm_contacts.company, \'\')) like ?', [like]).orWhere('crm_contacts.phone', 'like', `%${String(s.q).replace(/\D/g, '') || '@@'}%`));
  }
  if (s.stage) q.where('crm_contacts.stage', s.stage);
  if (s.source) q.where('crm_contacts.source', s.source);
  if (s.industry) q.where('crm_contacts.industry', s.industry);
  if (s.owner === 'none') q.whereNull('crm_contacts.owner_id');
  else if (s.owner) q.where('crm_contacts.owner_id', Number(s.owner));
  if (s.tag) q.whereRaw("(',' || lower(crm_contacts.tags) || ',') like ?", [`%,${String(s.tag).toLowerCase().trim()},%`]);
  if (s.city) q.whereRaw('lower(coalesce(crm_contacts.city, \'\')) = ?', [String(s.city).toLowerCase()]);
  if (s.plan) q.whereIn('crm_contacts.user_id', planSubquery(s.plan));
  if (s.since) q.where('crm_contacts.created_at', '>=', new Date(Date.now() - Number(s.since) * 864e5));
  if (s.quiet) q.where((w) => w.whereNull('crm_contacts.last_contacted_at').orWhere('crm_contacts.last_contacted_at', '<', new Date(Date.now() - Number(s.quiet) * 864e5)));
  if (s.demo === 'only') q.where('crm_contacts.is_demo', true);
  return q;
}
function planSubquery(plan) {
  const now = new Date();
  const q = db('users').select('id');
  if (plan === 'trial') q.where('trial_ends_at', '>', now).where((w) => w.whereNull('plan_expires_at').orWhere('plan_expires_at', '<', now));
  else if (plan === 'paid') q.whereIn('plan', ['pro', 'team']).where('plan_expires_at', '>', now);
  else if (plan === 'free') q.where((w) => w.where('plan', 'free').orWhere('plan_expires_at', '<', now)).where((w) => w.whereNull('trial_ends_at').orWhere('trial_ends_at', '<', now));
  else if (plan === 'founding') q.where({ founding_member: true });
  else if (plan === 'affiliate') q.where({ is_affiliate: true });
  return q;
}
const SEGMENT_KEYS = ['q', 'stage', 'source', 'industry', 'owner', 'tag', 'city', 'plan', 'since', 'quiet'];
const segmentFrom = (src) => Object.fromEntries(SEGMENT_KEYS.filter((k) => src[k]).map((k) => [k, String(src[k]).slice(0, 80)]));

// ---------- messages ----------
function fill(text, c) {
  const first = String(c.name || '').trim().split(/\s+/)[0] || 'there';
  return String(text || '')
    .replace(/\{first_name\}/g, first).replace(/\{name\}/g, c.name || '')
    .replace(/\{company\}/g, c.company || 'your company').replace(/\{year\}/g, String(new Date().getFullYear()));
}
const unsubToken = (id) => crypto.createHmac('sha256', config.sessionSecret).update(`unsub:${id}`).digest('hex').slice(0, 24);

async function sendToContact(contact, { channel, subject, body, staffId, kind = 'manual', campaignId = null, marketing = false }) {
  const out = [];
  const isDemo = !!contact.is_demo;
  if (channel === 'sms' || channel === 'both') {
    if (marketing && !contact.sms_ok) out.push({ channel: 'sms', status: 'skipped' });
    else if (!contact.phone) out.push({ channel: 'sms', status: 'skipped' });
    else {
      const text = fill(body, contact);
      const r = isDemo ? { status: 'simulated', to: sms.intl(contact.phone) || contact.phone } : await sms.sendOne(contact.phone, text, marketing ? 'generic' : 'dnd');
      await db('crm_messages').insert({ channel: 'sms', to: r.to || contact.phone, contact_id: contact.id, campaign_id: campaignId, staff_id: staffId || null, body: text, kind, status: r.status, provider_ref: r.ref || null, error: r.error || null, is_demo: isDemo });
      out.push({ channel: 'sms', ...r });
    }
  }
  if (channel === 'email' || channel === 'both') {
    if (marketing && !contact.email_ok) out.push({ channel: 'email', status: 'skipped' });
    else if (!contact.email) out.push({ channel: 'email', status: 'skipped' });
    else {
      const text = fill(body, contact);
      const subj = fill(subject || 'A message from HollaTap', contact);
      const unsub = marketing ? `<p style="font-size:12px;color:#5B6573;margin-top:24px">Don't want these emails? <a href="${config.baseUrl}/unsubscribe/${contact.id}/${unsubToken(contact.id)}">Unsubscribe</a>.</p>` : '';
      const html = text.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('') + unsub;
      let status = 'sent'; let error = null;
      if (isDemo) status = 'simulated';
      else {
        try { await mailer.send({ to: contact.email, subject: subj, title: subj, html, text }); if (!config.mailEnabled) status = 'simulated'; } catch (e) { status = 'failed'; error = String(e.message).slice(0, 300); }
      }
      await db('crm_messages').insert({ channel: 'email', to: contact.email, contact_id: contact.id, campaign_id: campaignId, staff_id: staffId || null, subject: subj, body: text, kind, status, error, is_demo: isDemo });
      out.push({ channel: 'email', status, error });
    }
  }
  const sent = out.filter((o) => ['sent', 'simulated'].includes(o.status));
  if (sent.length) await log(contact.id, staffId, sent[0].channel, `${sent.map((o) => o.channel.toUpperCase()).join(' + ')}${kind !== 'manual' ? ` (${kind})` : ''}: ${fill(subject || body, contact).slice(0, 140)}`);
  return out;
}

async function getSetting(key, fallback = null) {
  const r = await db('crm_settings').where({ key }).first();
  return r ? r.value : fallback;
}
async function setSetting(key, value) {
  const exists = await db('crm_settings').where({ key }).first();
  if (exists) await db('crm_settings').where({ key }).update({ value: String(value) });
  else await db('crm_settings').insert({ key, value: String(value) });
}

// Default occasions and templates (added once).
const NATIONAL_DAYS = [
  ['01-01', "New Year's Day", 'Happy New Year, {first_name}! Wishing you and {company} a great {year}. From all of us at HollaTap.'],
  ['02-14', "Valentine's Day", "Happy Valentine's Day, {first_name}! Spread some love today. From HollaTap."],
  ['05-01', "Workers' Day", "Happy Workers' Day, {first_name}! Thank you for all the hard work. From HollaTap."],
  ['05-27', "Children's Day", "Happy Children's Day, {first_name}! From all of us at HollaTap."],
  ['06-12', 'Democracy Day', 'Happy Democracy Day, {first_name}! From all of us at HollaTap.'],
  ['10-01', 'Independence Day', 'Happy Independence Day, {first_name}! Proudly Nigerian, proudly made in Lagos. From HollaTap.'],
  ['12-25', 'Christmas Day', 'Merry Christmas, {first_name}! Wishing you joy and rest. From all of us at HollaTap.'],
  ['12-26', 'Boxing Day', 'Happy Boxing Day, {first_name}! Enjoy the holiday. From HollaTap.'],
];
const DEFAULT_TEMPLATES = [
  ['Trial ending', 'sms', null, 'Hi {first_name}, your HollaTap Pro trial ends soon. Keep your extra cards and contacts: hollatap.com/upgrade'],
  ['Renewal due', 'email', 'Your HollaTap plan renews soon', 'Hi {first_name},\n\nYour HollaTap plan renews soon. Renew at hollatap.com/upgrade to keep your cards, statistics and contacts.\n\nThank you for using HollaTap.'],
  ['NFC card delivered', 'sms', null, 'Hi {first_name}, your HollaTap tap card has been delivered. Tap it on any phone to test it. Need help? Reply here.'],
  ['Enterprise follow-up', 'email', 'Your HollaTap Enterprise quote', 'Hi {first_name},\n\nThanks for your interest in HollaTap Enterprise for {company}. When is a good time for a 15-minute call to agree the card design and staff numbers?\n\nHollaTap team'],
  ['Nice meeting you', 'whatsapp', null, 'Hi {first_name}, great meeting you. Here is HollaTap, the digital business card we spoke about: hollatap.com'],
];
async function seedDefaults() {
  if (!(await db('crm_occasions').first())) {
    await db('crm_occasions').insert({ name: 'Birthday', is_birthday: true, channel: 'sms', body: 'Happy birthday, {first_name}! Wishing you a wonderful year ahead. From all of us at HollaTap.', auto: false, audience: 'all' });
    for (const [date, name, body] of NATIONAL_DAYS) await db('crm_occasions').insert({ name, date, channel: 'sms', body, auto: false, audience: 'all' });
  }
  if (!(await db('crm_templates').first())) {
    for (const [name, channel, subject, body] of DEFAULT_TEMPLATES) await db('crm_templates').insert({ name, channel, subject, body });
  }
}

// Runs from the hourly job: sends today's automatic birthday and national-day greetings once.
async function runOccasions(now = new Date()) {
  const lagos = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
  if (lagos.getHours() < 8) return 0; // send from 8am Lagos time
  const mmdd = `${String(lagos.getMonth() + 1).padStart(2, '0')}-${String(lagos.getDate()).padStart(2, '0')}`;
  const year = lagos.getFullYear();
  let sent = 0;
  const occ = await db('crm_occasions').where({ auto: true });
  for (const o of occ) {
    const stampKey = `occ_${o.id}_${year}${o.is_birthday ? `_${mmdd}` : ''}`;
    if (!o.is_birthday && o.date !== mmdd) continue;
    if (await getSetting(stampKey)) continue;
    await setSetting(stampKey, now.toISOString());
    const q = db('crm_contacts').where({ is_demo: false });
    if (o.is_birthday) q.where({ birthday: mmdd });
    if (o.audience === 'customers') q.where({ stage: 'customer' });
    if (o.audience === 'leads') q.whereNot({ stage: 'customer' });
    for (const c of await q) {
      const r = await sendToContact(c, { channel: o.channel, subject: o.subject || o.name, body: o.body, kind: o.is_birthday ? 'birthday' : 'occasion', marketing: true });
      sent += r.filter((x) => x.status === 'sent').length;
    }
    if (!o.is_birthday) await db('crm_occasions').where({ id: o.id }).update({ last_sent_year: year });
  }
  return sent;
}

module.exports = {
  CONTACT_STAGES, DEAL_STAGES, PRODUCTS, SOURCES, ACTIVITY_TYPES, LOST_REASONS, label,
  roleOf, can, upsertFromUser, upsertFromEnquiry, syncAll, log, applySegment, planSubquery, segmentFrom, SEGMENT_KEYS,
  fill, unsubToken, sendToContact, getSetting, setSetting, seedDefaults, runOccasions,
};
