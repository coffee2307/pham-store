/**
 * PHAM contact form — Turnstile gate before native Shopify submit.
 */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var root = document.querySelector('[data-pham-contact][data-pham-turnstile-enabled="true"]');
  if (!root) return;

  if (root.querySelector('[data-pham-contact-success]')) {
    return;
  }

  var form = root.querySelector('#pham-contact-form, form');
  if (!form) return;

  if (!form.querySelector('[data-pham-turnstile]')) {
    return;
  }

  var captchaError = form.querySelector('[data-pham-turnstile-error]');
  var submitBtn = form.querySelector('[type="submit"]');
  var submitLabel = submitBtn && submitBtn.textContent;
  var turnstilePassed = false;
  var verifyInFlight = false;

  function resetFormState() {
    turnstilePassed = false;
    verifyInFlight = false;
    setSubmitting(false);
    showCaptchaError('');
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
    submitBtn.disabled = isSubmitting;
    submitBtn.setAttribute('aria-disabled', isSubmitting ? 'true' : 'false');
    submitBtn.classList.toggle('is-verifying', isSubmitting);
    if (isSubmitting) {
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.textContent = 'Verifying security…';
      return;
    }
    submitBtn.removeAttribute('aria-busy');
    if (submitLabel) submitBtn.textContent = submitLabel;
  }

  if (window.PhamTurnstile) {
    window.PhamTurnstile.init(root).catch(function () {
      showCaptchaError('Security check could not load. Refresh the page and try again.');
    });
  }

  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    resetFormState();
    if (window.PhamTurnstile && window.PhamTurnstile.restoreFromCache) {
      window.PhamTurnstile.restoreFromCache();
    }
  });

  form.addEventListener('submit', function (event) {
    if (turnstilePassed) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (verifyInFlight) {
      return;
    }

    showCaptchaError('');

    if (!window.PhamTurnstile) {
      showCaptchaError('Security check is still loading. Please wait a moment and try again.');
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    verifyInFlight = true;
    setSubmitting(true);

    window.PhamTurnstile.init(root)
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

        turnstilePassed = true;
        verifyInFlight = false;
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending…';
        }
        form.submit();
      })
      .catch(function () {
        verifyInFlight = false;
        setSubmitting(false);
        showCaptchaError('Security check unavailable. Refresh the page and try again.');
      });
  });
});
