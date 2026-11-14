/**
 * PHAM contact form — honeypot gate for native Shopify contact form.
 */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var form = document.getElementById('pham-contact-form');
  if (!form || form.querySelector('[data-pham-contact-success]')) return;

  var honeypot = form.querySelector('[data-pham-contact-honeypot]');
  if (!honeypot) return;

  // Easy-to-find online withdrawal and privacy request entry points.
  var requestType = form.querySelector('[data-pham-contact-request-type]');
  var requested = new URLSearchParams(window.location.search).get('request') || '';
  if (requestType && requested === 'withdrawal') {
    requestType.value = 'Withdrawal or cancellation request';
  }
  if (requestType && requested === 'personal-data') {
    requestType.value = 'Personal data request';
  }

  form.addEventListener('submit', function (event) {
    if (honeypot.value && honeypot.value.trim()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
});
