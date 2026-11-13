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
  const REVEAL_THRESHOLD   = 0.08;
  const REVEAL_ROOT_MARGIN = '0px 0px -6% 0px';
  const STAGGER_DELAY_MS   = 55;
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
        '.reveal-up:not(.is-visible), .stagger-children:not(.is-visible), .reveal-mask:not(.is-visible), .reveal-mask--up:not(.is-visible), .reveal-mask--down:not(.is-visible), .reveal-left:not(.is-visible), .reveal-right:not(.is-visible), .reveal-fade:not(.is-visible)'
      );
      nodes.forEach((n) => n.classList.add('is-visible'));
    }

    observe() {
      if (!this.observer) return;
      const nodes = document.querySelectorAll(
        '.reveal-up:not(.is-visible), .stagger-children:not(.is-visible), .reveal-mask:not(.is-visible), .reveal-mask--up:not(.is-visible), .reveal-mask--down:not(.is-visible), .reveal-left:not(.is-visible), .reveal-right:not(.is-visible), .reveal-fade:not(.is-visible)'
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
        const delayAttr = parseInt(target.getAttribute('data-pham-delay') || '0', 10);
        if (delayAttr > 0) {
          target.style.transitionDelay = delayAttr + 'ms';
        }
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
        child.style.transitionDelay = (Math.min(idx,4) * delay) + 'ms';
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

  /* Athena-aligned editorial reveal; never the only way to read content. */
  class PhamEditorialMotion {
    constructor() {
      this.seen = new WeakSet();
      this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.selectors = [
        'main h2:not(.reveal-up):not([data-pham-motion-ignore])',
        // Timeline chapters must stay opaque while the independent progress rail animates.
        '.pham-founder__obstacle',
        '.pham-founder__facts','.pham-founder__present',
        '.pham-founder__end-links','.pham-about__founder-facts',
        '.pham-about__resources','.pham-lookbook-v2__cell:not(.reveal-up)',
        '.pham-footer__col--menu','.pham-footer__col--story'
      ];
      this.io = !this.reduce.matches && 'IntersectionObserver' in window
        ? new IntersectionObserver(entries => entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            this.io.unobserve(entry.target);
          }), {threshold:.06,rootMargin:'0px 0px -6% 0px'}) : null;
      this.refresh();
      document.documentElement.classList.add('pham-motion-enabled');
      this.reduce.addEventListener?.('change', () => {
        if (this.reduce.matches) this.showAll();
      });
      document.addEventListener('focusin', event => {
        const el = event.target instanceof Element
          ? event.target.closest('[data-pham-motion]') : null;
        if (el) el.classList.add('is-visible');
      });
    }
    refresh() {
      document.querySelectorAll(this.selectors.join(',')).forEach(el => {
        if (this.seen.has(el) || el.closest('[hidden],[aria-hidden="true"],details:not([open]),form,dialog')) return;
        if (el.classList.contains('reveal-up') || el.classList.contains('reveal-fade')) return;
        this.seen.add(el);
        el.dataset.phamMotion = el.classList.contains('pham-founder__chapter') ? 'chapter'
          : el.classList.contains('pham-lookbook-v2__cell') ? 'image':'soft';
        const box=el.getBoundingClientRect();
        if (!this.io || this.reduce.matches || box.top < innerHeight*.94 || box.bottom<0)
          el.classList.add('is-visible');
        else this.io.observe(el);
      });
    }
    showAll() {
      this.io?.disconnect();
      document.querySelectorAll('[data-pham-motion]').forEach(el=>el.classList.add('is-visible'));
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
      // v2.0 (techwear) — body fade-in/out is intentionally disabled to
      // eliminate flash-of-unstyled-content (FOUC). Body stays opaque.
      // We keep the class for compatibility with downstream consumers but
      // no opacity transition is applied (see pham-theme.css §2).
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

      // Link interception is disabled in techwear v2.0 — Shopify's native
      // navigation is preferred for a snappier industrial feel.
      // (Original logic kept inside _onClick for future opt-in via
      // [data-pham-transition="true"] on a parent element.)
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
     MODULE 4 — Scroll Parallax (data-pham-parallax)
     ==================================================================== */
  class PhamParallax {
    constructor() {
      this.targets = [];
      this.ticking = false;
      this.io = null;
      this.activeSet = new Set();
      this.progressTargets = [];
      this._visible = () => {if (!document.hidden) this._requestUpdate()};
      this._init();
    }

    _init() {
      if (prefersReducedMotion) return;
      this.collect();
      this.io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) this.activeSet.add(entry.target);
          else this.activeSet.delete(entry.target);
        });
        if (this.activeSet.size > 0) this._requestUpdate();
      }, { rootMargin: '20% 0px 20% 0px', threshold: 0 });
      this.targets.forEach((t) => this.io.observe(t));
      window.addEventListener('scroll', () => this._requestUpdate(), { passive: true });
      window.addEventListener('resize', () => this._requestUpdate(), { passive: true });
      document.addEventListener('visibilitychange', this._visible);
      document.addEventListener('shopify:section:load', () => this.refresh());
    }

    collect() {
      const nodes = document.querySelectorAll('[data-pham-parallax], [data-pham-scroll-progress]');
      nodes.forEach((n) => {
        if (this.targets.indexOf(n) === -1) this.targets.push(n);
        if (n.hasAttribute('data-pham-scroll-progress') && !this.progressTargets.includes(n)) {
          this.progressTargets.push(n);
        }
      });
      this.progressTargets = this.progressTargets.filter(el => el.isConnected);
    }

    _requestUpdate() {
      if (prefersReducedMotion || document.hidden ||
          (!this.activeSet.size && !this.progressTargets.length) || this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => {
        this.ticking = false;
        if (!document.hidden) this._update();
      });
    }

    _update() {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      // Progress must be evaluated when offscreen too, otherwise it gets stuck
      // at 100% after the visitor scrolls back toward the hero.
      this.progressTargets.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const distance = Math.max(1, rect.height - vh * 0.28);
        const progress = Math.max(0, Math.min(1, (vh * 0.62 - rect.top) / distance));
        el.style.setProperty('--pham-story-progress', progress.toFixed(4));
      });
      this.activeSet.forEach((el) => {
        if (el.hasAttribute('data-pham-scroll-progress')) return;
        const rect = el.getBoundingClientRect();
        if (window.matchMedia('(max-width: 700px)').matches) {
          el.style.setProperty('--pham-parallax-y', '0px');
          return;
        }
        const speed = Number(el.getAttribute('data-pham-parallax-speed') || 0.15);
        if (!Number.isFinite(speed) || !speed) return;
        const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
        const y = Math.max(-16, Math.min(16, -progress * 100 * speed));
        el.style.setProperty('--pham-parallax-y', y.toFixed(2) + 'px');
      });
    }

    refresh() {
      this.collect();
      if (this.io) this.targets.forEach((t) => this.io.observe(t));
      this._requestUpdate();
    }
  }

  /* ====================================================================
     MODULE 5 — Counter (data-pham-counter, data-pham-counter-to)
     ==================================================================== */
  class PhamCounter {
    constructor() {
      this.bound = new WeakSet();
      this._init();
    }

    _init() {
      if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('[data-pham-counter]').forEach((el) => this._render(el, this._target(el)));
        return;
      }
      this.io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          if (this.bound.has(el)) return;
          this.bound.add(el);
          this._animate(el);
          this.io.unobserve(el);
        });
      }, { threshold: 0.4 });
      document.querySelectorAll('[data-pham-counter]').forEach((el) => this.io.observe(el));
      document.addEventListener('shopify:section:load', () => this.refresh());
    }

    _target(el) {
      return parseFloat(el.getAttribute('data-pham-counter-to') || '0') || 0;
    }

    _render(el, value) {
      const prefix = el.getAttribute('data-pham-counter-prefix') || '';
      const suffix = el.getAttribute('data-pham-counter-suffix') || '';
      const decimals = Number.isInteger(value) ? 0 : 1;
      el.textContent = prefix + value.toFixed(decimals) + suffix;
    }

    _animate(el) {
      if (prefersReducedMotion) {
        this._render(el, this._target(el));
        return;
      }
      const target = this._target(el);
      const duration = 1400;
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const current = target * eased;
        this._render(el, Number.isInteger(target) ? Math.round(current) : current);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    refresh() {
      document.querySelectorAll('[data-pham-counter]').forEach((el) => {
        if (this.bound.has(el)) return;
        if (this.io) this.io.observe(el);
      });
    }
  }

  /* ====================================================================
     MODULE 6 — Split Text (data-pham-split)
     ==================================================================== */
  class PhamSplitText {
    constructor() {
      this.bound = new WeakSet();
      this._init();
    }

    _init() {
      this._splitAll();
      if ('IntersectionObserver' in window) {
        this.io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-revealed');
              this.io.unobserve(entry.target);
            }
          });
        }, { threshold: 0.25 });
        document.querySelectorAll('[data-pham-split]').forEach((el) => this.io.observe(el));
      } else {
        document.querySelectorAll('[data-pham-split]').forEach((el) => el.classList.add('is-revealed'));
      }
      document.addEventListener('shopify:section:load', () => this.refresh());
    }

    _splitAll() {
      const nodes = document.querySelectorAll('[data-pham-split]');
      nodes.forEach((el) => this._split(el));
    }

    _split(el) {
      if (!el || this.bound.has(el)) return;
      this.bound.add(el);
      const text = el.textContent;
      const words = text.split(/(\s+)/);
      const frag = document.createDocumentFragment();
      let wordIdx = 0;
      words.forEach((part) => {
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
        } else {
          const wrap = document.createElement('span');
          wrap.className = 'pham-split__word';
          wrap.style.setProperty('--pham-split-delay', (wordIdx * 60) + 'ms');
          wrap.textContent = part;
          frag.appendChild(wrap);
          wordIdx++;
        }
      });
      el.textContent = '';
      el.appendChild(frag);
    }

    refresh() {
      this._splitAll();
      if (this.io) document.querySelectorAll('[data-pham-split]:not(.is-revealed)').forEach((el) => this.io.observe(el));
    }
  }


  class PhamCursorGlow {
    constructor() {
      this.enabled = !prefersReducedMotion &&
        window.matchMedia &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (!this.enabled) return;

      this.element = document.createElement('div');
      this.element.className = 'pham-cursor-glow';
      this.element.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.element);

      this.x = -160;
      this.y = -160;
      this.targetX = -160;
      this.targetY = -160;
      this.visible = false;
      this.frame = 0;

      this._move = this._move.bind(this);
      this._leave = this._leave.bind(this);
      this._draw = this._draw.bind(this);

      window.addEventListener('pointermove', this._move, { passive: true });
      document.documentElement.addEventListener('mouseleave', this._leave);
      window.addEventListener('blur', this._leave);
    }

    _move(event) {
      this.targetX = event.clientX;
      this.targetY = event.clientY;
      if (!this.visible) {
        this.visible = true;
        this.x = this.targetX;
        this.y = this.targetY;
        this.element.classList.add('is-visible');
      }
      const interactive = event.target instanceof Element &&
        event.target.closest('a, button, input, select, textarea, [role="button"], [data-pham-vault-orbit]');
      this.element.classList.toggle('is-interactive', Boolean(interactive));
      if (!this.frame) this.frame = requestAnimationFrame(this._draw);
    }

    _leave() {
      this.visible = false;
      this.element.classList.remove('is-visible', 'is-interactive');
    }

    _draw() {
      this.x += (this.targetX - this.x) * 0.22;
      this.y += (this.targetY - this.y) * 0.22;
      this.element.style.transform = 'translate3d(' + (this.x - 60).toFixed(1) + 'px,' + (this.y - 60).toFixed(1) + 'px,0)';
      this.frame = 0;
      if (this.visible && (Math.abs(this.targetX - this.x) > 0.15 || Math.abs(this.targetY - this.y) > 0.15)) {
        this.frame = requestAnimationFrame(this._draw);
      }
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
      const startCore = () => {
        try { this.modules.scrollReveal = new PhamScrollReveal(); } catch (e) { console.error('[PHAM] ScrollReveal failed:', e); }
        try { this.modules.editorialMotion = new PhamEditorialMotion(); } catch (e) { console.error('[PHAM] EditorialMotion failed:', e); }
        try { this.modules.pageTransition = new PhamPageTransition(); } catch (e) { console.error('[PHAM] PageTransition failed:', e); }
      };

      const startEnhancements = () => {
        try { this.modules.cursorGlow = new PhamCursorGlow(); } catch (e) { console.error('[PHAM] CursorGlow failed:', e); }
        if (document.querySelector('.pham-product-card [data-pham-img-secondary]')) {
          try { this.modules.productCardHover = new PhamProductCardHover(); } catch (e) { console.error('[PHAM] ProductCardHover failed:', e); }
        }
        if (document.querySelector('[data-pham-parallax], [data-pham-scroll-progress]')) {
          try { this.modules.parallax = new PhamParallax(); } catch (e) { console.error('[PHAM] Parallax failed:', e); }
        }
        if (document.querySelector('[data-pham-counter]')) {
          try { this.modules.counter = new PhamCounter(); } catch (e) { console.error('[PHAM] Counter failed:', e); }
        }
        if (document.querySelector('[data-pham-split]')) {
          try { this.modules.splitText = new PhamSplitText(); } catch (e) { console.error('[PHAM] SplitText failed:', e); }
        }
      };

      const bindRefresh = () => {
        document.addEventListener('shopify:section:load', () => this.refresh());
        document.addEventListener('shopify:section:reorder', () => this.refresh());
        document.addEventListener('pham:refresh', () => this.refresh());
      };

      const onReady = () => {
        startCore();
        bindRefresh();
        if ('requestIdleCallback' in window) {
          requestIdleCallback(startEnhancements, { timeout: 1200 });
        } else {
          startEnhancements();
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
      } else {
        onReady();
      }
    }

    refresh() {
      if (this.modules.scrollReveal)     this.modules.scrollReveal.refresh();
      if (this.modules.editorialMotion)  this.modules.editorialMotion.refresh();
      if (this.modules.productCardHover) this.modules.productCardHover.refresh();
      if (this.modules.parallax)         this.modules.parallax.refresh();
      if (this.modules.counter)          this.modules.counter.refresh();
      if (this.modules.splitText)        this.modules.splitText.refresh();
    }
  }

  window.PhamAnimations = new PhamAnimationsController();
})();
