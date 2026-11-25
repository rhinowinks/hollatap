// Builds the same card markup as the server template, for live previews.
const ICONS = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  map: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  wa: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/>',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

export function luminance(hex) {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function onColour(bg) {
  try {
    const l = luminance(bg);
    return (1.05 / (l + 0.05)) >= 4.5 ? '#FFFFFF' : '#0F1B2D';
  } catch {
    return '#FFFFFF';
  }
}

export function renderCard(d) {
  const initials = (d.full_name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const accent = /^#[0-9a-f]{6}$/i.test(d.accent || '') ? d.accent : '#0F1B2D';
  const rows = [];
  if (d.phone) rows.push(`<span class="hc-row">${icon('phone')}<span>${esc(d.phone)}</span></span>`);
  if (d.email) rows.push(`<span class="hc-row">${icon('mail')}<span>${esc(d.email)}</span></span>`);
  if (d.website) rows.push(`<span class="hc-row">${icon('web')}<span>${esc(d.website.replace(/^https?:\/\//, ''))}</span></span>`);
  if (d.address) rows.push(`<span class="hc-row">${icon('map')}<span>${esc(d.address)}</span></span>`);
  const links = (d.links || []).filter((l) => l.url).map((l) => `<span class="hc-links-item" style="display:block;text-align:center;border-radius:12px;padding:12px;background:#FAF6F0;font-weight:700">${esc(l.label || l.url)}</span>`).join('');
  return `<article class="hc tpl-${esc(d.template || 'classic')}" style="--accent:${accent};--on:${onColour(accent)}">
    <div class="hc-top"><div class="hc-logo">${d.logoUrl ? `<img src="${esc(d.logoUrl)}" alt="">` : `<span class="init">${esc(initials)}</span>`}</div>
    <div><h2 class="hc-name">${esc(d.full_name || 'Your name')}</h2><p class="hc-title">${esc([d.job_title, d.company].filter(Boolean).join(' · ') || 'Job title · Company')}</p></div></div>
    ${d.bio ? `<p class="hc-bio" style="padding-top:14px">${esc(d.bio)}</p>` : ''}
    <div class="hc-body">${rows.join('') || '<span class="hc-row muted">Your phone, email and address show here</span>'}</div>
    ${links ? `<div class="hc-links">${links}</div>` : ''}
    <div class="hc-actions"><span class="hc-save">Save contact</span>${(d.whatsapp || d.phone) && !d.instant ? `<div class="hc-secondary"><span style="min-height:46px;border-radius:12px;border:1.5px solid #E6DFD4;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">WhatsApp</span><span style="min-height:46px;border-radius:12px;border:1.5px solid #E6DFD4;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">Share my details</span></div>` : ''}</div>
    ${d.footer ? '<div class="hc-foot"><img src="/brand/hollatap-mark-colour.svg" alt="">Made free with <b>HollaTap</b></div>' : ''}
  </article>`;
}

export function readForm(form) {
  const v = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
  const tpl = form.querySelector('input[name=template]:checked');
  const labels = [...form.querySelectorAll('input[name=link_label]')].map((i) => i.value.trim());
  const urls = [...form.querySelectorAll('input[name=link_url]')].map((i) => i.value.trim());
  return {
    full_name: v('full_name'), job_title: v('job_title'), company: v('company'), phone: v('phone'), whatsapp: v('whatsapp'),
    email: v('email'), website: v('website'), address: v('address'), bio: v('bio'), accent: v('accent'),
    template: tpl ? tpl.value : 'classic', links: urls.map((u, i) => ({ url: u, label: labels[i] })),
  };
}
