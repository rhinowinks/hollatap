// End-to-end smoke test: runs the app on a throwaway SQLite DB and walks every main flow.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-'));
process.env.SQLITE_FILE = path.join(tmp, 'test.sqlite');
process.env.PORT = '3399';
process.env.BASE_URL = 'http://localhost:3399';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@hollatap.com';
process.env.PAYSTACK_SECRET_KEY = '';
process.env.SMTP_HOST = '';

const { start } = require('../src/server');
const mailer = require('../src/lib/mailer');
const { db } = require('../src/db');
const BASE = 'http://localhost:3399';

class Client {
  constructor() { this.jar = {}; }
  cookie() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
  }
  async req(method, url, body, headers = {}) {
    const res = await fetch(BASE + url, { method, body, headers: { cookie: this.cookie(), ...headers }, redirect: 'manual' });
    this.store(res);
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text, headers: res.headers };
  }
  get(url) { return this.req('GET', url); }
  async csrf(url) {
    const r = await this.get(url);
    const m = r.text.match(/name="_csrf" value="([^"]+)"/);
    assert(m, `no csrf on ${url} (status ${r.status})`);
    return m[1];
  }
  async post(url, fields, from) {
    const token = await this.csrf(from || url);
    const p = new URLSearchParams({ _csrf: token, ...fields });
    return this.req('POST', url, p.toString(), { 'content-type': 'application/x-www-form-urlencoded' });
  }
  async postMultipart(url, fields, from, file) {
    const token = await this.csrf(from || url);
    const fd = new FormData();
    fd.append('_csrf', token);
    for (const [k, v] of Object.entries(fields)) [].concat(v).forEach((x) => fd.append(k, x));
    if (file) fd.append(file.field, new Blob([file.data], { type: file.type }), file.name);
    return this.req('POST', url, fd);
  }
  async code(email) {
    const mail = [...mailer.sentLog].reverse().find((m) => m.to === email && /\d{6}/.test(m.text || ''));
    return mail.text.match(/\d{6}/)[0];
  }
  async login(email, extra = {}) {
    // Existing users log in; new ones are sent to Sign up, as a real person would be.
    let r = await this.post('/login', { email }, '/login');
    if (r.status === 404) {
      assert(/Sign up with this email/.test(r.text), 'unknown email offers sign-up');
      r = await this.post('/signup', { email, ...extra }, '/signup');
    }
    assert.strictEqual(r.location, '/verify');
    const mail = [...mailer.sentLog].reverse().find((m) => m.to === email);
    const code = mail.text.match(/\d{6}/)[0];
    r = await this.post('/verify', { code }, '/verify');
    assert.strictEqual(r.status, 302, 'verify should redirect');
    return r;
  }
}

async function pngLogo() {
  const sharp = require('sharp');
  return sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 30, b: 60 } } }).png().toBuffer();
}

(async () => {
  const server = await start();
  const ok = (m) => console.log('  ✓', m);
  try {
    // Public pages
    for (const u of ['/', '/instant', '/upgrade', '/privacy', '/terms', '/affiliates', '/for-teams', '/demo']) {
      const r = await new Client().get(u);
      assert.strictEqual(r.status, 200, u);
    }
    {
      const home = await new Client().get('/');
      assert(/<svg/.test(home.text) && /The HollaTap NFC tap card/.test(home.text) && /₦15,000/.test(home.text), 'home has demo QR and NFC section');
      const v = await new Client().get('/demo/contact.vcf');
      assert(/FN:HollaTap/.test(v.text) && /PHOTO/.test(v.text), 'demo vcf');
    }
    {
      const v = new Client();
      const r = await v.post('/enquiry', { product: 'HollaTap Enterprise / branded cards', back: 'for-teams', name: 'Bank Ltd', email: 'it@bank.example', company: 'Bank', message: '400 staff' }, '/for-teams');
      assert.strictEqual(r.location, '/for-teams?sent=1#enterprise');
      assert(await db('enquiries').where({ product: 'HollaTap Enterprise / branded cards' }).first(), 'enterprise enquiry saved');
      const t = await new Client().get('/login/company');
      assert(/Company admin/.test(t.text) && /data-panel="company"/.test(t.text), 'company tab');
    }
    ok('public pages load (home, for-teams, live demo card + vcf), Enterprise quote form, login tabs');

    // Affiliate signs up and joins programme
    const aff = new Client();
    await aff.login('affiliate@example.com');
    let r = await aff.post('/affiliate/join', { bank: 'GTBank, Ada Aff, 0123456789' }, '/affiliate');
    assert.strictEqual(r.location, '/affiliate');
    const affUser = await db('users').where({ email: 'affiliate@example.com' }).first();
    assert(affUser.is_affiliate);
    ok('affiliate joins');

    // New user via referral link, creates a card with a logo
    const u = new Client();
    await u.get(`/?ref=${affUser.ref_code}`);
    r = await u.login('ada@lekkilogistics.com', { industry: 'Offices, estates and hotels', marketing_opt_in: 'on' });
    assert.strictEqual(r.location, '/cards/new');
    const user = await db('users').where({ email: 'ada@lekkilogistics.com' }).first();
    assert.strictEqual(user.referred_by, affUser.id, 'referral recorded');
    assert(user.trial_ends_at, 'trial set');
    ok('sign-up with referral, trial started');

    r = await u.postMultipart('/cards', {
      full_name: 'Adaeze Okafor', job_title: 'Head of Partnerships', company: 'Lekki Logistics', phone: '+234 801 234 5678',
      whatsapp: '08012345678', email: 'ada@lekkilogistics.com', website: 'lekkilogistics.com', address: 'Admiralty Way, Lekki Phase I',
      template: 'classic', accent: '#0F1B2D', accent_auto: '1', link_label: ['Book a call', ''], link_url: ['calendly.com/ada', ''], slug: '',
    }, '/cards/new', { field: 'logo', data: await pngLogo(), type: 'image/png', name: 'logo.png' });
    assert.strictEqual(r.status, 302);
    assert(/\/dashboard\?created=\d+/.test(r.location), r.location);
    const card = await db('cards').where({ user_id: user.id }).first();
    assert.strictEqual(card.slug, 'adaeze-okafor');
    assert(card.logo && card.logo.length > 50, 'logo stored');
    assert.notStrictEqual(card.accent, '#0F1B2D', 'accent matched to logo');
    ok(`card created at /${card.slug} with logo, accent ${card.accent}`);

    r = await u.get(r.location);
    assert(r.text.includes('Your card is live'));
    assert(r.text.includes('/go/'), 'promo shown');
    ok('dashboard shows new card + promo');

    // Public card, vCard, QR, logo
    const visitor = new Client();
    r = await visitor.get(`/${card.slug}`);
    assert.strictEqual(r.status, 200);
    assert(r.text.includes('Adaeze Okafor') && r.text.includes('Save contact') && r.text.includes('wa.me/2348012345678'));
    assert(!r.text.includes('Made free with'), 'no footer during Pro trial');
    r = await visitor.get(`/${card.slug}/contact.vcf`);
    assert(r.text.startsWith('BEGIN:VCARD') && r.text.includes('FN:Adaeze Okafor') && r.text.includes('PHOTO;'));
    r = await visitor.get(`/${card.slug}/logo`);
    assert.strictEqual(r.status, 200);
    r = await u.get(`/cards/${card.id}/qr.png`);
    assert.strictEqual(r.status, 200);
    r = await u.get(`/cards/${card.id}/qr.svg`);
    assert(r.text.includes('<svg'));
    r = await u.get(`/cards/${card.id}/share`);
    assert(r.text.includes('Download QR'));
    ok('public card, vCard with photo, QR PNG/SVG');

    // Lead capture
    r = await visitor.post(`/${card.slug}/lead`, { name: 'Tunde Bello', email: 'tunde@example.com', phone: '', company: 'Bello Ltd', message: 'Great meeting you', consent: 'on', website_url: '' }, `/${card.slug}`);
    assert.strictEqual(r.location, `/${card.slug}?lead=1`);
    assert.strictEqual(await db('leads').where({ card_id: card.id }).count({ n: '*' }).first().then((x) => Number(x.n)), 1);
    assert(mailer.sentLog.some((m) => m.to === 'ada@lekkilogistics.com' && /Tunde/.test(m.subject)));
    r = await u.get(`/cards/${card.id}/leads.csv`);
    assert(r.text.includes('Tunde Bello'), 'CSV export during trial');
    assert(mailer.sentLog.some((m) => /Tunde/.test(m.subject) && (m.attachments || []).includes('tunde-bello.vcf')), 'lead email has vcf');
    const leadRow = await db('leads').where({ card_id: card.id }).first();
    r = await u.get(`/cards/${card.id}/leads/${leadRow.id}.vcf`);
    assert(r.status === 200 && /BEGIN:VCARD/.test(r.text) && /FN:Tunde Bello/.test(r.text) && /ORG:Bello Ltd/.test(r.text), 'single lead vcf');
    r = await u.get(`/cards/${card.id}/leads.vcf`);
    assert(r.status === 200 && /FN:Tunde Bello/.test(r.text), 'all leads vcf');
    r = await visitor.get(`/cards/${card.id}/leads/${leadRow.id}.vcf`);
    assert(r.status !== 200 || !/BEGIN:VCARD/.test(r.text), 'vcf not public');
    ok('lead captured, owner emailed with contact file, CSV + save-to-contacts');

    // Free user after trial: footer shows, mode forced to profile
    await db('users').where({ id: user.id }).update({ trial_ends_at: new Date(Date.now() - 1000) });
    r = await visitor.get(`/${card.slug}`);
    assert(r.text.includes('Made free with'), 'footer after trial');
    ok('footer shows on free plan');

    // Buy Pro (simulated payment): founding price, friend discount, affiliate commission
    r = await u.get('/checkout/pro');
    assert(r.text.includes('Founding member price applied'));
    assert(r.text.includes('Friend discount'));
    r = await u.post('/checkout/pro', {}, '/checkout/pro');
    assert(r.location.startsWith('/pay/simulate/'), r.location);
    const ref = r.location.split('/').pop();
    const pay = await db('payments').where({ reference: ref }).first();
    assert.strictEqual(pay.amount_naira, 18000, 'founding ₦20,000 less 10% friend discount');
    r = await u.post(`/pay/simulate/${ref}`, {}, `/pay/simulate/${ref}`);
    const u2 = await db('users').where({ id: user.id }).first();
    assert.strictEqual(u2.plan, 'pro');
    assert(u2.founding_member);
    const com = await db('commissions').where({ payment_id: pay.id }).first();
    assert.strictEqual(com.rate_pct, 25, 'launch affiliate rate');
    assert.strictEqual(com.amount_naira, 4500);
    r = await visitor.get(`/${card.slug}`);
    assert(!r.text.includes('Made free with') && r.text.includes('Founding member'));
    ok('Pro bought at ₦18,000 (founding + friend), 25% commission ₦4,500, badge shown');

    // Idempotent fulfilment
    await require('../src/lib/billing').fulfil(ref);
    assert.strictEqual(Number((await db('commissions').count({ n: '*' }).first()).n), 1);
    ok('payment fulfilment is idempotent');

    // Card mode redirect (Pro)
    await u.postMultipart(`/cards/${card.id}`, {
      full_name: 'Adaeze Okafor', company: 'Lekki Logistics', template: 'bold', accent: '#0F1B2D', mode: 'review', mode_url: 'https://g.page/r/example', slug: 'adaeze-okafor',
    }, `/cards/${card.id}/edit`);
    r = await visitor.get(`/${card.slug}`);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.location, 'https://g.page/r/example');
    r = await visitor.get(`/${card.slug}?view=card`);
    assert.strictEqual(r.status, 200);
    ok('card mode redirects scans to review page');

    // Non-affiliate referral gives ₦5,000 credit
    const friend = new Client();
    await friend.get(`/?ref=${u2.ref_code}`);
    await friend.login('friend@example.com');
    await friend.postMultipart('/cards', { full_name: 'Friend Person', template: 'minimal', accent: '#123456' }, '/cards/new');
    const fcard = await db('cards').where({ full_name: 'Friend Person' }).first();
    r = await friend.post('/checkout/footer', { card: String(fcard.id) }, `/checkout/footer?card=${fcard.id}`);
    const fref = r.location.split('/').pop();
    await friend.post(`/pay/simulate/${fref}`, {}, `/pay/simulate/${fref}`);
    assert.strictEqual((await db('users').where({ id: user.id }).first()).credit_naira, 5000);
    assert((await db('cards').where({ id: fcard.id }).first()).footer_removed);
    ok('footer removal bought; referrer got ₦5,000 credit');

    // Teams: create, design, invite, join, verified badge, remove member
    const boss = new Client();
    // Company admins: username + password, then an email code
    r = await boss.post('/signup/company', { email: 'ceo@nipcogas.com', username: 'nipcogas', password: 'short', password2: 'short' }, '/signup/company');
    assert.strictEqual(r.status, 400, 'weak password refused');
    r = await boss.post('/signup/company', { email: 'ceo@nipcogas.com', username: 'nipcogas', password: 'Nipco2026', password2: 'Nipco2026', keep: 'on' }, '/signup/company');
    assert.strictEqual(r.location, '/verify');
    r = await boss.post('/verify', { code: await boss.code('ceo@nipcogas.com') }, '/verify');
    assert.strictEqual(r.location, '/teams');
    {
      // the same person cannot slip in with only an email code
      const sneak = new Client();
      r = await sneak.post('/login', { email: 'ceo@nipcogas.com' }, '/login');
      assert(/company admin account/.test(r.text), 'code-only login blocked for company admin');
      r = await sneak.post('/login/company', { username: 'nipcogas', password: 'wrong-pass1' }, '/login/company');
      assert.strictEqual(r.status, 400, 'wrong password refused');
      r = await sneak.post('/login/company', { username: 'nipcogas', password: 'Nipco2026' }, '/login/company');
      assert.strictEqual(r.location, '/verify', 'password then code');
      r = await sneak.post('/verify', { code: await sneak.code('ceo@nipcogas.com') }, '/verify');
      assert.strictEqual(r.location, '/teams');
      // forgot password
      const forgot = new Client();
      r = await forgot.post('/forgot-password', { email: 'nipcogas' }, '/forgot-password');
      assert.strictEqual(r.location, '/verify');
      r = await forgot.post('/verify', { code: await forgot.code('ceo@nipcogas.com') }, '/verify');
      assert.strictEqual(r.location, '/reset-password');
      r = await forgot.post('/reset-password', { password: 'NewPass2026', password2: 'NewPass2026' }, '/reset-password');
      assert.strictEqual(r.status, 302);
      const after = await db('users').where({ email: 'ceo@nipcogas.com' }).first();
      assert(require('../src/lib/passwords').checkPassword('NewPass2026', after.password_hash), 'password reset saved');
      // a personal account can't create a team without a company login
      const solo = new Client();
      await solo.login('solo@example.com');
      r = await solo.get('/teams');
      assert.strictEqual(r.location, '/signup/company');
    }
    ok('company admin: username + password + email code, wrong password refused, code-only blocked, password reset');
    r = await boss.post('/teams', { name: 'NIPCO Gas' }, '/teams');
    assert.strictEqual(r.location, '/teams');
    const team = await db('teams').where({ name: 'NIPCO Gas' }).first();
    assert.strictEqual(team.email_domain, 'nipcogas.com');
    await boss.postMultipart('/teams/settings', { name: 'NIPCO Gas', template: 'split', accent: '#1A7F37', website: 'nipcogas.com' }, '/teams', { field: 'logo', data: await pngLogo(), type: 'image/png', name: 'l.png' });
    r = await boss.postMultipart('/teams/invite', { emails: 'staff1@nipcogas.com, Ngozi Eze, Sales Manager, 08031112222\nnot-an-email' }, '/teams');
    const inv = await db('invites').where({ email: 'staff1@nipcogas.com' }).first();
    assert(inv);
    const staff = new Client();
    r = await staff.get(`/join/${inv.token}`);
    assert(r.location.startsWith('/login?email='));
    await staff.login('staff1@nipcogas.com');
    r = await staff.get(`/join/${inv.token}`);
    assert.strictEqual(r.location, '/dashboard');
    const scard = await db('cards').where({ email: 'staff1@nipcogas.com' }).first();
    assert.strictEqual(scard.team_id, team.id);
    assert.strictEqual(scard.accent, '#1A7F37');
    r = await boss.post('/checkout/team', { qty: '25' }, '/checkout/team?qty=25');
    const tref = r.location.split('/').pop();
    const tpay = await db('payments').where({ reference: tref }).first();
    assert.strictEqual(tpay.amount_naira, 25 * 30000);
    await boss.post(`/pay/simulate/${tref}`, {}, `/pay/simulate/${tref}`);
    const order = await db('nfc_orders').where({ team_id: team.id, kind: 'included' }).first();
    assert.strictEqual(order.quantity, 25);
    r = await visitor.get(`/${scard.slug}`);
    assert(r.text.includes('Verified, NIPCO Gas') && !r.text.includes('Made free with'));
    const other = new Client();
    await other.login('someone@nipcogas.com');
    r = await other.get('/dashboard');
    assert(r.text.includes('NIPCO Gas uses HollaTap Teams'));
    const staffUser = await db('users').where({ email: 'staff1@nipcogas.com' }).first();
    r = await boss.post(`/teams/members/${staffUser.id}/remove`, {}, '/teams');
    r = await visitor.get(`/${scard.slug}`);
    assert.strictEqual(r.status, 404, 'removed staff card switched off');
    ok('Teams: design lock, invite, join, ₦750,000 for 25 staff, 25 NFC cards queued, verified badge, company-email prompt, leaver switched off');

    // Admin + NFC batch + claim
    const admin = new Client();
    await admin.login('admin@hollatap.com');
    for (const p of ['/admin', '/admin/users', '/admin/payments', '/admin/enquiries', '/admin/promos', '/admin/affiliates', '/admin/nfc']) {
      r = await admin.get(p);
      assert.strictEqual(r.status, 200, p);
    }
    r = await u.get('/admin');
    assert.strictEqual(r.status, 404, 'non-admin blocked');
    r = await admin.post('/admin/nfc/batch', { qty: '5', batch: 'TEST1' }, '/admin/nfc');
    r = await admin.get(r.location);
    assert(r.text.split('\n').length === 6 && r.text.includes('/t/'));
    const tag = await db('nfc_tags').where({ batch: 'TEST1' }).first();
    r = await visitor.get(`/t/${tag.code}`);
    assert.strictEqual(r.location, `/claim/${tag.code}`);
    r = await u.post(`/claim/${tag.code}`, { card_id: String(card.id) }, `/claim/${tag.code}`);
    r = await visitor.get(`/t/${tag.code}`);
    assert.strictEqual(r.location, `/${card.slug}?src=nfc`);
    ok('admin pages, NFC batch CSV, tag claim and tap redirect');

    // ---------- Team Portal CRM ----------
    {
      const sms = require('../src/lib/sms');
      assert.strictEqual(sms.intl('0803 123 4567'), '2348031234567');
      assert.strictEqual(sms.intl('+234 803 123 4567'), '2348031234567');
      r = await admin.post('/admin/demo/load', {}, '/admin/settings');
      assert.strictEqual(r.location, '/admin');
      assert((await db('crm_contacts').where({ is_demo: true }).count({ n: '*' }).first()).n > 50, 'demo contacts loaded');
      const pages = ['/admin', '/admin/menu', '/admin/contacts', '/admin/contacts?stage=warm&plan=paid', '/admin/contacts/new', '/admin/pipeline', '/admin/tasks?view=all',
        '/admin/messages', '/admin/messages?stage=warm', '/admin/occasions', '/admin/revenue', '/admin/renewals', '/admin/reports?days=90', '/admin/staff', '/admin/audit', '/admin/settings', '/admin/affiliates', '/admin/users?q=example'];
      for (const p of pages) { r = await admin.get(p); assert.strictEqual(r.status, 200, `${p} ${r.status} ${r.text.slice(0, 300)}`); }
      r = await admin.get('/admin/contacts.csv?stage=warm');
      assert(/^id,name,company/.test(r.text), 'contacts CSV');
      // a sign-up is already a contact
      const uc = await db('crm_contacts').where({ email: 'ada@lekkilogistics.com' }).first();
      assert(uc && uc.user_id && uc.email_ok && uc.stage === 'customer', 'sign-up synced to CRM (opted in, paying)');
      r = await admin.get(`/admin/contacts/${uc.id}`);
      assert.strictEqual(r.status, 200);
      // add a lead by hand, log a call with a follow-up, message them, add a deal and win it
      r = await admin.post('/admin/contacts', { name: 'Kemi Adeyemi', company: 'Ikeja Realty', phone: '08031234567', email: 'kemi@ikejarealty.example', stage: 'new', source: 'event', birthday: '04-12', sms_ok: 'on', email_ok: 'on' }, '/admin/contacts/new');
      const cid = Number(r.location.split('/').pop());
      assert(cid, 'contact created');
      r = await admin.post(`/admin/contacts/${cid}/activity`, { type: 'call', summary: 'Wants 40 cards', stage: 'warm', follow_up: '2030-01-05' }, `/admin/contacts/${cid}`);
      const kemi = await db('crm_contacts').where({ id: cid }).first();
      assert.strictEqual(kemi.stage, 'warm');
      assert(await db('crm_tasks').where({ contact_id: cid }).first(), 'follow-up task created');
      r = await admin.post(`/admin/contacts/${cid}/message`, { channel: 'sms', body: 'Hi {first_name}, here is HollaTap' }, `/admin/contacts/${cid}`);
      const msg = await db('crm_messages').where({ contact_id: cid, channel: 'sms' }).first();
      assert(msg && msg.status === 'simulated' && msg.body === 'Hi Kemi, here is HollaTap' && msg.to === '2348031234567', 'SMS recorded (Termii not configured)');
      r = await admin.post(`/admin/contacts/${cid}/message`, { channel: 'email', subject: 'Hello {first_name}', body: 'Hi {first_name}' }, `/admin/contacts/${cid}`);
      assert(mailer.sentLog.some((m) => m.to === 'kemi@ikejarealty.example' && m.subject === 'Hello Kemi'), 'email sent');
      r = await admin.post('/admin/deals', { contact_id: String(cid), product: 'HollaTap Teams', title: 'Ikeja Realty: 40 cards', value_naira: '1,200,000' }, `/admin/contacts/${cid}`);
      const deal = await db('crm_deals').where({ contact_id: cid }).first();
      assert.strictEqual(deal.value_naira, 1200000);
      r = await admin.post(`/admin/deals/${deal.id}`, { stage: 'won' }, '/admin/pipeline');
      assert.strictEqual((await db('crm_contacts').where({ id: cid }).first()).stage, 'customer', 'won deal makes a customer');
      // bulk send to a list: only people who agreed get it
      const before = await db('crm_messages').count({ n: '*' }).first();
      r = await admin.post('/admin/campaigns', { segment: JSON.stringify({ stage: 'customer', q: 'kemi' }), channel: 'sms', name: 'Test', body: 'Hi {first_name}' }, '/admin/messages');
      const after = await db('crm_messages').count({ n: '*' }).first();
      assert(Number(after.n) > Number(before.n), 'campaign sent');
      // birthdays: automatic greeting on the day
      const crmLib = require('../src/lib/crm');
      const bday = await db('crm_occasions').where({ is_birthday: true }).first();
      await db('crm_occasions').where({ id: bday.id }).update({ auto: true, channel: 'email' });
      await crmLib.runOccasions(new Date('2031-04-12T10:00:00+01:00'));
      assert(mailer.sentLog.some((m) => m.to === 'kemi@ikejarealty.example' && /birthday/i.test(m.text || '')), 'birthday greeting sent');
      const n1 = mailer.sentLog.length;
      await crmLib.runOccasions(new Date('2031-04-12T15:00:00+01:00'));
      assert.strictEqual(mailer.sentLog.length, n1, 'birthday greeting sent once');
      // national day saved and editable
      r = await admin.post('/admin/occasions', { name: 'Eid al-Fitr', date: '03-20', channel: 'sms', body: 'Eid Mubarak {first_name}' }, '/admin/occasions');
      assert(await db('crm_occasions').where({ name: 'Eid al-Fitr' }).first());
      // unsubscribe link
      r = await visitor.get(`/unsubscribe/${cid}/${crmLib.unsubToken(cid)}`);
      assert(!(await db('crm_contacts').where({ id: cid }).first()).email_ok, 'unsubscribed');
      // staff roles: sales can't see money or staff
      r = await admin.post('/admin/staff', { email: 'sales1@hollatap.com', role: 'sales', name: 'Sales One' }, '/admin/staff');
      const sales = new Client();
      await sales.login('sales1@hollatap.com');
      r = await sales.get('/admin/contacts'); assert.strictEqual(r.status, 200, 'sales sees contacts');
      r = await sales.get('/admin/revenue'); assert.strictEqual(r.status, 403, 'sales blocked from revenue');
      r = await sales.get('/admin/staff'); assert.strictEqual(r.status, 403, 'sales blocked from staff');
      r = await sales.post('/admin/campaigns', { segment: '{}', everyone: 'yes', channel: 'sms', body: 'x' }, '/admin/messages');
      assert.strictEqual(r.status, 403, 'sales cannot bulk send');
      // tasks, NFC stage, weekly summary
      r = await admin.post('/admin/tasks', { title: 'Call ABC Bank', due: '2030-01-01', assignee_id: String((await db('users').where({ email: 'sales1@hollatap.com' }).first()).id) }, '/admin/tasks');
      assert(mailer.sentLog.some((m) => m.to === 'sales1@hollatap.com' && /Call ABC Bank/.test(m.subject)), 'task emailed to assignee');
      const order = await db('nfc_orders').where({ is_demo: false }).first();
      if (order) { r = await admin.post(`/admin/nfc/orders/${order.id}`, { status: 'printing' }, '/admin/nfc'); assert.strictEqual((await db('nfc_orders').where({ id: order.id }).first()).status, 'printing'); }
      r = await admin.get('/admin/nfc'); assert.strictEqual(r.status, 200);
      const jobs = require('../src/jobs');
      assert(await jobs.weeklySummary(new Date('2031-06-02T09:00:00+01:00')), 'weekly summary runs on Monday');
      // clearing demo data leaves real data alone
      const realContacts = await db('crm_contacts').where({ is_demo: false }).count({ n: '*' }).first();
      r = await admin.post('/admin/demo/clear', { confirm: 'CLEAR' }, '/admin/settings');
      assert.strictEqual(Number((await db('crm_contacts').where({ is_demo: true }).count({ n: '*' }).first()).n), 0, 'demo cleared');
      assert.strictEqual(Number((await db('users').where({ is_demo: true }).count({ n: '*' }).first()).n), 0, 'demo users cleared');
      assert.strictEqual(Number((await db('crm_contacts').where({ is_demo: false }).count({ n: '*' }).first()).n), Number(realContacts.n), 'real contacts kept');
    }
    ok('Team Portal: demo data, all pages, sync, contacts, activity, SMS (Termii) + email, deals, bulk send with consent, birthdays once, unsubscribe, roles, tasks, NFC stages, weekly summary, demo clear');

    // Enquiry
    r = await visitor.post('/enquiry', { product: 'RhinoVMS', name: 'Visitor', email: 'v@example.com', message: 'Pricing please' }, '/upgrade');
    assert(r.location.startsWith('/upgrade?sent=1'));
    assert(mailer.sentLog.some((m) => m.to === 'admin@hollatap.com' && /RhinoVMS/.test(m.subject)));
    ok('services enquiry saved and emailed to admin');

    // Signature, account pages
    for (const p of ['/signature', '/account', '/affiliate', `/cards/${card.id}/leads`, `/cards/${card.id}/edit`]) {
      r = await u.get(p);
      assert.strictEqual(r.status, 200, p);
    }
    ok('signature, account, affiliate, leads, edit pages');

    // CSRF protection
    r = await visitor.req('POST', `/${card.slug}/lead`, 'name=x', { 'content-type': 'application/x-www-form-urlencoded' });
    assert.strictEqual(r.status, 403);
    ok('CSRF blocks forged posts');

    // Delete account removes everything
    r = await friend.post('/account/delete', { confirm: 'DELETE' }, '/account');
    assert.strictEqual(r.status, 200);
    assert(!(await db('users').where({ email: 'friend@example.com' }).first()));
    assert(!(await db('cards').where({ id: fcard.id }).first()));
    ok('account deletion removes user and cards');

    console.log('\nAll smoke tests passed.');
  } catch (e) {
    console.error('\nFAILED:', e);
    process.exitCode = 1;
  } finally {
    server.close();
    await db.destroy();
  }
})();
