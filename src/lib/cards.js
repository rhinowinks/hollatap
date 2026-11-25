const { db } = require('../db');
const config = require('../config');
const { slugify, RESERVED, randomCode, clean, cleanUrl, cleanEmail, cleanPhone, isFuture } = require('./util');
const { safeHex } = require('./images');

const TEMPLATES = [
  { id: 'classic', name: 'Classic' },
  { id: 'bold', name: 'Bold' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'split', name: 'Split' },
];

const MODES = [
  { id: 'profile', name: 'My card (default)' },
  { id: 'review', name: 'Google review page' },
  { id: 'menu', name: 'Menu or catalogue' },
  { id: 'whatsapp', name: 'WhatsApp chat' },
  { id: 'booking', name: 'Booking page' },
];

async function uniqueSlug(base, excludeId) {
  let s = slugify(base) || 'card';
  if (s.length < 3) s = `${s}-card`;
  let candidate = s;
  for (let i = 0; i < 20; i++) {
    const clash = RESERVED.has(candidate) || (await db('cards').where({ slug: candidate }).whereNot({ id: excludeId || 0 }).first());
    if (!clash) return candidate;
    candidate = `${s}-${randomCode(3).toLowerCase()}`;
  }
  return `${s}-${randomCode(6).toLowerCase()}`;
}

function parseLinks(body, max) {
  const labels = [].concat(body.link_label || []);
  const urls = [].concat(body.link_url || []);
  const out = [];
  for (let i = 0; i < urls.length && out.length < max; i++) {
    const url = cleanUrl(urls[i]);
    if (!url) continue;
    out.push({ label: clean(labels[i], 40) || new URL(url).hostname.replace(/^www\./, ''), url });
  }
  return out;
}

function cardFieldsFrom(body, limits) {
  const tpl = TEMPLATES.find((t) => t.id === body.template) ? body.template : 'classic';
  const mode = MODES.find((m) => m.id === body.mode) ? body.mode : 'profile';
  return {
    full_name: clean(body.full_name, 120),
    job_title: clean(body.job_title, 120),
    company: clean(body.company, 160),
    phone: cleanPhone(body.phone),
    whatsapp: cleanPhone(body.whatsapp),
    email: cleanEmail(body.email),
    website: cleanUrl(body.website),
    address: clean(body.address, 255),
    bio: clean(body.bio, 400),
    links_json: JSON.stringify(parseLinks(body, limits.links)),
    template: tpl,
    accent: safeHex(body.accent),
    mode,
    mode_url: cleanUrl(body.mode_url),
  };
}

function showFooter(card, ownerPlan) {
  if (ownerPlan === 'pro' || ownerPlan === 'team') return false;
  return !(card.footer_removed && isFuture(card.footer_paid_until));
}

function publicUrl(card) {
  return `${config.baseUrl}/${card.slug}`;
}

module.exports = { TEMPLATES, MODES, uniqueSlug, cardFieldsFrom, showFooter, publicUrl };
