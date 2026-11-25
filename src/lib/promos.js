const { db } = require('../db');

const DEFAULTS = [
  { title: 'Visitors at your office? Go paperless.', body: 'RhinoVMS checks visitors in with a tap and keeps a clean log for security.', cta: 'See RhinoVMS', url: 'https://rhinovms.com', industry: 'Offices, estates and hotels', slot: 'any' },
  { title: 'Running an event?', body: 'rhinoEVENTS handles registration, tickets and attendee cards in one place.', cta: 'Plan my event', url: 'https://rhinowinks.xyz', industry: 'Events and hospitality', slot: 'any' },
  { title: 'Sell online without the stress', body: 'rhinoRETAIL gives your shop a store, stock and sales system that work together.', cta: 'Start selling', url: 'https://rhinowinks.xyz', industry: 'Retail and fashion', slot: 'any' },
  { title: 'Need a website for your business?', body: 'Rhinowinks builds fast, professional websites with WhatsApp built in.', cta: 'Get a website', url: 'https://rhinowinks.xyz', industry: null, slot: 'any' },
  { title: 'Put AI to work in your company', body: 'Practical AI training for leaders and teams, built around real results.', cta: 'Talk to us', url: 'https://rhinowinks.xyz', industry: 'Corporate and government', slot: 'dashboard' },
];

async function seedPromos() {
  const row = await db('promos').count({ n: '*' }).first();
  if (Number(row.n) === 0) await db('promos').insert(DEFAULTS);
}

// Pick one promo: prefer the user's industry, else general ones.
async function pickPromo(slot, industry) {
  const q = db('promos').where({ active: true }).whereIn('slot', [slot, 'any']);
  let rows = industry ? await q.clone().where({ industry }) : [];
  if (!rows.length) rows = await q.clone().whereNull('industry');
  if (!rows.length) rows = await q.clone();
  if (!rows.length) return null;
  const p = rows[Math.floor(Math.random() * rows.length)];
  await db('promos').where({ id: p.id }).increment('impressions', 1);
  return p;
}

const INDUSTRIES = [
  'Offices, estates and hotels',
  'Events and hospitality',
  'Retail and fashion',
  'Corporate and government',
  'Finance and banking',
  'Oil, gas and energy',
  'Health',
  'Education',
  'Creative and media',
  'Tech and startups',
  'Professional services',
  'Other',
];

module.exports = { seedPromos, pickPromo, INDUSTRIES };
