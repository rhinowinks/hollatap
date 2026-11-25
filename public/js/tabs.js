(function () {
  var tabs = document.querySelectorAll('.tabs [data-tab]');
  if (!tabs.length) return;
  function show(name, push) {
    var title = null;
    tabs.forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.tabpanel').forEach(function (p) {
      var on = p.dataset.panel === name;
      p.hidden = !on;
      if (on) title = p.dataset.title;
    });
    var link = document.querySelector('.tabs [data-tab="' + name + '"]');
    if (push && link && history.pushState) history.pushState({ tab: name }, '', link.getAttribute('href'));
    if (title) document.title = title + ' | HollaTap';
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function (e) {
      if (!document.querySelector('.tabpanel[data-panel="' + t.dataset.tab + '"]')) return;
      e.preventDefault();
      show(t.dataset.tab, true);
      var f = document.querySelector('.tabpanel[data-panel="' + t.dataset.tab + '"] input:not([type=hidden])');
      if (f) f.focus();
    });
  });
  window.addEventListener('popstate', function () {
    show(/company/.test(location.pathname) ? 'company' : 'personal', false);
  });
})();
