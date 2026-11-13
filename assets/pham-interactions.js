/* PHAM INTERACTIONS — progressive, accessible controls */
(() => {
  'use strict';
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = 350;
  const easing = 'cubic-bezier(.22,.7,.2,1)';

  function animateAccordion(details) {
    const body = details.querySelector(':scope > .pham-accordion__body, :scope > .pham-campaign-expander__body');
    if (!body || reduceMotion() || !body.animate) { details.open = !details.open; return; }
    if (details.dataset.phamAccordionBusy === 'true') return;
    const opening = !details.open;
    details.dataset.phamAccordionBusy = 'true';
    if (opening) details.open = true;
    const fullHeight = body.scrollHeight;
    const startHeight = opening ? 0 : body.getBoundingClientRect().height;
    const endHeight = opening ? fullHeight : 0;
    const animation = body.animate(
      [{ height: startHeight+'px', opacity: opening ? 0 : 1 },
       { height: endHeight+'px', opacity: opening ? 1 : 0 }],
      { duration, easing, fill: 'forwards' }
    );
    const finish = () => {
      if (!opening) details.open = false;
      animation.cancel();
      delete details.dataset.phamAccordionBusy;
    };
    animation.finished.then(finish).catch(() => {
      animation.cancel();
      delete details.dataset.phamAccordionBusy;
    });
  }
  document.addEventListener('click', event => {
    const summary = event.target instanceof Element
      ? event.target.closest('details.pham-accordion > summary, details.pham-campaign-expander > summary') : null;
    if (summary) {
      event.preventDefault();
      animateAccordion(summary.parentElement);
    }
  });

  // Smooth in-page links, honoring reduced motion and the existing fixed header.
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest('a[href*="#"]') : null;
    if (!anchor || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
    let url;
    try { url = new URL(anchor.href, location.href); } catch (_) { return; }
    if (!url.hash || url.hash === '#' || url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
    let id;
    try { id = decodeURIComponent(url.hash.slice(1)); } catch (_) { id = url.hash.slice(1); }
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const header = document.querySelector('.pham-header');
    const offset = header ? header.getBoundingClientRect().height+18 : 18;
    const top = window.scrollY + target.getBoundingClientRect().top - offset;
    history.replaceState(null,'',url.hash);
    window.scrollTo({ top: Math.max(0,top), behavior: reduceMotion()?'instant':'smooth' });
    // Do not steal focus if target cannot receive it.
  });
})();
