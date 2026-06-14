/**
 * PHAM waitlist form — legal gate + honeypot → checkout.
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
  var formError = form.querySelector('[data-pham-waitlist-error]');

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

  function setSubmitting(isSubmitting) {
    if (!submitBtn) return;
    submitBtn.classList.toggle('is-verifying', isSubmitting);
    if (isSubmitting) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-disabled', 'true');
      submitBtn.setAttribute('aria-busy', 'true');
      if (submitLabelEl) submitLabelEl.textContent = 'Starting checkout…';
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

  function resolveVariantId() {
    var allowed = (root.getAttribute('data-allowed-variant-ids') || '')
      .split(',')
      .map(function (id) { return id.trim(); })
      .filter(Boolean);
    var defaultId = (root.getAttribute('data-variant-id') || '').trim();
    var params = new URLSearchParams(window.location.search);
    var fromUrl = (params.get('variant') || '').trim();

    if (fromUrl && allowed.indexOf(fromUrl) >= 0) {
      return fromUrl;
    }
    return defaultId;
  }

  if (legalInput && submitBtn) {
    syncWaitlistSubmitState();
    legalInput.addEventListener('change', syncWaitlistSubmitState);
  }

  var resolvedVariant = resolveVariantId();
  if (resolvedVariant) {
    root.setAttribute('data-variant-id', resolvedVariant);
  }

  function resetWaitlistFormState() {
    setSubmitting(false);
    showFormError('');
    if (window.PhamWaitlistCheckout && window.PhamWaitlistCheckout.resetUiState) {
      window.PhamWaitlistCheckout.resetUiState();
    }
  }

  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    resetWaitlistFormState();
  });

  function proceedToCheckout() {
    if (!window.PhamWaitlistCheckout) {
      showFormError('Checkout is unavailable. Please try again later.');
      return;
    }

    setSubmitting(true);
    showFormError('');

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

    proceedToCheckout();
  });
});
