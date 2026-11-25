import { renderCard, readForm } from './cardview.js';
import { fillFromPdf } from './autofill.js';

const form = document.getElementById('card-form');
const preview = document.getElementById('preview');
const linksBox = document.getElementById('links');
let logoUrl = form.dataset.logo || null;

function update() {
  const d = readForm(form);
  d.logoUrl = logoUrl;
  d.footer = form.dataset.footer === '1';
  preview.innerHTML = renderCard(d);
}

document.getElementById('add-link').addEventListener('click', () => {
  const max = Number(linksBox.dataset.max || 5);
  if (linksBox.querySelectorAll('.row').length >= max) return;
  const row = linksBox.querySelector('.row').cloneNode(true);
  row.querySelectorAll('input').forEach((i) => (i.value = ''));
  linksBox.appendChild(row);
  row.querySelector('input').focus();
});
linksBox.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  const rows = linksBox.querySelectorAll('.row');
  if (rows.length > 1) btn.closest('.row').remove();
  else btn.closest('.row').querySelectorAll('input').forEach((i) => (i.value = ''));
  update();
});
const logo = document.getElementById('f_logo');
if (logo) logo.addEventListener('change', () => {
  const f = logo.files[0];
  if (f) { logoUrl = URL.createObjectURL(f); update(); }
});
document.getElementById('pdf').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) fillFromPdf(f, form, document.getElementById('pdf-status'));
});
const slug = document.getElementById('f_slug');
const name = document.getElementById('f_name');
let slugTouched = !!slug.value;
slug.addEventListener('input', () => { slugTouched = true; });
form.addEventListener('input', () => {
  if (!slugTouched) slug.value = name.value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
});
form.addEventListener('input', update);
form.addEventListener('change', update);
update();
