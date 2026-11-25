// Small shared UI helpers (no inline scripts, CSP-safe)
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset && f.dataset.confirm && !window.confirm(f.dataset.confirm)) e.preventDefault();
});
document.querySelectorAll('[data-copy]').forEach((el) => {
  el.addEventListener('focus', () => el.select());
  el.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(el.value || el.textContent); el.dataset.copied = '1'; } catch {}
  });
});
document.querySelectorAll('[data-copy-target]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const t = document.getElementById(btn.dataset.copyTarget);
    if (!t) return;
    try {
      if (btn.dataset.copyHtml) {
        const html = t.innerHTML;
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([t.innerText], { type: 'text/plain' }) })]);
      } else {
        await navigator.clipboard.writeText(t.value || t.innerText);
      }
      const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = old), 1500);
    } catch { btn.textContent = 'Select and copy manually'; }
  });
});
