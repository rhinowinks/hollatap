// Demo data for testing the Team Portal before launch. Every row is marked is_demo so it can be removed
// in one go without touching real data. Demo emails use example.com and messages to demo contacts are
// never really sent.
const { db } = require('../db');
const crm = require('./crm');
const { randomCode, addDays } = require('./util');

const FIRST = ['Adaeze', 'Tunde', 'Chika', 'Bola', 'Emeka', 'Ngozi', 'Ibrahim', 'Funmi', 'Seyi', 'Kemi', 'Uche', 'Halima', 'Femi', 'Amaka', 'Musa', 'Yemi', 'Ifeoma', 'Dayo', 'Zainab', 'Obinna', 'Tolu', 'Nkechi', 'Kunle', 'Aisha', 'Segun', 'Blessing', 'Chinedu', 'Folake', 'Sani', 'Ronke'];
const LAST = ['Okafor', 'Adeyemi', 'Eze', 'Bello', 'Nwosu', 'Balogun', 'Okonkwo', 'Ogunleye', 'Abubakar', 'Olawale', 'Obi', 'Ibekwe', 'Lawal', 'Danjuma', 'Afolabi', 'Chukwu', 'Usman', 'Adebayo', 'Mohammed', 'Onyeka'];
const COMPANIES = ['Lekki Logistics', 'Ikeja Realty', 'Glow Studio', 'Chika Phones', 'Mainland Foods', 'Coastline Energy', 'Bright Minds School', 'Harbour Clinic', 'Prime Gas Ltd', 'Unity Microfinance', 'Victoria Interiors', 'Abuja Events Co', 'Sunrise Hotels', 'Delta Oil Services', 'Grace Assembly', 'Kano Agro Mills', 'Yaba Tech Hub', 'Ocean Freight NG', 'Royal Tiles', 'Eko Pharmacy'];
const CITIES = ['Lagos', 'Lagos', 'Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano', 'Enugu', 'Benin City', 'Abeokuta'];
const { INDUSTRIES } = require('./promos');
const TITLES = ['CEO', 'Sales Manager', 'HR Manager', 'Head of Operations', 'Marketing Lead', 'Founder', 'Admin Officer', 'Procurement Lead'];
const TAGS = ['Hot', 'Bank', 'Oil and gas', 'Founding member', 'Event lead', 'Referral', 'Follow up Q1', 'VIP'];
const NOTES = [
  'Met at the Lagos Business School breakfast. Wants cards for 40 sales staff.',
  'Called: interested, asked for the Enterprise price list.',
  'WhatsApp: sent the live demo link, they liked the tap animation.',
  'Visited office in Victoria Island. Decision maker is the MD, meeting next week.',
  'Asked about printing their own logo on the NFC card.',
  'Prefers WhatsApp to email. Follow up on Friday.',
  'Budget approved for January. Send the proposal before Christmas.',
  'Said current paper cards cost them ₦180,000 a year.',
];

const pick = (a, i) => a[i % a.length];
const rnd = (n) => Math.floor(Math.random() * n);
const ago = (d) => new Date(Date.now() - d * 864e5 - rnd(8 * 3600e3));

async function load(staffId) {
  const n = { contacts: 0, deals: 0, users: 0, payments: 0 };
  const staff = (await db('users').where((w) => w.where({ is_admin: true }).orWhereNotNull('staff_role')).select('id')).map((s) => s.id);
  if (!staff.length) staff.push(staffId);

  // HollaTap accounts: free, trial, Pro, founding, lapsed
  for (let i = 0; i < 40; i++) {
    const fn = pick(FIRST, i + 3); const ln = pick(LAST, i * 7);
    const email = `${fn}.${ln}${i}@example.com`.toLowerCase();
    if (await db('users').where({ email }).first()) continue;
    const kind = i % 5; // 0 free, 1 trial, 2 pro, 3 pro founding, 4 lapsed
    const created = ago(2 + rnd(80));
    let ref; do ref = randomCode(6); while (await db('users').where({ ref_code: ref }).first());
    const [uid] = await db('users').insert({
      email, name: `${fn} ${ln}`, industry: pick(INDUSTRIES, i), marketing_opt_in: i % 3 !== 0, ref_code: ref,
      plan: kind >= 2 ? 'pro' : 'free',
      plan_expires_at: kind === 2 ? addDays(new Date(), 5 + rnd(300)) : kind === 3 ? addDays(new Date(), 200 + rnd(160)) : kind === 4 ? addDays(new Date(), -(3 + rnd(40))) : null,
      trial_ends_at: kind === 1 ? addDays(new Date(), 1 + rnd(13)) : addDays(created, 14),
      founding_member: kind === 3, is_affiliate: i % 9 === 0, referred_by: null, last_seen_at: ago(rnd(20)), is_demo: true, created_at: created, updated_at: created,
    }).returning('id');
    const id = typeof uid === 'object' ? uid.id : uid;
    n.users++;
    if (kind >= 2) {
      const amount = kind === 3 ? 20000 : 25000;
      const paidAt = ago(rnd(60));
      await db('payments').insert({ reference: `DEMO-${randomCode(10)}`, user_id: id, kind: 'pro', amount_naira: amount, status: 'success', paid_at: paidAt, meta_json: JSON.stringify({ label: kind === 3 ? 'HollaTap Pro, 1 year (founding member price)' : 'HollaTap Pro, 1 year' }), is_demo: true, created_at: paidAt });
      n.payments++;
    }
    if (i % 6 === 0) {
      const paidAt = ago(rnd(30));
      const [pid] = await db('payments').insert({ reference: `DEMO-${randomCode(10)}`, user_id: id, kind: 'nfc', quantity: 1 + (i % 3), amount_naira: 15000 * (1 + (i % 3)), status: 'success', paid_at: paidAt, meta_json: JSON.stringify({ label: 'HollaTap NFC card' }), is_demo: true, created_at: paidAt }).returning('id');
      n.payments++;
      await db('nfc_orders').insert({ user_id: id, quantity: 1 + (i % 3), kind: 'paid', ship_name: `${fn} ${ln}`, ship_phone: `0800000${String(1000 + i).slice(-4)}`, ship_address: `${10 + i} Admiralty Way, Lekki Phase 1, Lagos`, status: ['new', 'printing', 'ready', 'dispatched', 'delivered'][i % 5], payment_id: typeof pid === 'object' ? pid.id : pid, is_demo: true });
    }
  }
  // a few referrals + commissions for demo affiliates
  const affs = await db('users').where({ is_demo: true, is_affiliate: true });
  const others = await db('users').where({ is_demo: true, is_affiliate: false }).limit(12);
  for (let i = 0; i < others.length; i++) {
    const a = affs[i % Math.max(1, affs.length)];
    if (!a) break;
    await db('users').where({ id: others[i].id }).update({ referred_by: a.id });
    const pay = await db('payments').where({ user_id: others[i].id, status: 'success' }).first();
    if (pay) await db('commissions').insert({ affiliate_id: a.id, payment_id: pay.id, rate_pct: 25, amount_naira: Math.round(pay.amount_naira * 0.25), status: i % 2 ? 'payable' : 'pending', payable_at: addDays(new Date(), i % 2 ? -1 : 20), is_demo: true }).onConflict('payment_id').ignore();
  }
  // their CRM records
  for (const u of await db('users').where({ is_demo: true })) await crm.upsertFromUser(u);

  // Leads and prospects (not yet customers)
  for (let i = 0; i < 70; i++) {
    const fn = pick(FIRST, i * 3 + 1); const ln = pick(LAST, i * 5 + 2);
    const company = pick(COMPANIES, i);
    const created = ago(rnd(75));
    const b = addDays(new Date(), rnd(330));
    const [cid] = await db('crm_contacts').insert({
      name: `${fn} ${ln}`, company, job_title: pick(TITLES, i), email: `${fn}.${ln}.lead${i}@example.com`.toLowerCase(), phone: `0800000${String(2000 + i).slice(-4)}`,
      city: pick(CITIES, i), industry: pick(INDUSTRIES, i * 2), source: pick(['manual', 'whatsapp', 'event', 'ads', 'referral', 'enquiry', 'enterprise', 'import'], i),
      stage: pick(['new', 'new', 'contacted', 'warm', 'warm', 'customer', 'lost'], i), owner_id: i % 4 === 0 ? null : pick(staff, i),
      tags: i % 3 === 0 ? pick(TAGS, i) : i % 5 === 0 ? `${pick(TAGS, i)},${pick(TAGS, i + 3)}` : '',
      birthday: i % 2 === 0 ? `${String(b.getMonth() + 1).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')}` : null,
      sms_ok: i % 4 !== 3, email_ok: i % 5 !== 4, last_contacted_at: i % 3 ? ago(rnd(20)) : null, is_demo: true, created_at: created, updated_at: created,
    }).returning('id');
    const id = typeof cid === 'object' ? cid.id : cid;
    n.contacts++;
    const acts = 1 + (i % 4);
    for (let k = 0; k < acts; k++) {
      await db('crm_activities').insert({ contact_id: id, staff_id: pick(staff, i + k), type: pick(['call', 'whatsapp', 'email', 'visit', 'sms', 'social', 'note', 'meeting'], i + k), summary: pick(NOTES, i + k), is_demo: true, created_at: ago(rnd(14)) });
    }
    if (i % 2 === 0 || i % 7 === 0) {
      const product = pick(['HollaTap Teams', 'HollaTap Teams', 'HollaTap Enterprise', 'HollaTap Pro', 'NFC cards', 'RhinoVMS', 'AI Agents & Trainings', 'Website', 'rhinoRETAIL'], rnd(9));
      const value = product === 'HollaTap Enterprise' ? 3000000 + rnd(9) * 500000 : product === 'HollaTap Teams' ? 30000 * (10 + rnd(60)) : product === 'RhinoVMS' ? 1500000 + rnd(4) * 250000 : product === 'AI Agents & Trainings' ? 2000000 + rnd(5) * 500000 : product === 'Website' ? 450000 + rnd(6) * 150000 : product === 'rhinoRETAIL' ? 800000 : product === 'NFC cards' ? 15000 * (10 + rnd(40)) : 25000;
      const stage = pick(['new', 'contacted', 'contacted', 'demo', 'proposal', 'proposal', 'won', 'won', 'lost'], rnd(9));
      const em = addDays(new Date(), 15 + rnd(90));
      await db('crm_deals').insert({
        contact_id: id, title: `${company}: ${product}`, product, value_naira: value, stage, owner_id: pick(staff, i),
        expected_month: `${em.getFullYear()}-${String(em.getMonth() + 1).padStart(2, '0')}`,
        lost_reason: stage === 'lost' ? pick(['Price', 'Timing', 'Chose a competitor', 'No reply'], i) : null,
        closed_at: ['won', 'lost'].includes(stage) ? ago(rnd(25)) : null, is_demo: true,
      });
      n.deals++;
    }
    if (i % 3 === 0) {
      await db('crm_tasks').insert({ title: pick(['Call to book a demo', 'Send Enterprise proposal', 'WhatsApp the price list', 'Visit the office', 'Follow up on quote'], i), contact_id: id, assignee_id: pick(staff, i), created_by: staffId, due_at: addDays(new Date(), (i % 5) - 2), is_demo: true });
    }
    if (i % 4 === 0) {
      await db('crm_messages').insert({ channel: i % 8 ? 'sms' : 'email', to: i % 8 ? `234800000${String(2000 + i).slice(-4)}` : `${fn}.${ln}.lead${i}@example.com`.toLowerCase(), contact_id: id, staff_id: pick(staff, i), body: `Hi ${fn}, thanks for your time today. Here's HollaTap: hollatap.com`, kind: 'manual', status: 'simulated', is_demo: true, created_at: ago(rnd(10)) });
    }
  }
  await db('crm_campaigns').insert({ name: 'Demo: Christmas offer to warm leads', channel: 'sms', segment_json: JSON.stringify({ stage: 'warm' }), body: 'Hi {first_name}, get 20% off HollaTap Teams for {company} until 31 December. Reply YES to book a demo.', status: 'sent', sent_count: 18, failed_count: 1, created_by: staffId, sent_at: ago(3), is_demo: true });
  return n;
}

async function clear() {
  const demoContacts = db('crm_contacts').where({ is_demo: true }).select('id');
  const out = {};
  for (const t of ['crm_activities', 'crm_tasks', 'crm_messages', 'crm_deals']) {
    out[t] = await db(t).where({ is_demo: true }).del();
    out[t] += await db(t).whereIn('contact_id', demoContacts).del();
  }
  out.crm_campaigns = await db('crm_campaigns').where({ is_demo: true }).del();
  out.crm_contacts = await db('crm_contacts').where({ is_demo: true }).del();
  out.commissions = await db('commissions').where({ is_demo: true }).del();
  out.nfc_orders = await db('nfc_orders').where({ is_demo: true }).del();
  out.payments = await db('payments').where({ is_demo: true }).del();
  out.enquiries = await db('enquiries').where({ is_demo: true }).del();
  const demoUsers = db('users').where({ is_demo: true }).select('id');
  await db('cards').whereIn('user_id', demoUsers).del();
  await db('users').whereIn('referred_by', demoUsers).update({ referred_by: null });
  out.users = await db('users').where({ is_demo: true }).del();
  return out;
}

module.exports = { load, clear };
