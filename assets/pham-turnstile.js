/**
 * PHAM — Cloudflare Turnstile (contact + waitlist forms).
 */
(function () {
  'use strict';

  var widgetIds = new WeakMap();
  var bootPromises = new WeakMap();
  var tokenReady = new WeakMap();

  function isSecureVerifyUrl(url) {
    if (!url) return false;
    try {
      var parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname.length > 0;
    } catch (e) {
      return false;
    }
  }

  function readConfig(root) {
    var verifyUrl = (root.getAttribute('data-pham-turnstile-verify-url') || '').trim();
    if (verifyUrl && !isSecureVerifyUrl(verifyUrl)) {
      verifyUrl = '';
    }
    return {
      siteKey: (root.getAttribute('data-pham-turnstile-site-key') || '').trim(),
      verifyUrl: verifyUrl,
      action: root.getAttribute('data-pham-turnstile-action') || 'pham_form',
    };
  }

  function getForm(root) {
    return root.querySelector('#pham-contact-form, [data-pham-waitlist-form], form');
  }

  function getWrap(form) {
    return form && form.querySelector('[data-pham-turnstile-wrap]');
  }

  function getErrorEl(form) {
    return form && form.querySelector('[data-pham-turnstile-error]');
  }

  function getStatusEl(form) {
    return form && form.querySelector('[data-pham-turnstile-status-text]');
  }

  function getSkeleton(form) {
    return form && form.querySelector('[data-pham-turnstile-skeleton]');
  }

  function setWrapState(form, state) {
    var wrap = getWrap(form);
    if (!wrap) return;
    wrap.classList.remove('is-loading', 'is-ready', 'is-error', 'is-interactive');
    if (state) wrap.classList.add(state);
    wrap.setAttribute('data-pham-turnstile-status', state || '');
  }

  function hideSkeleton(form) {
    var skeleton = getSkeleton(form);
    if (skeleton) skeleton.hidden = true;
  }

  function showStatus(form, message) {
    var el = getStatusEl(form);
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function showError(form, message) {
    var errorEl = getErrorEl(form);
    if (!errorEl) return;
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      setWrapState(form, tokenReady.get(form) ? 'is-ready' : 'is-interactive');
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
    setWrapState(form, 'is-error');
  }

  function getTurnstileToken(form) {
    var input = form.querySelector('[name="cf-turnstile-response"]');
    return input && input.value ? input.value : '';
  }

  function markTokenReady(form, ready) {
    tokenReady.set(form, !!ready);
    if (ready) {
      hideSkeleton(form);
      setWrapState(form, 'is-ready');
      showStatus(form, 'Security check complete. You may submit the form.');
    }
  }

  function waitForTurnstileApi() {
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      function tick() {
        if (window.turnstile && typeof window.turnstile.render === 'function') {
          resolve();
          return;
        }
        attempts += 1;
        if (attempts > 200) {
          reject(new Error('turnstile_timeout'));
          return;
        }
        setTimeout(tick, 50);
      }
      tick();
    });
  }

  function renderTurnstile(root, form) {
    var container = form.querySelector('[data-pham-turnstile]');
    if (!container || !window.turnstile) {
      throw new Error('turnstile_container_missing');
    }

    var config = readConfig(root);
    var existingId = widgetIds.get(container);
    if (existingId !== undefined) {
      try { window.turnstile.remove(existingId); } catch (e) { /* ignore */ }
      widgetIds.delete(container);
    }

    tokenReady.set(form, false);
    setWrapState(form, 'is-loading');
    showStatus(form, 'Loading security verification…');
    showError(form, '');

    var widgetId = window.turnstile.render(container, {
      sitekey: config.siteKey,
      theme: 'dark',
      size: 'flexible',
      action: config.action,
      appearance: 'always',
      retry: 'auto',
      'refresh-expired': 'auto',
      callback: function () {
        markTokenReady(form, true);
        showError(form, '');
        form.dispatchEvent(new CustomEvent('pham:turnstile:ready', { bubbles: true }));
      },
      'before-interactive-callback': function () {
        hideSkeleton(form);
        setWrapState(form, 'is-interactive');
        showStatus(form, 'Complete the security check to continue.');
      },
      'error-callback': function () {
        hideSkeleton(form);
        markTokenReady(form, false);
        showError(form, 'Security check could not load. Refresh the page or try again in a moment.');
      },
      'expired-callback': function () {
        markTokenReady(form, false);
        showError(form, 'Security check expired. Complete it again before sending.');
        showStatus(form, 'Complete the security check to continue.');
      },
      'timeout-callback': function () {
        markTokenReady(form, false);
        showError(form, 'Security check timed out. Please try again.');
      },
    });

    widgetIds.set(container, widgetId);

    window.setTimeout(function () {
      hideSkeleton(form);
      if (!tokenReady.get(form)) {
        setWrapState(form, 'is-interactive');
        showStatus(form, 'Complete the security check to continue.');
      }
    }, 1200);

    return widgetId;
  }

  function resetTurnstile(form) {
    var container = form.querySelector('[data-pham-turnstile]');
    if (!container || !window.turnstile) return;
    var widgetId = widgetIds.get(container);
    if (widgetId === undefined) return;
    markTokenReady(form, false);
    try { window.turnstile.reset(widgetId); } catch (e) { /* ignore */ }
    showStatus(form, 'Complete the security check to continue.');
  }

  function scrollToTurnstile(form) {
    var wrap = getWrap(form);
    if (!wrap) return;
    wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    wrap.setAttribute('tabindex', '-1');
    try { wrap.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function parseVerifyResponse(response, text) {
    var trimmed = (text || '').trim();
    if (trimmed.indexOf('<!DOCTYPE') === 0 || trimmed.indexOf('<html') === 0) {
      return {
        ok: false,
        message: 'Security verification backend is not responding correctly. The site owner needs to redeploy Google Apps Script.',
      };
    }

    var data = {};
    try {
      data = JSON.parse(trimmed);
    } catch (e) {
      data = {};
    }
    if (!response.ok) {
      return { ok: false, message: 'Security verification service unavailable. Please try again.' };
    }
    if (data.success === true) {
      return { ok: true };
    }
    if (data.error === 'turnstile_not_configured') {
      return {
        ok: false,
        message: 'Security verification is not configured on the server (missing Turnstile secret).',
      };
    }
    return {
      ok: false,
      message: 'Security check failed. Please complete the check and try again.',
    };
  }

  function verifyTokenRemote(config, token) {
    if (!config.verifyUrl) {
      return Promise.resolve({ ok: false, message: 'Security verification is not configured (HTTPS URL required).' });
    }

    if (!isSecureVerifyUrl(config.verifyUrl)) {
      return Promise.resolve({ ok: false, message: 'Security verification URL must use HTTPS.' });
    }

    /* GET — GAS /exec returns Access-Control-Allow-Origin: * for GET. POST from browser often fails CORS. */
    var joiner = config.verifyUrl.indexOf('?') >= 0 ? '&' : '?';
    var url = config.verifyUrl + joiner + 'token=' + encodeURIComponent(token);

    return fetch(url, {
      method: 'GET',
      credentials: 'omit',
      mode: 'cors',
      redirect: 'follow',
      headers: { Accept: 'application/json, text/plain, */*' },
    }).then(function (response) {
      return response.text().then(function (text) {
        return parseVerifyResponse(response, text);
      });
    }).catch(function () {
      return { ok: false, message: 'Could not reach the security verification service. Check your connection and try again.' };
    });
  }

  function bootRoot(root) {
    var config = readConfig(root);
    if (!config.siteKey) {
      return Promise.reject(new Error('turnstile_not_configured'));
    }

    var form = getForm(root);
    if (!form) {
      return Promise.reject(new Error('turnstile_form_missing'));
    }

    return waitForTurnstileApi()
      .then(function () {
        renderTurnstile(root, form);
        showError(form, '');
      })
      .catch(function (err) {
        hideSkeleton(form);
        showError(form, 'Security check unavailable. Refresh the page and try again.');
        throw err;
      });
  }

  window.PhamTurnstile = {
    init: function (root) {
      if (!root) return Promise.reject(new Error('turnstile_root_missing'));
      if (bootPromises.has(root)) {
        return bootPromises.get(root);
      }
      var promise = bootRoot(root);
      bootPromises.set(root, promise);
      return promise;
    },

    isReady: function (form) {
      return !!tokenReady.get(form);
    },

    scrollTo: scrollToTurnstile,

    run: function (form, root) {
      var config = readConfig(root);
      if (!config.siteKey) {
        return Promise.resolve({ ok: false, message: 'Security check is not configured.' });
      }

      var ready = bootPromises.get(root) || bootRoot(root);

      return ready
        .then(function () {
          var token = getTurnstileToken(form);
          if (!token) {
            scrollToTurnstile(form);
            throw new Error('turnstile_incomplete');
          }
          showStatus(form, 'Verifying security check…');
          return token;
        })
        .then(function (token) {
          return verifyTokenRemote(config, token).then(function (result) {
            if (result && result.ok) {
              showStatus(form, 'Security check verified.');
              return { ok: true };
            }
            resetTurnstile(form);
            scrollToTurnstile(form);
            return {
              ok: false,
              message: (result && result.message) || 'Security check failed. Please try again.',
            };
          });
        })
        .catch(function (err) {
          if (err && err.message === 'turnstile_incomplete') {
            return { ok: false, message: 'Complete the security check below before submitting.' };
          }
          if (err && err.message === 'turnstile_timeout') {
            return { ok: false, message: 'Security check timed out. Refresh the page and try again.' };
          }
          resetTurnstile(form);
          scrollToTurnstile(form);
          return { ok: false, message: 'Security check unavailable. Please try again.' };
        });
    },

    reset: resetTurnstile,

    restoreFromCache: function () {
      bootPromises = new WeakMap();
      tokenReady = new WeakMap();
      widgetIds = new WeakMap();
      document.querySelectorAll('[data-pham-turnstile-enabled="true"]').forEach(function (root) {
        var form = getForm(root);
        if (!form) return;
        showError(form, '');
        showStatus(form, '');
        setWrapState(form, 'is-loading');
        var skeleton = getSkeleton(form);
        if (skeleton) skeleton.hidden = false;
        window.PhamTurnstile.init(root).catch(function () { /* surfaced in widget */ });
      });
    },
  };

  window.addEventListener('pageshow', function (event) {
    if (!event.persisted || !window.PhamTurnstile) return;
    window.PhamTurnstile.restoreFromCache();
    if (window.PhamWaitlistCheckout && window.PhamWaitlistCheckout.resetUiState) {
      window.PhamWaitlistCheckout.resetUiState();
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-pham-turnstile-enabled="true"]').forEach(function (root) {
      window.PhamTurnstile.init(root).catch(function () { /* surfaced in widget error */ });
    });
  });
})();
