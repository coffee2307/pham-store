/**
 * PHAM — limited edition qty stepper (max 1 per customer).
 */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var MAX = 1;
  var DEFAULT_MSG = 'This edition is limited to one per customer.';

  document.querySelectorAll('[data-pham-edition-qty]').forEach(function (root) {
    var input = root.querySelector('[data-pham-edition-qty-input]');
    var notice = root.querySelector('[data-pham-edition-qty-notice]');
    var dec = root.querySelector('[data-pham-edition-qty-dec]');
    var inc = root.querySelector('[data-pham-edition-qty-inc]');
    if (!input) return;

    var message = root.getAttribute('data-pham-edition-qty-message') || DEFAULT_MSG;

    function showNotice() {
      if (!notice) return;
      notice.textContent = message;
      notice.hidden = false;
    }

    function clamp(showMsg) {
      var val = parseInt(input.value, 10) || 1;
      if (val > MAX) {
        input.value = String(MAX);
        if (showMsg) showNotice();
      } else if (val < 1) {
        input.value = '1';
      }
    }

    if (inc) {
      inc.addEventListener('click', function () {
        var val = parseInt(input.value, 10) || 1;
        if (val >= MAX) {
          showNotice();
          return;
        }
        input.value = String(val + 1);
        clamp(true);
      });
    }

    if (dec) {
      dec.addEventListener('click', function () {
        var val = parseInt(input.value, 10) || 1;
        if (val <= 1) return;
        input.value = String(val - 1);
      });
    }

    input.addEventListener('change', function () { clamp(true); });
  });
});
