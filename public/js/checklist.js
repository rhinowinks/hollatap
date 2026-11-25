(function () {
  var box = document.getElementById('getstarted');
  if (!box) return;
  var KEY = 'ht_steps';
  var store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };
  if (store.hidden) { box.hidden = true; return; }
  var items = box.querySelectorAll('[data-step]');
  function refresh() {
    var done = 0;
    items.forEach(function (li) {
      var d = li.dataset.server === '1' || !!store[li.dataset.step];
      li.classList.toggle('done', d);
      if (d) done++;
    });
    document.getElementById('gs-count').textContent = done;
    document.getElementById('gs-fill').style.width = Math.round(100 * done / items.length) + '%';
    if (done === items.length) box.hidden = true;
  }
  // Steps we can't see on the server (QR download, signature, invite) tick when the person opens them.
  items.forEach(function (li) {
    var a = li.querySelector('a');
    a.addEventListener('click', function () {
      if (['qr', 'sig', 'ref'].indexOf(li.dataset.step) !== -1) { store[li.dataset.step] = 1; save(); refresh(); }
    });
  });
  document.getElementById('gs-hide').addEventListener('click', function () { store.hidden = 1; save(); box.hidden = true; });
  refresh();
})();
