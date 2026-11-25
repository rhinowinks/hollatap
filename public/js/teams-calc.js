(function () {
  var box = document.querySelector('.calc');
  if (!box) return;
  var seat = +box.dataset.seat, seat50 = +box.dataset.seat50, min = +box.dataset.min,
      cardFrom = +box.dataset.cardfrom, nfc = +box.dataset.nfc;
  var range = document.getElementById('staff-range'), num = document.getElementById('staff');
  var rate = document.getElementById('calc-rate'), total = document.getElementById('calc-total'), cards = document.getElementById('calc-cards');
  var n = function (v) { return '₦' + Math.round(v).toLocaleString('en-NG'); };

  function update(v) {
    var staff = Math.max(min, Math.min(5000, parseInt(v, 10) || min));
    var per = staff >= 50 ? seat50 : seat;
    rate.textContent = staff + ' staff × ' + n(per) + ' a year';
    total.textContent = n(staff * per) + ' a year';
    cards.textContent = staff >= cardFrom
      ? staff + ' HollaTap tap cards included.'
      : 'Add tap cards for ' + n(nfc) + ' each, or reach ' + cardFrom + ' staff to get them included.';
    if (staff >= 50 && per === seat50) rate.textContent += ' (50+ staff rate)';
    return staff;
  }
  range.addEventListener('input', function () { num.value = range.value; update(range.value); });
  num.addEventListener('input', function () { if (+num.value <= 200) range.value = num.value; update(num.value); });
  num.addEventListener('change', function () { num.value = update(num.value); });
  update(num.value);
})();
