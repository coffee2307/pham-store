/**
 * PHAM waitlist — add edition to cart and redirect to Shopify checkout.
 */
(function () {
  'use strict';

  var OVERLAY_ID = 'pham-waitlist-checkout-overlay';

  function readField(form, selector) {
    var el = form.querySelector(selector);
    return el && el.value ? el.value.trim() : '';
  }

  function readMarketingOptIn(form) {
    var selected = form.querySelector('[data-pham-waitlist-marketing]:checked');
    return !!(selected && selected.value === 'yes');
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (data) {
        return { ok: response.ok, data: data };
      });
    });
  }

  function ensureOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'pham-waitlist-checkout-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-busy', 'true');
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="pham-waitlist-checkout-overlay__panel" data-pham-bracket>' +
        '<div class="pham-waitlist-checkout-overlay__spinner" aria-hidden="true"></div>' +
        '<p class="pham-waitlist-checkout-overlay__eyebrow">Atelier</p>' +
        '<p class="pham-waitlist-checkout-overlay__text" data-pham-waitlist-overlay-text>Preparing secure checkout…</p>' +
      '</div>';

    document.body.appendChild(overlay);
    return overlay;
  }

  function showOverlay(message) {
    var overlay = ensureOverlay();
    var textEl = overlay.querySelector('[data-pham-waitlist-overlay-text]');
    if (textEl && message) textEl.textContent = message;
    overlay.hidden = false;
    overlay.setAttribute('aria-busy', 'true');
    requestAnimationFrame(function () {
      overlay.classList.add('is-active');
    });
    document.body.classList.add('pham-no-scroll', 'pham-waitlist-checkout-active');
  }

  function hideOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    overlay.classList.remove('is-active');
    overlay.hidden = true;
    overlay.setAttribute('aria-busy', 'false');
    document.body.classList.remove('pham-no-scroll', 'pham-waitlist-checkout-active');
  }

  function setOverlayMessage(message) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay || !message) return;
    var textEl = overlay.querySelector('[data-pham-waitlist-overlay-text]');
    if (textEl) textEl.textContent = message;
  }

  function resetCheckoutUiState() {
    hideOverlay();
  }

  window.PhamWaitlistCheckout = {
    showOverlay: showOverlay,
    hideOverlay: hideOverlay,
    resetUiState: resetCheckoutUiState,

    go: function (form, root) {
      showOverlay('Preparing your edition…');

      var variantId = parseInt(root.getAttribute('data-variant-id') || '', 10);
      if (!variantId) {
        hideOverlay();
        return Promise.resolve({ ok: false, message: 'This edition is not available for checkout right now.' });
      }

      var name = readField(form, '[data-pham-waitlist-name]');
      var email = readField(form, '[data-pham-waitlist-email]');
      var altContact = readField(form, '[data-pham-waitlist-alt]');
      var notes = readField(form, '[data-pham-waitlist-notes]');
      var marketing = readMarketingOptIn(form);

      if (!name) {
        hideOverlay();
        return Promise.resolve({ ok: false, message: 'Please enter your full name.' });
      }
      if (!email) {
        hideOverlay();
        return Promise.resolve({ ok: false, message: 'Please enter your email.' });
      }

      if (window.PhamWaitlistPhone) {
        window.PhamWaitlistPhone.sync(form);
      }
      var phone = window.PhamWaitlistPhone
        ? window.PhamWaitlistPhone.getNumber(form)
        : readField(form, '[data-pham-waitlist-phone]');
      if (!phone) {
        hideOverlay();
        return Promise.resolve({ ok: false, message: 'Please enter your phone number.' });
      }
      if (window.PhamWaitlistPhone && !window.PhamWaitlistPhone.isValid(form)) {
        hideOverlay();
        return Promise.resolve({ ok: false, message: 'Please enter a valid phone number.' });
      }

      var properties = {
        '_waitlist': 'yes',
        'Full name': name,
        'Email': email,
        'Phone': phone,
        'Legal consent': 'yes',
        'Marketing opt-in': marketing ? 'yes' : 'no',
      };

      if (altContact) properties['Alternative contact'] = altContact;
      if (notes) properties['Other requests'] = notes;

      setOverlayMessage('Securing your place on the waitlist…');

      return postJson('/cart/clear.js', {})
        .catch(function () { return { ok: true, data: {} }; })
        .then(function () {
          setOverlayMessage('Adding your Digital Access Pass…');
          return postJson('/cart/add.js', {
            items: [{
              id: variantId,
              quantity: 1,
              properties: properties,
            }],
          });
        })
        .then(function (addResult) {
          if (!addResult.ok) {
            hideOverlay();
            var description = addResult.data && addResult.data.description;
            return {
              ok: false,
              message: description || 'Unable to add this edition to checkout. It may be sold out.',
            };
          }

          setOverlayMessage('Finalizing checkout…');

          return postJson('/cart/update.js', {
            attributes: {
              'Waitlist signup': 'yes',
              'Signup name': name,
              'Signup email': email,
              'Signup phone': phone,
              'Marketing opt-in': marketing ? 'yes' : 'no',
            },
          }).catch(function () {
            return { ok: true, data: {} };
          }).then(function () {
            if (typeof gtag === 'function') {
              gtag('event', 'begin_checkout', { event_category: 'waitlist' });
            }
            if (typeof fbq === 'function') {
              fbq('track', 'InitiateCheckout');
            }
            setOverlayMessage('Redirecting to secure checkout…');
            window.location.assign('/checkout');
            return { ok: true };
          });
        })
        .catch(function () {
          hideOverlay();
          return { ok: false, message: 'Checkout is unavailable. Please try again.' };
        });
    },
  };

  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      resetCheckoutUiState();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resetCheckoutUiState, { once: true });
  } else {
    resetCheckoutUiState();
  }
})();
