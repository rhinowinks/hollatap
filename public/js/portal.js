(function () {
  var root = document.documentElement;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  // Theme: dark by default, remembered per browser.
  var theme = store.get('ht_portal_theme') || 'dark';
  root.setAttribute('data-theme', theme);
  var tb = document.getElementById('theme-btn');
  function paintBtn() { if (tb) tb.textContent = root.getAttribute('data-theme') === 'dark' ? '☀' : '☾'; }
  paintBtn();
  if (tb) tb.addEventListener('click', function () {
    var t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', t); store.set('ht_portal_theme', t); paintBtn();
  });

  // Mobile menu
  var mt = document.querySelector('.menu-toggle'), nav = document.getElementById('pnav');
  if (mt && nav) mt.addEventListener('click', function () {
    var open = nav.classList.toggle('open'); mt.setAttribute('aria-expanded', open);
  });
  // Close other dropdowns when one opens
  document.querySelectorAll('.pnav details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) document.querySelectorAll('.pnav details').forEach(function (o) { if (o !== d) o.open = false; });
    });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.pnav details')) document.querySelectorAll('.pnav details[open]').forEach(function (d) { d.open = false; });
  });

  // Once-a-day greeting
  var g = document.getElementById('greet');
  var today = new Date().toISOString().slice(0, 10);
  if (g && document.body.dataset.greet !== 'off' && location.pathname === '/admin' && store.get('ht_greet') !== today) {
    var h = new Date().getHours();
    var part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    var quotes = [
      'Don’t count the days; make the days count.',
      'Every card shared is a door opened.',
      'Follow up today. Fortune is in the follow-up.',
      'Small daily wins build big companies.',
      'Make it easy to say yes.',
    ];
    document.getElementById('greet-h').textContent = part + '. It’s going to be a great day!';
    document.getElementById('greet-q').textContent = '“' + quotes[new Date().getDate() % quotes.length] + '”';
    g.hidden = false;
    var go = document.getElementById('greet-go');
    go.focus();
    var close = function () { g.hidden = true; store.set('ht_greet', today); };
    go.addEventListener('click', close);
    g.addEventListener('click', function (e) { if (e.target === g) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  // Confirm dangerous actions
  document.addEventListener('submit', function (e) {
    var m = e.target.getAttribute('data-confirm');
    if (m && !window.confirm(m)) e.preventDefault();
  });

  // Select all rows
  var all = document.getElementById('select-all');
  if (all) all.addEventListener('change', function () {
    document.querySelectorAll('input[name="ids"]').forEach(function (c) { c.checked = all.checked; });
  });

  // Insert a saved template into the message box
  document.querySelectorAll('[data-template]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var o = sel.options[sel.selectedIndex];
      if (!o || !o.value) return;
      var box = document.getElementById(sel.dataset.template);
      var subj = document.getElementById(sel.dataset.subject || '');
      if (box) box.value = o.dataset.body || '';
      if (subj && o.dataset.subject) subj.value = o.dataset.subject;
      if (box) box.dispatchEvent(new Event('input'));
    });
  });

  // SMS length counter (160 characters per SMS page)
  document.querySelectorAll('[data-sms-count]').forEach(function (box) {
    var out = document.getElementById(box.dataset.smsCount);
    var paint = function () {
      var n = box.value.length, pages = n <= 160 ? 1 : Math.ceil(n / 153);
      if (out) out.textContent = n + ' characters · ' + pages + ' SMS page' + (pages > 1 ? 's' : '');
    };
    box.addEventListener('input', paint); paint();
  });

  // Show the right fields for the chosen channel
  document.querySelectorAll('[data-channel-switch]').forEach(function (sel) {
    var form = sel.closest('form');
    var paint = function () {
      var v = sel.value;
      form.querySelectorAll('[data-for]').forEach(function (el) {
        el.hidden = el.dataset.for.split(' ').indexOf(v) === -1;
      });
    };
    sel.addEventListener('change', paint); paint();
  });

  // Pipeline: drag a deal to another stage
  var dragged = null;
  document.querySelectorAll('.dcard[draggable]').forEach(function (c) {
    c.addEventListener('dragstart', function () { dragged = c; c.style.opacity = '.5'; });
    c.addEventListener('dragend', function () { c.style.opacity = ''; });
  });
  document.querySelectorAll('.col[data-stage]').forEach(function (col) {
    col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', function () { col.classList.remove('drop'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault(); col.classList.remove('drop');
      if (!dragged || dragged.dataset.stage === col.dataset.stage) return;
      var form = dragged.querySelector('form');
      var sel = form && form.querySelector('select[name="stage"]');
      if (!sel) return;
      sel.value = col.dataset.stage;
      form.submit();
    });
  });
  // Changing the stage dropdown on a card saves straight away
  document.querySelectorAll('.dcard select[name="stage"]').forEach(function (sel) {
    sel.addEventListener('change', function () { sel.form.submit(); });
  });
})();
