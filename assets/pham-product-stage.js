(function () {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MODEL_VIEWER_SRC = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const constrainedNetwork = Boolean(
    connection &&
    (connection.saveData || /(^|-)2g$/i.test(connection.effectiveType || ''))
  );

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
    let viewerEl = null;
    let stageInViewport = true;
    let defaultModelTimer = 0;
    let defaultModelIdleHandle = 0;
    let defaultModelLoadHandler = null;
    let displayedProgress = 0;

    function setModeLabel(label) {
      if (mode) mode.textContent = label || '';
    }

    function setProgress(value, reset) {
      let normalized = Math.max(0, Math.min(1, Number(value) || 0));
      if (reset) displayedProgress = 0;
      normalized = Math.max(displayedProgress, normalized);
      displayedProgress = normalized;

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

    function syncViewerActivity() {
      if (!viewerEl) return;
      const shouldRotate =
        !reducedMotion &&
        ready &&
        desiredView === 'model' &&
        stageInViewport &&
        !document.hidden;
      if (shouldRotate) viewerEl.setAttribute('auto-rotate', '');
      else viewerEl.removeAttribute('auto-rotate');
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
      if (model) {
        model.hidden = true;
        model.classList.remove('is-preloading');
        model.removeAttribute('aria-hidden');
      }
      syncSwitcher('image');
      setLoaderVisible(false);
      setErrorVisible(false);
      setModeLabel(stage.dataset.imageModeLabel);
      syncViewerActivity();
    }

    function showModelReady() {
      if (!ready || !model) return;
      if (image) image.hidden = true;
      model.hidden = false;
      model.classList.remove('is-preloading');
      model.removeAttribute('aria-hidden');
      syncSwitcher('model');
      setLoaderVisible(false);
      setErrorVisible(false);
      setModeLabel(stage.dataset.modelModeLabel);
      stage.classList.add('is-model-ready');
      stage.classList.remove('is-model-loading', 'is-model-error');
      syncViewerActivity();
      showRotateHint();
    }

    function showModelLoading() {
      hideRotateHint();
      if (image) image.hidden = false;
      if (model) {
        // Keep the model connected and laid out while loading. A hidden
        // lazy-loaded <model-viewer> can otherwise wait forever for viewport
        // intersection and leave the loader stuck at 00%.
        model.hidden = false;
        model.classList.add('is-preloading');
        model.setAttribute('aria-hidden', 'true');
      }
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
      if (model) {
        model.hidden = true;
        model.classList.remove('is-preloading');
        model.removeAttribute('aria-hidden');
      }
      setLoaderVisible(false);
      setErrorVisible(true);
      setModeLabel(stage.dataset.errorModeLabel || stage.dataset.imageModeLabel);
      stage.classList.add('is-model-error');
      stage.classList.remove('is-model-loading', 'is-model-ready');
      // Keep the 3D control available so a transient network failure can be
      // retried without reloading the entire product page.
    }

    function clearFailTimer() {
      if (!failTimer) return;
      window.clearTimeout(failTimer);
      failTimer = 0;
    }

    function armFailTimer(delay) {
      clearFailTimer();
      failTimer = window.setTimeout(function () {
        if (ready || failed) return;
        failed = true;
        ready = false;
        showModelError();
      }, delay || 22000);
    }

    function resetModelAttempt() {
      clearFailTimer();
      failed = false;
      ready = false;
      requested = false;
      displayedProgress = 0;
      setProgress(0, true);

      if (viewerEl && viewerEl.parentNode) viewerEl.parentNode.removeChild(viewerEl);
      viewerEl = null;

      if (model) {
        model.hidden = true;
        model.classList.remove('is-preloading');
        model.removeAttribute('aria-hidden');
      }

      switches.forEach(function (button) {
        if (button.dataset.phamStageSwitch === 'model') {
          button.disabled = false;
          button.removeAttribute('aria-disabled');
        }
      });
    }

    function configureModel(viewer) {
      if (!viewer) return;
      viewerEl = viewer;
      viewer.setAttribute('reveal', 'auto');
      // Once 3D has been explicitly requested, load immediately. The model
      // container is intentionally transparent during preload, not hidden.
      viewer.setAttribute('loading', 'eager');
      viewer.setAttribute('interaction-prompt', 'none');
      viewer.setAttribute('disable-pan', '');
      viewer.setAttribute('disable-zoom', '');
      syncViewerActivity();

      viewer.addEventListener('pointerdown', hideRotateHint, { passive: true });
      viewer.addEventListener('keydown', hideRotateHint);

      viewer.addEventListener('progress', function (event) {
        if (event.detail && event.detail.reason && event.detail.reason !== 'model-load') return;
        if (event.detail && typeof event.detail.totalProgress === 'number') {
          setProgress(event.detail.totalProgress);
          // Treat progress as proof that the transfer is alive. Only fail if
          // it stalls completely for a sustained period.
          armFailTimer(22000);
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

      // Start above zero so the interface communicates that the request has
      // actually been dispatched even before model-viewer emits byte progress.
      setProgress(0.02, true);

      let libraryTimeout = 0;
      const libraryDeadline = new Promise(function (_, reject) {
        libraryTimeout = window.setTimeout(function () {
          reject(new Error('model-viewer library timeout'));
        }, 12000);
      });

      Promise.race([ensureModelViewerLibrary(), libraryDeadline]).then(function () {
        window.clearTimeout(libraryTimeout);
        if (failed || model.querySelector('model-viewer')) return;

        setProgress(0.06);
        model.appendChild(template.content.cloneNode(true));
        configureModel(model.querySelector('model-viewer'));
        armFailTimer(22000);
      }).catch(function () {
        window.clearTimeout(libraryTimeout);
        clearFailTimer();
        failed = true;
        ready = false;
        showModelError();
      });
    }

    function cancelDeferredDefaultModel() {
      if (defaultModelTimer) {
        window.clearTimeout(defaultModelTimer);
        defaultModelTimer = 0;
      }
      if (defaultModelIdleHandle && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(defaultModelIdleHandle);
        defaultModelIdleHandle = 0;
      }
      if (defaultModelLoadHandler) {
        window.removeEventListener('load', defaultModelLoadHandler);
        defaultModelLoadHandler = null;
      }
    }

    function scheduleDefaultModel() {
      if (requested || failed || !model || !template) return;

      function queueAfterLoad() {
        defaultModelLoadHandler = null;
        const fallbackDelay = window.innerWidth < 600 ? 700 : 320;

        if ('requestIdleCallback' in window) {
          defaultModelIdleHandle = window.requestIdleCallback(function () {
            defaultModelIdleHandle = 0;
            if (desiredView === 'model' && !requested && !failed) show('model', true);
          }, { timeout: window.innerWidth < 600 ? 1800 : 1200 });
        } else {
          defaultModelTimer = window.setTimeout(function () {
            defaultModelTimer = 0;
            if (desiredView === 'model' && !requested && !failed) show('model', true);
          }, fallbackDelay);
        }
      }

      if (document.readyState === 'complete') {
        queueAfterLoad();
      } else {
        defaultModelLoadHandler = queueAfterLoad;
        window.addEventListener('load', defaultModelLoadHandler, { once: true });
      }
    }

    function show(view, deferred) {
      desiredView = view === 'model' ? 'model' : 'image';

      if (!deferred) cancelDeferredDefaultModel();

      if (desiredView === 'image') {
        showImage();
        return;
      }
      if (failed) {
        resetModelAttempt();
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

    if ('IntersectionObserver' in window) {
      const activityObserver = new IntersectionObserver(function (entries) {
        stageInViewport = Boolean(entries[0] && entries[0].isIntersecting);
        syncViewerActivity();
      }, { rootMargin: '20% 0px', threshold: 0.01 });
      activityObserver.observe(stage);
    }

    document.addEventListener('visibilitychange', syncViewerActivity);

    stage.addEventListener('shopify:section:unload', function () {
      cancelDeferredDefaultModel();
      clearFailTimer();
      window.clearTimeout(rotateHintTimer);
      if (observer) observer.disconnect();
      document.removeEventListener('visibilitychange', syncViewerActivity);
    }, { once: true });

    if (defaultView === 'model' && model && template && !constrainedNetwork) {
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(function (entries) {
          if (!entries[0] || !entries[0].isIntersecting) return;
          observer.disconnect();
          observer = null;
          scheduleDefaultModel();
        }, { rootMargin: '240px 0px', threshold: 0.01 });
        observer.observe(stage);
      } else {
        scheduleDefaultModel();
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