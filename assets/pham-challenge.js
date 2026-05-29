(function () {
  'use strict';

  var container = document.querySelector('.shopify-challenge__container');
  if (!container || container.dataset.phamChallengeReady === 'true') return;

  container.dataset.phamChallengeReady = 'true';
  document.body.classList.add('pham-challenge-page');

  var eyebrow = document.createElement('p');
  eyebrow.className = 'pham-eyebrow pham-challenge__eyebrow';
  eyebrow.textContent = 'SECURITY CHECK';

  var title = document.createElement('h1');
  title.className = 'pham-challenge__title';
  title.textContent = 'Verify to continue';

  var lead = document.createElement('p');
  lead.className = 'pham-challenge__lead';
  lead.textContent = 'Complete this step to confirm your pre-order waitlist request.';

  var message = container.querySelector('.shopify-challenge__message');
  if (message) {
    message.classList.add('pham-challenge__platform-message');
    message.setAttribute('aria-hidden', 'true');
  }

  var form = container.querySelector('form');
  if (form) {
    form.classList.add('pham-challenge__form');
    var captcha = form.querySelector('.h-captcha, [data-hcaptcha-widget-id], iframe');
    if (captcha) {
      var wrap = captcha.closest('.shopify-challenge__container') || form;
      var captchaBox = document.createElement('div');
      captchaBox.className = 'pham-challenge__captcha';
      var hc = form.querySelector('.h-captcha') || captcha.parentElement;
      if (hc && hc.parentElement === form) {
        form.insertBefore(captchaBox, hc);
        captchaBox.appendChild(hc);
      }
    }
  }

  container.classList.add('pham-challenge__shell');
  container.insertBefore(lead, container.firstChild);
  container.insertBefore(title, container.firstChild);
  container.insertBefore(eyebrow, container.firstChild);
})();
