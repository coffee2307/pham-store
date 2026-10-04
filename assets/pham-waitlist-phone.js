/**
 * PHAM waitlist — intl-tel-input phone field (E.164 on submit).
 */
(function () {
  'use strict';

  var instances = new WeakMap();

  function initPhoneField(form) {
    var input = form.querySelector('[data-pham-waitlist-phone]');
    if (!input || !window.intlTelInput || instances.has(input)) {
      return input ? instances.get(input) : null;
    }

    var iti = window.intlTelInput(input, {
      initialCountry: 'us',
      utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@23/build/js/utils.js',
      separateDialCode: true,
      nationalMode: false,
    });

    instances.set(input, iti);
    return iti;
  }

  function getInstance(form) {
    var input = form.querySelector('[data-pham-waitlist-phone]');
    return input ? instances.get(input) : null;
  }

  window.PhamWaitlistPhone = {
    init: initPhoneField,
    sync: function (form) {
      var input = form.querySelector('[data-pham-waitlist-phone]');
      var iti = getInstance(form);
      if (!input || !iti) return;
      var number = iti.getNumber();
      if (number) input.value = number;
    },
    getNumber: function (form) {
      var iti = getInstance(form);
      if (iti) return iti.getNumber() || '';
      var input = form.querySelector('[data-pham-waitlist-phone]');
      return input && input.value ? input.value.trim() : '';
    },
    isValid: function (form) {
      var iti = getInstance(form);
      if (!iti) return false;
      var number = iti.getNumber();
      if (!number) return false;
      if (typeof iti.isValidNumber === 'function') {
        return iti.isValidNumber();
      }
      return number.length >= 8;
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.querySelector('#PhamWaitlistForm');
    if (form) initPhoneField(form);
  });
})();
