/* PHAM immersive hero — lightweight pointer depth, no WebGL dependency. */
(function () {
  'use strict';
  if (window.__PHAM_IMMERSIVE_HERO__) return;
  window.__PHAM_IMMERSIVE_HERO__ = true;

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mount(hero) {
    if (!hero || hero.dataset.phamImmersiveMounted === 'true') return;
    hero.dataset.phamImmersiveMounted = 'true';
    if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

    let frame = null;
    let targetX = 0;
    let targetY = 0;

    function render() {
      frame = null;
      hero.style.setProperty('--ph-ry', (8 + targetX * 9).toFixed(2) + 'deg');
      hero.style.setProperty('--ph-rx', (-7 - targetY * 7).toFixed(2) + 'deg');
      hero.style.setProperty('--ph-x', (targetX * 10).toFixed(1) + 'px');
      hero.style.setProperty('--ph-y', (targetY * 8).toFixed(1) + 'px');
    }

    hero.addEventListener('pointermove', function (event) {
      const rect = hero.getBoundingClientRect();
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      if (!frame) frame = requestAnimationFrame(render);
    }, { passive: true });

    hero.addEventListener('pointerleave', function () {
      targetX = 0;
      targetY = 0;
      if (!frame) frame = requestAnimationFrame(render);
    }, { passive: true });
  }

  function mountAll(scope) {
    (scope || document).querySelectorAll('[data-pham-immersive-hero]').forEach(mount);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mountAll(); }, { once: true });
  else mountAll();

  document.addEventListener('shopify:section:load', function (event) { mountAll(event.target); });
})();