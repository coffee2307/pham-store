(function () {
  'use strict';

  function mount(stage) {
    if (stage.dataset.phamStageMounted === 'true') return;
    stage.dataset.phamStageMounted = 'true';
    const image = stage.querySelector('[data-pham-stage-image]');
    const model = stage.querySelector('[data-pham-stage-model]');
    const template = stage.querySelector('[data-pham-stage-model-template]');
    const mode = stage.querySelector('[data-pham-stage-mode]');
    const switches = Array.from(stage.querySelectorAll('[data-pham-stage-switch]'));
    let loaded = false;

    function show(view) {
      const useModel = view === 'model' && model && template;
      if (useModel && !loaded) {
        model.appendChild(template.content.cloneNode(true));
        loaded = true;
      }
      if (image) image.hidden = useModel;
      if (model) model.hidden = !useModel;
      if (mode) mode.textContent = useModel ? stage.dataset.modelModeLabel : stage.dataset.imageModeLabel;
      switches.forEach(function (button) {
        const active = button.dataset.phamStageSwitch === (useModel ? 'model' : 'image');
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    switches.forEach(function (button) {
      button.addEventListener('click', function () { show(button.dataset.phamStageSwitch); });
    });

    show(stage.dataset.defaultView || 'image');
  }

  function mountAll(scope) {
    (scope || document).querySelectorAll('[data-pham-object-stage]').forEach(mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mountAll(); }, { once: true });
  else mountAll();
  document.addEventListener('shopify:section:load', function (event) { mountAll(event.target); });
})();
