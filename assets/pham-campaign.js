(function(){
'use strict';

function qsa(selector, root){
  return Array.prototype.slice.call((root || document).querySelectorAll(selector));
}

function safeReferralCode(value){
  return /^[A-Za-z0-9_-]{3,64}$/.test(value || '') ? value : '';
}

function captureReferral(){
  try {
    var params = new URLSearchParams(window.location.search);
    var ref = safeReferralCode(params.get('ref') || '');
    if(ref) localStorage.setItem('pham_referral_code', ref);
  } catch (e) { /* ignore storage/query failures */ }
}

function storedReferral(){
  try {
    return safeReferralCode(localStorage.getItem('pham_referral_code') || '');
  } catch (e) {
    return '';
  }
}

function formatMoney(cents, currency){
  var amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD'
    }).format(amount);
  } catch (e) {
    return '$' + amount.toFixed(2);
  }
}

function engineErrorMessage(code){
  var messages = {
    object_number_taken: 'That object number was just claimed. Select another number.',
    object_number_out_of_range: 'Select a valid object number for this edition.',
    identity_not_claimed: 'Object Identity is not unlocked for this collector.',
    customer_login_required: 'Sign in with the collector account linked to your reservation.',
    reservation_not_found: 'No active reservation was found for this collector account.',
    standby_not_open: 'Standby is not open yet.',
    standby_already_joined: 'This collector is already in the standby queue.',
    invalid_email: 'Enter a valid email address.',
    invalid_signature: 'Collector session verification failed. Refresh the page and try again.',
    stale_request: 'This collector session expired. Refresh the page and try again.'
  };
  return messages[code] || 'Unable to complete this request. Please try again.';
}

function proxyRequest(root, route, options){
  var base = (root.dataset.engineProxy || '/apps/pham-edition').replace(/\/$/, '');
  var requestOptions = Object.assign({
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    credentials: 'same-origin'
  }, options || {});

  if(requestOptions.body && typeof requestOptions.body !== 'string'){
    requestOptions.headers = Object.assign({}, requestOptions.headers, {
      'Content-Type': 'application/json'
    });
    requestOptions.body = JSON.stringify(requestOptions.body);
  }

  return fetch(base + route, requestOptions).then(function(response){
    return response.json().catch(function(){ return {}; }).then(function(payload){
      if(!response.ok || payload.ok === false){
        var error = new Error(payload.error || 'proxy_request_failed');
        error.code = payload.error || 'proxy_request_failed';
        error.payload = payload;
        throw error;
      }
      return payload;
    });
  });
}

function mountIdentity(root){
  if(root.dataset.phamMounted === 'true') return;
  root.dataset.phamMounted = 'true';

  var name = root.querySelector('[data-pham-id-name]');
  var inscription = root.querySelector('[data-pham-id-inscription]');
  var outName = root.querySelector('[data-pham-preview-name]');
  var outInscription = root.querySelector('[data-pham-preview-inscription]');
  var outNumber = root.querySelector('[data-pham-preview-number]');
  var count = root.querySelector('[data-pham-inscription-count]');
  var numberInput = root.querySelector('[data-pham-id-number-input]');
  var submit = root.querySelector('[data-pham-identity-submit]');
  var form = root.querySelector('.pham-identity-form');
  var publicIdentity = root.querySelector('input[name="contact[Public identity]"]');
  var result = root.querySelector('[data-pham-identity-result]');
  var engineEnabled = root.dataset.engineEnabled === 'true';
  var buttons = qsa('[data-pham-object-number]', root);

  function sync(){
    if(outName) outName.textContent = (name && name.value.trim()) || 'COLLECTOR ID';
    if(outInscription) outInscription.textContent = (inscription && inscription.value.trim()) || 'YOUR INSCRIPTION';
    if(count && inscription) count.textContent = String(inscription.value.length) + '/40';
  }

  if(name) name.addEventListener('input', sync);
  if(inscription) inscription.addEventListener('input', sync);

  buttons.forEach(function(btn){
    btn.addEventListener('click', function(){
      buttons.forEach(function(x){
        x.classList.remove('is-selected');
        x.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-selected');
      btn.setAttribute('aria-pressed', 'true');
      if(outNumber) outNumber.textContent = btn.dataset.phamObjectNumber + '/' + (root.dataset.editionSize || '50');
      if(numberInput) numberInput.value = btn.dataset.phamObjectNumber || '';
      if(submit) submit.disabled = !numberInput || numberInput.value === '';
    });
  });

  if(submit) submit.disabled = !numberInput || numberInput.value === '';

  if(engineEnabled && form){
    form.addEventListener('submit', function(event){
      event.preventDefault();
      if(!submit || submit.disabled || !numberInput || !numberInput.value) return;

      submit.disabled = true;
      submit.classList.add('is-busy');
      submit.textContent = 'Saving Identity…';
      if(result) result.hidden = true;

      proxyRequest(root, '/identity/configure', {
        method: 'POST',
        body: {
          alias: name ? name.value : '',
          inscription: inscription ? inscription.value : '',
          preferredNumber: Number(numberInput.value),
          publicIdentity: Boolean(publicIdentity && publicIdentity.checked)
        }
      })
      .then(function(payload){
        if(result){
          result.textContent = 'IDENTITY RECORDED · OBJECT ' +
            String(payload.identity.preferredNumber).padStart(2, '0') +
            '/' + (root.dataset.editionSize || '50') +
            ' IS NOW LOCKED TO YOUR RESERVATION.';
          result.hidden = false;
        }
        buttons.forEach(function(btn){ btn.disabled = true; });
        if(name) name.disabled = true;
        if(inscription) inscription.disabled = true;
        if(publicIdentity) publicIdentity.disabled = true;
        submit.textContent = 'Identity recorded';
      })
      .catch(function(error){
        if(result){
          result.textContent = engineErrorMessage(error.code);
          result.hidden = false;
        }
        submit.disabled = false;
        submit.classList.remove('is-busy');
        submit.textContent = 'Submit Identity request';
      });
    });
  }

  sync();
}

function mountReferral(root){
  if(root.dataset.phamReferralMounted === 'true') return;
  root.dataset.phamReferralMounted = 'true';

  var button = root.querySelector('[data-pham-copy-referral]');
  var code = root.querySelector('[data-pham-referral-value]');
  var count = root.querySelector('[data-pham-referral-count]');

  if(button && code){
    button.addEventListener('click', function(){
      var value = code.textContent.trim();
      if(!value || value === 'PENDING' || value === 'LOADING…') return;

      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(value).then(function(){
          button.textContent = 'COPIED';
          window.setTimeout(function(){ button.textContent = 'COPY'; }, 1200);
        });
      }
    });
  }

  if(root.dataset.engineEnabled !== 'true') return;

  if(code) code.textContent = 'LOADING…';

  proxyRequest(root, '/status')
    .then(function(payload){
      var referralCode = payload.reservation && payload.reservation.collectorReferralCode
        ? payload.reservation.collectorReferralCode
        : '';
      if(code){
        code.textContent = referralCode
          ? (root.dataset.referralTarget || '') + encodeURIComponent(referralCode)
          : 'PENDING';
      }
      if(count && payload.referral){
        count.textContent = String(payload.referral.verifiedCount || 0) + ' / ' +
          String(payload.referral.requiredCount || 1);
      }
    })
    .catch(function(){
      if(code && code.textContent === 'LOADING…') code.textContent = 'PENDING';
    });
}

function mountReservation(root){
  if(root.dataset.phamReservationMounted === 'true') return;
  root.dataset.phamReservationMounted = 'true';

  var checks = qsa('[data-pham-required-consent]', root);
  var submit = root.querySelector('[data-pham-reservation-submit]');
  var identity = root.querySelector('[data-pham-identity-upgrade]');
  var total = root.querySelector('[data-pham-reservation-total]');
  var error = root.querySelector('[data-pham-reservation-error]');

  var canCheckout = root.dataset.canCheckout === 'true';
  var reservationVariantId = root.dataset.reservationVariantId || '';
  var identityVariantId = root.dataset.identityVariantId || '';
  var lookbookVariantId = root.dataset.lookbookVariantId || '';
  var includeLookbook = root.dataset.includeLookbook === 'true';
  var lookbookReady = root.dataset.lookbookReady === 'true';
  var reservationPrice = parseInt(root.dataset.reservationPriceCents || '2499', 10);
  var identityPrice = parseInt(root.dataset.identityPriceCents || '500', 10);
  var currency = root.dataset.currency || 'USD';
  var edition = root.dataset.edition || '';
  var productCode = root.dataset.productCode || '';

  function consentReady(){
    return checks.length > 0 && checks.every(function(x){ return x.checked; });
  }

  function sync(){
    var addIdentity = !!(identity && identity.checked && !identity.disabled);
    if(total) total.textContent = formatMoney(reservationPrice + (addIdentity ? identityPrice : 0), currency);

    if(submit){
      var lookbookValid = !includeLookbook || (lookbookReady && lookbookVariantId !== '');
      var ready = canCheckout && consentReady() && reservationVariantId !== '' && lookbookValid;
      submit.disabled = !ready;
      submit.setAttribute('aria-disabled', ready ? 'false' : 'true');
      submit.classList.toggle('is-disabled', !ready);
    }
  }

  checks.forEach(function(x){ x.addEventListener('change', sync); });
  if(identity) identity.addEventListener('change', sync);

  if(submit){
    submit.addEventListener('click', function(){
      if(submit.disabled || !canCheckout) return;

      var referral = storedReferral();
      var items = [{
        id: Number(reservationVariantId),
        quantity: 1,
        properties: {
          '_PHAM Edition': edition,
          '_PHAM Product': productCode,
          '_PHAM Referral Code': referral,
          'Reservation terms': 'Accepted',
          'Digital lookbook delivery': includeLookbook ? 'Included' : 'Not included'
        }
      }];

      if(includeLookbook && lookbookReady && lookbookVariantId){
        items.push({
          id: Number(lookbookVariantId),
          quantity: 1,
          properties: {
            '_PHAM Edition': edition,
            '_PHAM Product': productCode,
            '_PHAM Benefit': 'Collector Lookbook',
            'Digital delivery': 'Included with Priority Reservation'
          }
        });
      }

      if(identity && identity.checked && !identity.disabled && identityVariantId){
        items.push({
          id: Number(identityVariantId),
          quantity: 1,
          properties: {
            '_PHAM Edition': edition,
            '_PHAM Product': productCode,
            'Identity source': 'Paid upgrade'
          }
        });
      }

      submit.disabled = true;
      submit.classList.add('is-busy');
      submit.textContent = 'Preparing secure checkout…';
      if(error) error.hidden = true;

      fetch('/cart/add.js', {
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({items:items})
      })
      .then(function(response){
        return response.json().then(function(payload){
          if(!response.ok) throw new Error(payload.description || payload.message || 'Unable to prepare reservation.');
          return payload;
        });
      })
      .then(function(){ window.location.assign('/checkout'); })
      .catch(function(err){
        if(error){
          error.textContent = err && err.message ? err.message : 'Unable to prepare reservation. Please try again.';
          error.hidden = false;
        }
        submit.disabled = false;
        submit.classList.remove('is-busy');
        submit.textContent = 'Continue to secure checkout';
        sync();
      });
    });
  }

  sync();
}

function mountStandby(root){
  if(root.dataset.phamStandbyMounted === 'true') return;
  root.dataset.phamStandbyMounted = 'true';

  if(root.dataset.engineEnabled !== 'true') return;

  var form = root.querySelector('.pham-standby-form');
  if(!form) return;

  var submit = root.querySelector('[data-pham-standby-submit]');
  var result = root.querySelector('[data-pham-standby-result]');
  var email = form.querySelector('input[name="contact[email]"]');
  var country = form.querySelector('input[name="contact[Country]"]');
  var size = form.querySelector('input[name="contact[Size preference]"]');

  form.addEventListener('submit', function(event){
    event.preventDefault();
    if(!submit) return;

    submit.disabled = true;
    submit.classList.add('is-busy');
    submit.textContent = 'Joining standby…';
    if(result) result.hidden = true;

    proxyRequest(root, '/standby/join', {
      method: 'POST',
      body: {
        email: email ? email.value : '',
        country: country ? country.value : '',
        size: size ? size.value : ''
      }
    })
    .then(function(payload){
      if(result){
        result.textContent = 'STANDBY CONFIRMED · QUEUE POSITION #' +
          String(payload.standby.sequence).padStart(2, '0') + '.';
        result.hidden = false;
      }
      qsa('input', form).forEach(function(input){ input.disabled = true; });
      submit.textContent = 'Standby confirmed';
    })
    .catch(function(error){
      if(result){
        result.textContent = engineErrorMessage(error.code);
        result.hidden = false;
      }
      submit.disabled = false;
      submit.classList.remove('is-busy');
      submit.textContent = 'Join standby · free';
    });
  });
}

function mountCollector(root){
  if(root.dataset.phamCollectorMounted === 'true') return;
  root.dataset.phamCollectorMounted = 'true';

  var output = root.querySelector('[data-pham-payment-countdown]');
  var deadlineRow = root.querySelector('[data-pham-deadline-row]');
  var countdownRow = root.querySelector('[data-pham-countdown-row]');
  var deadlineLabel = root.querySelector('[data-pham-live-deadline]');
  var timer = null;

  function displayState(value){
    return String(value || 'pending').replace(/_/g, ' ').toUpperCase();
  }

  function startCountdown(rawDeadline){
    if(!output || !rawDeadline) return;

    var deadline = new Date(rawDeadline);
    if(isNaN(deadline.getTime())){
      output.textContent = 'SEE DEADLINE ABOVE';
      return;
    }

    root.dataset.paymentDeadline = rawDeadline;
    if(deadlineRow) deadlineRow.hidden = false;
    if(countdownRow) countdownRow.hidden = false;
    if(deadlineLabel){
      try { deadlineLabel.textContent = deadline.toLocaleString(); }
      catch (e) { deadlineLabel.textContent = rawDeadline; }
    }

    if(timer) window.clearInterval(timer);

    function renderCountdown(){
      var diff = deadline.getTime() - Date.now();
      if(diff <= 0){
        output.textContent = 'WINDOW EXPIRED';
        return false;
      }

      var totalSeconds = Math.floor(diff / 1000);
      var days = Math.floor(totalSeconds / 86400);
      var hours = Math.floor((totalSeconds % 86400) / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      var seconds = totalSeconds % 60;

      var parts = [];
      if(days > 0) parts.push(days + 'D');
      parts.push(String(hours).padStart(2,'0') + 'H');
      parts.push(String(minutes).padStart(2,'0') + 'M');
      parts.push(String(seconds).padStart(2,'0') + 'S');
      output.textContent = parts.join(' ');
      return true;
    }

    if(renderCountdown()){
      timer = window.setInterval(function(){
        if(!renderCountdown()){
          window.clearInterval(timer);
          timer = null;
        }
      }, 1000);
    }
  }

  if(root.dataset.paymentDeadline) startCountdown(root.dataset.paymentDeadline);

  if(root.dataset.engineEnabled !== 'true') return;

  proxyRequest(root, '/status')
    .then(function(payload){
      var reservation = payload.reservation || {};
      var identity = payload.identity || {};
      var referral = payload.referral || {};
      var editionSize = root.dataset.editionSize || '50';

      var statusEl = root.querySelector('[data-pham-live-reservation-status]');
      var objectEl = root.querySelector('[data-pham-live-object]');
      var identityEl = root.querySelector('[data-pham-live-identity-status]');
      var referralEl = root.querySelector('[data-pham-live-referral]');
      var lookbookEl = root.querySelector('[data-pham-live-lookbook]');
      var lookbookCopyEl = root.querySelector('[data-pham-live-lookbook-copy]');
      var balanceEl = root.querySelector('[data-pham-live-balance]');

      if(statusEl) statusEl.textContent = displayState(reservation.status);
      if(objectEl){
        objectEl.textContent = reservation.objectNumber
          ? String(reservation.objectNumber).padStart(2,'0') + ' / ' + editionSize
          : 'PENDING ASSIGNMENT';
      }
      if(identityEl) identityEl.textContent = displayState(identity.status);
      if(referralEl){
        referralEl.textContent = String(referral.verifiedCount || 0) + ' / ' +
          String(referral.requiredCount || 1) + ' VERIFIED';
      }
      if(lookbookEl) lookbookEl.textContent = displayState(reservation.lookbookStatus);
      if(lookbookCopyEl) lookbookCopyEl.textContent = displayState(reservation.lookbookStatus);
      if(balanceEl && reservation.balanceDueCents != null){
        balanceEl.textContent = formatMoney(
          reservation.balanceDueCents,
          root.dataset.currency || 'USD'
        );
      }
      if(reservation.paymentDeadline) startCountdown(reservation.paymentDeadline);
    })
    .catch(function(error){
      if(error && error.code === 'customer_login_required') return;
      // Keep Shopify metafield fallback visible if the engine is temporarily unavailable.
    });
}
function mount(){
  captureReferral();
  qsa('[data-pham-identity-configurator]').forEach(mountIdentity);
  qsa('[data-pham-referral-hub]').forEach(mountReferral);
  qsa('[data-pham-reservation-gateway]').forEach(mountReservation);
  qsa('[data-pham-standby]').forEach(mountStandby);
  qsa('[data-pham-collector-status]').forEach(mountCollector);
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();

document.addEventListener('shopify:section:load', mount);
})();
