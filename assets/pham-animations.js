// @ts-nocheck
/* ==========================================================================
   PHAM — Animation System Controller
   "Silence is luxury. Restraint is power."
   --------------------------------------------------------------------------
   File:    assets/pham-animations.js
   Phase:   3 — Unified Vanilla ES6+ Animation Framework
   --------------------------------------------------------------------------
   DO NOT EDIT — managed by PHAM theme architecture

   This is a self-contained, zero-dependency, strict-mode ES6+ controller
   composed of three modules:

     1. PhamScrollReveal       — IntersectionObserver-driven .reveal-up
                                 and staggered .stagger-children entrances.
     2. PhamPageTransition     — Preloader fade-out + intercepted internal
                                 link click → 300ms mask → navigate.
     3. PhamProductCardHover   — Zero-layout-shift opacity crossfade
                                 between primary & secondary product images.

   The single global `window.PhamAnimations` exposes a public `refresh()`
   method so other PHAM components (cart drawer, AJAX load-more, etc.) can
   trigger a rebind when DOM is mutated.
   ========================================================================== */

'use strict';

(function () {
  /* ---- Idempotency guard --------------------------------------------- */
  if (window.__PHAM_ANIMATIONS_BOOTED__) return;
  window.__PHAM_ANIMATIONS_BOOTED__ = true;

  /* ---- Mark JS available so CSS can opt into transitions ------------- */
  document.documentElement.classList.add('pham-js');

  /* ---- Local constants ----------------------------------------------- */
  const REVEAL_THRESHOLD   = 0.15;
  const REVEAL_ROOT_MARGIN = '0px 0px -8% 0px';
  const STAGGER_DELAY_MS   = 80;
  const TRANSITION_MS      = 300;
  const SAFE_NAVIGATE_TIMEOUT_MS = 1500;

  const prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ====================================================================
     MODULE 1 — Scroll Reveal
     ==================================================================== */
  class PhamScrollReveal {
    constructor() {
      this.observer = null;
      this.observed = new WeakSet();
      this._init();
    }

    _init() {
      if (prefersReducedMotion || !('IntersectionObserver' in window)) {
        this._revealAllNow();
        return;
      }

      this.observer = new IntersectionObserver(
        (entries) => this._onEntries(entries),
        { threshold: REVEAL_THRESHOLD, rootMargin: REVEAL_ROOT_MARGIN }
      );

      this.observe();
    }

    _revealAllNow() {
      const nodes = document.querySelectorAll(
        '.reveal-up:not(.is-visible), .stagger-children:not(.is-visible)'
      );
      nodes.forEach((n) => n.classList.add('is-visible'));
    }

    observe() {
      if (!this.observer) return;
      const nodes = document.querySelectorAll(
        '.reveal-up:not(.is-visible), .stagger-children:not(.is-visible)'
      );
      nodes.forEach((el) => {
        if (this.observed.has(el)) return;
        this.observed.add(el);
        this.observer.observe(el);
      });
    }

    _onEntries(entries) {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target;
        if (target.classList.contains('stagger-children')) {
          this._applyStagger(target);
        }
        target.classList.add('is-visible');
        this.observer.unobserve(target);
      });
    }

    _applyStagger(parent) {
      const children = Array.from(parent.children);
      const delay = Number(parent.dataset.staggerDelay) || STAGGER_DELAY_MS;
      children.forEach((child, idx) => {
        child.style.transitionDelay = (idx * delay) + 'ms';
      });
    }

    refresh() {
      this.observe();
    }

    destroy() {
      if (this.observer) this.observer.disconnect();
      this.observer = null;
    }
  }

  /* ====================================================================
     MODULE 2 — Page Transition (preloader + link interception)
     ==================================================================== */
  class PhamPageTransition {
    constructor() {
      this.duration = TRANSITION_MS;
      this.preloader = document.getElementById('pham-preloader');
      this.transitioning = false;
      this.boundClick = (e) => this._onClick(e);
      this.boundPageShow = (e) => this._onPageShow(e);
      this._init();
    }

    _init() {
      requestAnimationFrame(() => {
        document.body.classList.add('pham-page-ready');
      });

      if (this.preloader) {
        if (document.readyState === 'complete') {
          this._fadeOutPreloader();
        } else {
          window.addEventListener('load', () => this._fadeOutPreloader(), { once: true });
        }
      }

      if (!this._horizonOwnsTransitions()) {
        document.addEventListener('click', this.boundClick, true);
      }

      window.addEventListener('pageshow', this.boundPageShow);
    }

    _horizonOwnsTransitions() {
      const main = document.querySelector('main[data-page-transition-enabled="true"]');
      return Boolean(main);
    }

    _fadeOutPreloader() {
      if (!this.preloader) return;
      requestAnimationFrame(() => {
        this.preloader.classList.add('is-hidden');
        setTimeout(() => {
          if (this.preloader && this.preloader.parentNode) {
            this.preloader.setAttribute('aria-hidden', 'true');
          }
        }, 1200);
      });
    }

    _showExitMask() {
      document.body.classList.add('pham-page-exiting');
      if (this.preloader) {
        this.preloader.removeAttribute('aria-hidden');
        this.preloader.classList.remove('is-hidden');
      }
    }

    _onPageShow(evt) {
      if (evt.persisted) {
        this.transitioning = false;
        document.body.classList.remove('pham-page-exiting');
        document.body.classList.add('pham-page-ready');
        if (this.preloader) this.preloader.classList.add('is-hidden');
      }
    }

    _isQualifyingAnchor(anchor) {
      if (!anchor || !anchor.href) return false;
      if (anchor.target && anchor.target !== '' && anchor.target !== '_self') return false;
      if (anchor.hasAttribute('download')) return false;
      if (anchor.dataset.phamTransition === 'false') return false;
      if (anchor.dataset.noTransition !== undefined) return false;
      if (anchor.getAttribute('rel') && anchor.getAttribute('rel').includes('external')) return false;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref) return false;
      if (rawHref.startsWith('#')) return false;
      if (/^(mailto:|tel:|javascript:|sms:|whatsapp:)/i.test(rawHref)) return false;

      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch (e) {
        return false;
      }
      if (url.origin !== window.location.origin) return false;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return false;
      }

      if (/\/cart\/(add|change|update|clear)/.test(url.pathname)) return false;
      if (url.pathname.endsWith('.pdf')) return false;
      if (url.pathname.endsWith('.zip')) return false;

      return true;
    }

    _onClick(evt) {
      if (this.transitioning) return;
      if (evt.defaultPrevented) return;
      if (evt.button !== 0) return;
      if (evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey) return;

      const anchor = evt.target instanceof Element ? evt.target.closest('a[href]') : null;
      if (!anchor) return;
      if (anchor.closest('[data-pham-no-transition]')) return;
      if (!this._isQualifyingAnchor(anchor)) return;

      evt.preventDefault();
      evt.stopPropagation();
      this.transitioning = true;

      const destination = anchor.href;
      this._showExitMask();

      const navigate = () => {
        if (!this.transitioning) return;
        this.transitioning = false;
        window.location.assign(destination);
      };

      let navigated = false;
      const guarded = () => {
        if (navigated) return;
        navigated = true;
        navigate();
      };

      setTimeout(guarded, this.duration);
      setTimeout(guarded, SAFE_NAVIGATE_TIMEOUT_MS);
    }

    destroy() {
      document.removeEventListener('click', this.boundClick, true);
      window.removeEventListener('pageshow', this.boundPageShow);
    }
  }

  /* ====================================================================
     MODULE 3 — Product Card Hover (image crossfade)
     ==================================================================== */
  class PhamProductCardHover {
    constructor() {
      this.bound = new WeakSet();
      this._init();
    }

    _init() {
      this.bindAll();
      document.addEventListener('shopify:section:load', () => this.bindAll());
      document.addEventListener('shopify:section:reorder', () => this.bindAll());
      document.addEventListener('pham:cards:bind', () => this.bindAll());
    }

    bindAll() {
      const cards = document.querySelectorAll('.pham-product-card');
      cards.forEach((card) => this._bindCard(card));
    }

    _bindCard(card) {
      if (!card || this.bound.has(card)) return;

      const primary = card.querySelector('[data-pham-img-primary]');
      const secondary = card.querySelector('[data-pham-img-secondary]');
      if (!primary || !secondary) return;

      this.bound.add(card);

      primary.style.transition = 'opacity var(--duration-base) var(--ease-luxury)';
      secondary.style.transition = 'opacity var(--duration-base) var(--ease-luxury)';
      primary.style.opacity = '1';
      secondary.style.opacity = '0';

      const enter = () => {
        primary.style.opacity = '0';
        secondary.style.opacity = '1';
      };
      const leave = () => {
        primary.style.opacity = '1';
        secondary.style.opacity = '0';
      };

      card.addEventListener('mouseenter', enter);
      card.addEventListener('mouseleave', leave);
      card.addEventListener('focusin', enter);
      card.addEventListener('focusout', leave);
    }

    refresh() {
      this.bindAll();
    }
  }

  /* ====================================================================
     CONTROLLER — Boot orchestration
     ==================================================================== */
  class PhamAnimationsController {
    constructor() {
      this.modules = Object.create(null);
      this._boot();
    }

    _boot() {
      const start = () => {
        try { this.modules.scrollReveal     = new PhamScrollReveal();     } catch (e) { console.error('[PHAM] ScrollReveal failed:', e); }
        try { this.modules.pageTransition   = new PhamPageTransition();   } catch (e) { console.error('[PHAM] PageTransition failed:', e); }
        try { this.modules.productCardHover = new PhamProductCardHover(); } catch (e) { console.error('[PHAM] ProductCardHover failed:', e); }

        document.addEventListener('shopify:section:load',    () => this.refresh());
        document.addEventListener('shopify:section:reorder', () => this.refresh());
        document.addEventListener('pham:refresh',            () => this.refresh());
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
    }

    refresh() {
      if (this.modules.scrollReveal)     this.modules.scrollReveal.refresh();
      if (this.modules.productCardHover) this.modules.productCardHover.refresh();
    }
  }

  window.PhamAnimations = new PhamAnimationsController();
})();
