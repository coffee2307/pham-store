/**
 * PHAM waitlist form — submit handler, legal gate, Turnstile → checkout.
 */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var root = document.querySelector('[data-pham-waitlist-signup]');
  if (!root) return;

  var form = root.querySelector('[data-pham-waitlist-form]');
  if (!form) return;

  var legalInput = form.querySelector('[data-pham-waitlist-legal]');
  var submitBtn = form.querySelector('[data-pham-waitlist-submit]');
  var submitLabelEl = submitBtn && submitBtn.querySelector('.pham-waitlist__submit-label');
  var submitLabel = submitLabelEl ? submitLabelEl.textContent : (submitBtn ? submitBtn.textContent : '');
  var honeypotInput = form.querySelector('[data-pham-waitlist-honeypot]');
  var captchaError = form.querySelector('[data-pham-turnstile-error]');
  var formError = form.querySelector('[data-pham-waitlist-error]');
  var turnstileEnabled = root.getAttribute('data-pham-turnstile-enabled') === 'true';
  var turnstileReady = turnstileEnabled && window.PhamTurnstile
    ? window.PhamTurnstile.init(root)
    : Promise.resolve();
  var verifyInFlight = false;

  function showFormError(message) {
    if (!formError) return;
    if (!message) {
      formError.hidden = true;
      formError.textContent = '';
      return;
    }
    formError.hidden = false;
    formError.textContent = message;
  }

  function showCaptchaError(message) {
    if (!captchaError) return;
    if (!message) {
      captchaError.hidden = true;
      captchaError.textContent = '';
      return;
    }
    captchaError.hidden = false;
    captchaError.textContent = message;
    if (window.PhamTurnstile) window.PhamTurnstile.scrollTo(form);
  }

  function setSubmitting(isSubmitting) {
    if (!submitBtn) return;
    submitBtn.classList.toggle('is-verifying', isSubmitting);
    if (isSubmitting) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-disabled', 'true');
      submitBtn.setAttribute('aria-busy', 'true');
      if (submitLabelEl) submitLabelEl.textContent = 'Verifying security…';
      return;
    }
    submitBtn.removeAttribute('aria-busy');
    if (submitLabelEl) submitLabelEl.textContent = submitLabel;
    syncWaitlistSubmitState();
  }

  function syncWaitlistSubmitState() {
    if (!submitBtn || !legalInput) return;
    var allowed = legalInput.checked;
    submitBtn.disabled = !allowed;
    submitBtn.setAttribute('aria-disabled', allowed ? 'false' : 'true');
  }

  function validateWaitlistFields() {
    var name = form.querySelector('[data-pham-waitlist-name]');
    var email = form.querySelector('[data-pham-waitlist-email]');

    if (name && !name.value.trim()) {
      name.focus();
      showFormError('Please enter your full name.');
      return false;
    }
    if (email && !email.value.trim()) {
      email.focus();
      showFormError('Please enter your email.');
      return false;
    }
    if (email && email.validity && !email.validity.valid) {
      email.focus();
      showFormError('Please enter a valid email address.');
      return false;
    }

    if (window.PhamWaitlistPhone) {
      window.PhamWaitlistPhone.sync(form);
      if (!window.PhamWaitlistPhone.getNumber(form)) {
        var phone = form.querySelector('[data-pham-waitlist-phone]');
        if (phone) phone.focus();
        showFormError('Please enter your phone number.');
        return false;
      }
      if (!window.PhamWaitlistPhone.isValid(form)) {
        var phoneInput = form.querySelector('[data-pham-waitlist-phone]');
        if (phoneInput) phoneInput.focus();
        showFormError('Please enter a valid phone number.');
        return false;
      }
    }

    showFormError('');
    return true;
  }

  if (legalInput && submitBtn) {
    syncWaitlistSubmitState();
    legalInput.addEventListener('change', syncWaitlistSubmitState);
  }

  if (turnstileEnabled) {
    turnstileReady.catch(function () {
      showCaptchaError('Security check could not load. Refresh the page and try again.');
    });
  }

  var params = new URLSearchParams(window.location.search);
  var variantFromUrl = params.get('variant');
  if (variantFromUrl) root.setAttribute('data-variant-id', variantFromUrl);

  function resetWaitlistFormState() {
    verifyInFlight = false;
    setSubmitting(false);
    showFormError('');
    showCaptchaError('');
    if (window.PhamWaitlistCheckout && window.PhamWaitlistCheckout.resetUiState) {
      window.PhamWaitlistCheckout.resetUiState();
    }
  }

  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    resetWaitlistFormState();
    if (turnstileEnabled && window.PhamTurnstile && window.PhamTurnstile.restoreFromCache) {
      turnstileReady = window.PhamTurnstile.init(root);
    }
  });

  function proceedToCheckout() {
    if (!window.PhamWaitlistCheckout) {
      showFormError('Checkout is unavailable. Please try again later.');
      return;
    }

    setSubmitting(true);
    showFormError('');
    showCaptchaError('');

    window.PhamWaitlistCheckout.go(form, root).then(function (result) {
      if (!result || !result.ok) {
        if (window.PhamWaitlistCheckout.hideOverlay) {
          window.PhamWaitlistCheckout.hideOverlay();
        }
        setSubmitting(false);
        showFormError((result && result.message) || 'Unable to start checkout. Please try again.');
      }
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (honeypotInput && honeypotInput.value.trim()) {
      return;
    }

    if (legalInput && !legalInput.checked) {
      syncWaitlistSubmitState();
      legalInput.focus();
      showFormError('Please accept the terms before continuing.');
      return;
    }

    if (!validateWaitlistFields()) {
      return;
    }

    if (!turnstileEnabled) {
      proceedToCheckout();
      return;
    }

    if (!window.PhamTurnstile) {
      showCaptchaError('Security check is still loading. Please wait a moment and try again.');
      return;
    }

    if (verifyInFlight) {
      return;
    }

    verifyInFlight = true;
    setSubmitting(true);
    showCaptchaError('');

    turnstileReady
      .then(function () {
        return window.PhamTurnstile.run(form, root);
      })
      .then(function (result) {
        if (!result || !result.ok) {
          verifyInFlight = false;
          setSubmitting(false);
          showCaptchaError((result && result.message) || 'Security check failed. Please try again.');
          return;
        }
        proceedToCheckout();
      })
      .catch(function () {
        verifyInFlight = false;
        setSubmitting(false);
        showCaptchaError('Security check unavailable. Refresh the page and try again.');
      });
  });
});
