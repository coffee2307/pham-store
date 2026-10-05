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
    if (ref) localStorage.setItem('pham_referral_code', ref);
  } catch (e) { /* ignore storage/query failures */ }
}

function storedReferral(){
  try { return safeReferralCode(localStorage.getItem('pham_referral_code') || ''); }
  catch (e) { return ''; }
}

function formatMoney(cents, currency){
  var amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style:'currency', currency: currency || 'USD' }).format(amount);
  } catch (e) {
    return '$' + amount.toFixed(2);
  }
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
    });
  });

  sync();
}

function mountReferral(root){
  var button = root.querySelector('[data-pham-copy-referral]');
  var code = root.querySelector('[data-pham-referral-value]');
  if(!button || !code) return;

  button.addEventListener('click', function(){
    var value = code.textContent.trim();
    if(!value || value === 'PENDING') return;

    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(value).then(function(){
        button.textContent = 'COPIED';
        window.setTimeout(function(){ button.textContent = 'COPY'; }, 1200);
      });
    }
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
      var ready = canCheckout && consentReady() && reservationVariantId !== '';
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
          'Digital lookbook delivery': 'Requested'
        }
      }];

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

function mount(){
  captureReferral();
  qsa('[data-pham-identity-configurator]').forEach(mountIdentity);
  qsa('[data-pham-referral-hub]').forEach(mountReferral);
  qsa('[data-pham-reservation-gateway]').forEach(mountReservation);
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();

document.addEventListener('shopify:section:load', mount);
})();