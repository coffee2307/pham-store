(function () {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MODEL_VIEWER_SRC = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';

  function ensureModelViewerLibrary() {
    if (window.customElements && window.customElements.get('model-viewer')) {
      return Promise.resolve();
    }
    if (window.__PHAM_MODEL_VIEWER_PROMISE__) {
      return window.__PHAM_MODEL_VIEWER_PROMISE__;
    }

    window.__PHAM_MODEL_VIEWER_PROMISE__ = new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[data-pham-model-viewer]');
      const script = existing || document.createElement('script');

      function finish() {
        if (window.customElements && window.customElements.whenDefined) {
          window.customElements.whenDefined('model-viewer').then(resolve, reject);
        } else {
          resolve();
        }
      }

      if (existing) {
        if (window.customElements && window.customElements.get('model-viewer')) finish();
        else {
          existing.addEventListener('load', finish, { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
        return;
      }

      script.type = 'module';
      script.src = MODEL_VIEWER_SRC;
      script.dataset.phamModelViewer = 'true';
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    });

    return window.__PHAM_MODEL_VIEWER_PROMISE__;
  }

  function mount(stage) {
    if (stage.dataset.phamStageMounted === 'true') return;
    stage.dataset.phamStageMounted = 'true';

    const image = stage.querySelector('[data-pham-stage-image]');
    const model = stage.querySelector('[data-pham-stage-model]');
    const template = stage.querySelector('[data-pham-stage-model-template]');
    const mode = stage.querySelector('[data-pham-stage-mode]');
    const loader = stage.querySelector('[data-pham-stage-loader]');
    const progressBar = stage.querySelector('[data-pham-stage-progress-bar]');
    const progressValue = stage.querySelector('[data-pham-stage-progress-value]');
    const errorNote = stage.querySelector('[data-pham-stage-error]');
    const rotateHint = stage.querySelector('[data-pham-stage-rotate-hint]');
    const switches = Array.from(stage.querySelectorAll('[data-pham-stage-switch]'));
    const defaultView = stage.dataset.defaultView || 'image';

    let requested = false;
    let ready = false;
    let failed = false;
    let desiredView = defaultView;
    let failTimer = 0;
    let rotateHintTimer = 0;
    let rotateHintShown = false;
    let observer = null;

    function setModeLabel(label) {
      if (mode) mode.textContent = label || '';
    }

    function setProgress(value) {
      const normalized = Math.max(0, Math.min(1, Number(value) || 0));
      const percent = Math.round(normalized * 100);
      if (progressBar) progressBar.style.transform = 'scaleX(' + normalized.toFixed(4) + ')';
      if (progressValue) progressValue.textContent = String(percent).padStart(2, '0') + '%';
    }

    function setLoaderVisible(visible) {
      if (loader) loader.hidden = !visible;
    }

    function setErrorVisible(visible) {
      if (errorNote) errorNote.hidden = !visible;
    }

    function hideRotateHint() {
      window.clearTimeout(rotateHintTimer);
      rotateHintTimer = 0;
      if (!rotateHint) return;
      rotateHint.classList.remove('is-visible');
      window.setTimeout(function () {
        if (!rotateHint.classList.contains('is-visible')) rotateHint.hidden = true;
      }, reducedMotion ? 0 : 440);
    }

    function showRotateHint() {
      if (!rotateHint || rotateHintShown) return;
      rotateHintShown = true;
      rotateHint.hidden = false;
      requestAnimationFrame(function () {
        rotateHint.classList.add('is-visible');
      });
      rotateHintTimer = window.setTimeout(hideRotateHint, reducedMotion ? 2400 : 3600);
    }

    function syncSwitcher(view) {
      switches.forEach(function (button) {
        const active = button.dataset.phamStageSwitch === view;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    function showImage() {
      hideRotateHint();
      if (image) image.hidden = false;
      if (model) model.hidden = true;
      syncSwitcher('image');
      setLoaderVisible(false);
      setErrorVisible(false);
      setModeLabel(stage.dataset.imageModeLabel);
    }

    function showModelReady() {
      if (!ready || !model) return;
      if (image) image.hidden = true;
      model.hidden = false;
      syncSwitcher('model');
      setLoaderVisible(false);
      setErrorVisible(false);
      setModeLabel(stage.dataset.modelModeLabel);
      stage.classList.add('is-model-ready');
      stage.classList.remove('is-model-loading', 'is-model-error');
      showRotateHint();
    }

    function showModelLoading() {
      hideRotateHint();
      if (image) image.hidden = false;
      if (model) model.hidden = true;
      syncSwitcher('model');
      setErrorVisible(false);
      setLoaderVisible(true);
      setModeLabel(stage.dataset.loadingModeLabel || stage.dataset.modelModeLabel);
      stage.classList.add('is-model-loading');
      stage.classList.remove('is-model-error');
    }

    function showModelError() {
      hideRotateHint();
      if (image) image.hidden = false;
      if (model) model.hidden = true;
      setLoaderVisible(false);
      setErrorVisible(true);
      setModeLabel(stage.dataset.errorModeLabel || stage.dataset.imageModeLabel);
      stage.classList.add('is-model-error');
      stage.classList.remove('is-model-loading', 'is-model-ready');
      switches.forEach(function (button) {
        if (button.dataset.phamStageSwitch === 'model') {
          button.disabled = true;
          button.setAttribute('aria-disabled', 'true');
        }
      });
    }

    function clearFailTimer() {
      if (!failTimer) return;
      window.clearTimeout(failTimer);
      failTimer = 0;
    }

    function configureModel(viewer) {
      if (!viewer) return;
      viewer.setAttribute('reveal', 'auto');
      viewer.setAttribute('loading', 'eager');
      viewer.setAttribute('interaction-prompt', 'none');
      viewer.setAttribute('disable-pan', '');
      viewer.setAttribute('disable-zoom', '');
      if (reducedMotion) viewer.removeAttribute('auto-rotate');

      viewer.addEventListener('pointerdown', hideRotateHint, { passive: true });
      viewer.addEventListener('keydown', hideRotateHint);

      viewer.addEventListener('progress', function (event) {
        if (event.detail && event.detail.reason && event.detail.reason !== 'model-load') return;
        if (event.detail && typeof event.detail.totalProgress === 'number') {
          setProgress(event.detail.totalProgress);
        }
        if (desiredView === 'model' && !ready && !failed) showModelLoading();
      });

      viewer.addEventListener('load', function () {
        clearFailTimer();
        ready = true;
        failed = false;
        setProgress(1);
        if (desiredView === 'model') showModelReady();
        else showImage();
      }, { once: true });

      viewer.addEventListener('error', function () {
        clearFailTimer();
        failed = true;
        ready = false;
        showModelError();
      }, { once: true });
    }

    function requestModel() {
      if (requested || failed || !model || !template) return;
      requested = true;
      setProgress(0);

      failTimer = window.setTimeout(function () {
        if (ready || failed) return;
        failed = true;
        showModelError();
      }, 30000);

      ensureModelViewerLibrary().then(function () {
        if (failed || model.querySelector('model-viewer')) return;
        model.appendChild(template.content.cloneNode(true));
        configureModel(model.querySelector('model-viewer'));
      }).catch(function () {
        clearFailTimer();
        failed = true;
        ready = false;
        showModelError();
      });
    }

    function show(view) {
      desiredView = view === 'model' ? 'model' : 'image';

      if (desiredView === 'image') {
        showImage();
        return;
      }
      if (failed) {
        showModelError();
        return;
      }
      if (ready) {
        showModelReady();
        return;
      }

      showModelLoading();
      requestModel();
    }

    switches.forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
        show(button.dataset.phamStageSwitch);
      });
    });

    if (defaultView === 'model' && model && template) {
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(function (entries) {
          if (!entries[0] || !entries[0].isIntersecting) return;
          observer.disconnect();
          observer = null;
          show('model');
        }, { rootMargin: '240px 0px', threshold: 0.01 });
        observer.observe(stage);
      } else {
        show('model');
      }
    } else {
      show('image');
    }
  }

  function mountAll(scope) {
    (scope || document).querySelectorAll('[data-pham-object-stage]').forEach(mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mountAll(); }, { once: true });
  else mountAll();
  document.addEventListener('shopify:section:load', function (event) { mountAll(event.target); });
})();