(function () {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MODEL_VIEWER_SRC = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';

  function ensureModelViewerLibrary() {
    if (window.customElements && window.customElements.get('model-viewer')) return Promise.resolve();
    if (window.__PHAM_MODEL_VIEWER_PROMISE__) return window.__PHAM_MODEL_VIEWER_PROMISE__;

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
        existing.addEventListener('load', finish, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }

      script.type = 'module';
      script.src = MODEL_VIEWER_SRC;
      script.dataset.phamModelViewer = 'true';
      script.fetchPriority = 'high';
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    }).catch(function (error) {
      window.__PHAM_MODEL_VIEWER_PROMISE__ = null;
      throw error;
    });

    return window.__PHAM_MODEL_VIEWER_PROMISE__;
  }

  function mount(stage) {
    if (stage.dataset.phamStageMounted === 'true') return;
    stage.dataset.phamStageMounted = 'true';

    const model = stage.querySelector('[data-pham-stage-model]');
    const template = stage.querySelector('[data-pham-stage-model-template]');
    const mode = stage.querySelector('[data-pham-stage-mode]');
    const loader = stage.querySelector('[data-pham-stage-loader]');
    const progressBar = stage.querySelector('[data-pham-stage-progress-bar]');
    const progressValue = stage.querySelector('[data-pham-stage-progress-value]');
    const errorNote = stage.querySelector('[data-pham-stage-error]');
    const rotateHint = stage.querySelector('[data-pham-stage-rotate-hint]');

    if (!model || !template) return;

    let viewer = null;
    let ready = false;
    let failed = false;
    let displayedProgress = 0;
    let rotateHintTimer = 0;
    let rotateHintShown = false;
    let stageInViewport = true;
    let failTimer = 0;

    function setModeLabel(label) {
      if (mode) mode.textContent = label || '';
    }

    function setProgress(value) {
      displayedProgress = Math.max(displayedProgress, Math.max(0, Math.min(1, Number(value) || 0)));
      const percent = Math.round(displayedProgress * 100);
      if (progressBar) progressBar.style.transform = 'scaleX(' + displayedProgress.toFixed(4) + ')';
      if (progressValue) progressValue.textContent = String(percent).padStart(2, '0') + '%';
    }

    function setLoaderVisible(visible) {
      if (loader) loader.hidden = !visible;
    }

    function clearFailTimer() {
      if (!failTimer) return;
      window.clearTimeout(failTimer);
      failTimer = 0;
    }

    function syncViewerActivity() {
      if (!viewer || !ready) return;
      if (!reducedMotion && stageInViewport && !document.hidden) viewer.setAttribute('auto-rotate', '');
      else viewer.removeAttribute('auto-rotate');
    }

    function hideRotateHint() {
      window.clearTimeout(rotateHintTimer);
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
      requestAnimationFrame(function () { rotateHint.classList.add('is-visible'); });
      rotateHintTimer = window.setTimeout(hideRotateHint, reducedMotion ? 2400 : 3600);
    }

    function showReady() {
      ready = true;
      failed = false;
      clearFailTimer();
      setProgress(1);
      setLoaderVisible(false);
      if (errorNote) errorNote.hidden = true;
      setModeLabel(stage.dataset.modelModeLabel);
      stage.classList.add('is-model-ready');
      stage.classList.remove('is-model-loading', 'is-model-error');
      syncViewerActivity();
      showRotateHint();
    }

    function showError() {
      failed = true;
      ready = false;
      clearFailTimer();
      setLoaderVisible(false);
      if (errorNote) errorNote.hidden = false;
      setModeLabel(stage.dataset.errorModeLabel);
      stage.classList.add('is-model-error');
      stage.classList.remove('is-model-loading', 'is-model-ready');
      if (viewer) viewer.removeAttribute('auto-rotate');
    }

    function begin() {
      setLoaderVisible(true);
      setModeLabel(stage.dataset.loadingModeLabel || stage.dataset.modelModeLabel);
      stage.classList.add('is-model-loading');

      ensureModelViewerLibrary().then(function () {
        if (failed || model.querySelector('model-viewer')) return;
        model.appendChild(template.content.cloneNode(true));
        viewer = model.querySelector('model-viewer');
        if (!viewer) {
          showError();
          return;
        }

        viewer.addEventListener('pointerdown', hideRotateHint, { passive: true });
        viewer.addEventListener('keydown', hideRotateHint);

        viewer.addEventListener('progress', function (event) {
          if (event.detail && event.detail.reason && event.detail.reason !== 'model-load') return;
          if (event.detail && typeof event.detail.totalProgress === 'number') setProgress(event.detail.totalProgress);
        });

        viewer.addEventListener('load', showReady, { once: true });
        viewer.addEventListener('error', showError, { once: true });

        failTimer = window.setTimeout(function () {
          if (!ready && !failed) showError();
        }, 30000);
      }).catch(showError);
    }

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function (entries) {
        stageInViewport = Boolean(entries[0] && entries[0].isIntersecting);
        syncViewerActivity();
      }, { rootMargin: '20% 0px', threshold: 0.01 });
      observer.observe(stage);
      stage.addEventListener('shopify:section:unload', function () { observer.disconnect(); }, { once: true });
    }

    document.addEventListener('visibilitychange', syncViewerActivity);
    stage.addEventListener('shopify:section:unload', function () {
      clearFailTimer();
      window.clearTimeout(rotateHintTimer);
      document.removeEventListener('visibilitychange', syncViewerActivity);
    }, { once: true });

    begin();
  }

  function mountAll(scope) {
    (scope || document).querySelectorAll('[data-pham-object-stage]').forEach(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(); }, { once: true });
  } else {
    mountAll();
  }

  document.addEventListener('shopify:section:load', function (event) { mountAll(event.target); });
})();