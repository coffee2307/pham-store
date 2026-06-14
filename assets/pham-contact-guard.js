/**
 * PHAM contact form — honeypot gate for native Shopify contact form.
 */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var form = document.getElementById('pham-contact-form');
  if (!form || form.querySelector('[data-pham-contact-success]')) return;

  var honeypot = form.querySelector('[data-pham-contact-honeypot]');
  if (!honeypot) return;

  form.addEventListener('submit', function (event) {
    if (honeypot.value && honeypot.value.trim()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
});
