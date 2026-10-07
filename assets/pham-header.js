// @ts-nocheck
/* ==========================================================================
   PHAM — Silent Dynamic Header Controller
   "Silence is luxury. Restraint is power."
   --------------------------------------------------------------------------
   File:    assets/pham-header.js
   Phase:   4 — Sticky-Hide Header + Accessible Mobile Drawer
   --------------------------------------------------------------------------
   DO NOT EDIT — managed by PHAM theme architecture

   - rAF-throttled scroll listener
   - Hides the header on scroll-down past 80px, reveals on scroll-up
   - Adds `pham-header--scrolled` after the threshold for styling
   - Accessible hamburger trigger (aria-expanded, aria-controls)
   - Mobile drawer with body scroll lock, focus trap, ESC to close
   - Auto-rebinds on shopify:section:load / shopify:section:reorder
   ========================================================================== */

'use strict';

(function () {
  if (window.__PHAM_HEADER_BOOTED__) return;
  window.__PHAM_HEADER_BOOTED__ = true;

  const HEADER_SELECTOR  = '[data-pham-header]';
  const HIDDEN_CLASS     = 'pham-header--hidden';
  const SCROLLED_CLASS   = 'pham-header--scrolled';
  const MENU_OPEN_CLASS  = 'pham-header--menu-open';
  const HIDE_THRESHOLD   = 80;
  const SCROLL_DELTA_MIN = 4;

  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  /* ====================================================================
     PhamHeader instance
     ==================================================================== */
  class PhamHeader {
    constructor(el) {
      this.el = el;
      this.lastY = window.scrollY;
      this.ticking = false;
      this.menuOpen = false;
      this.lastFocused = null;

      this.toggle   = el.querySelector('[data-pham-menu-toggle]');
      const sectionRoot = el.closest('.pham-header-section') || el.parentElement;
      this.drawer   = sectionRoot ? sectionRoot.querySelector('[data-pham-mobile-drawer]') : null;
      this.closeBtn = this.drawer ? this.drawer.querySelector('[data-pham-menu-close]') : null;
      this.backdrop = this.drawer ? this.drawer.querySelector('[data-pham-menu-backdrop]') : null;

      this._onScroll   = this._onScroll.bind(this);
      this._onKeydown  = this._onKeydown.bind(this);
      this._onFocusIn  = this._onFocusIn.bind(this);
      this._onResize   = this._onResize.bind(this);

      this._init();
    }

    _init() {
      window.addEventListener('scroll', this._onScroll, { passive: true });
      window.addEventListener('resize', this._onResize, { passive: true });

      if (this.toggle) {
        this.toggle.addEventListener('click', () => {
          if (this.menuOpen) this.closeMenu();
          else this.openMenu();
        });
      }
      if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.closeMenu());
      if (this.backdrop) this.backdrop.addEventListener('click', () => this.closeMenu());

      const cartTriggers = this.el.querySelectorAll('[data-pham-cart-open]');
      cartTriggers.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          document.dispatchEvent(new CustomEvent('pham:cart:open'));
        });
      });

      const drawerCartTriggers = this.drawer
        ? this.drawer.querySelectorAll('[data-pham-cart-open]')
        : [];
      drawerCartTriggers.forEach((btn) => {
        btn.addEventListener('click', () => this.closeMenu());
      });
    }

    /* ---- Scroll behavior ---- */
    _onScroll() {
      if (this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => this._update());
    }

    _update() {
      const y = window.scrollY;
      const delta = y - this.lastY;

      if (y > HIDE_THRESHOLD) {
        this.el.classList.add(SCROLLED_CLASS);
      } else {
        this.el.classList.remove(SCROLLED_CLASS);
      }

      if (Math.abs(delta) >= SCROLL_DELTA_MIN && !this.menuOpen) {
        if (delta > 0 && y > HIDE_THRESHOLD) {
          this.el.classList.add(HIDDEN_CLASS);
        } else if (delta < 0) {
          this.el.classList.remove(HIDDEN_CLASS);
        }
      }

      if (y <= 0) {
        this.el.classList.remove(HIDDEN_CLASS);
      }

      this.lastY = y;
      this.ticking = false;
    }

    _onResize() {
      if (window.innerWidth > 900 && this.menuOpen) {
        this.closeMenu();
      }
    }

    /* ---- Mobile drawer ---- */
    openMenu() {
      if (this.menuOpen || !this.drawer) return;
      this.menuOpen = true;
      this.lastFocused = document.activeElement;

      this.el.classList.add(MENU_OPEN_CLASS);
      this.drawer.classList.add('is-open');
      this.drawer.setAttribute('aria-hidden', 'false');

      if (this.toggle) {
        this.toggle.setAttribute('aria-expanded', 'true');
        this.toggle.setAttribute('aria-label', 'Close menu');
      }

      document.body.style.overflow = 'hidden';
      document.body.classList.add('pham-no-scroll');

      document.addEventListener('keydown', this._onKeydown);
      document.addEventListener('focusin', this._onFocusIn);

      requestAnimationFrame(() => {
        const focusables = this._getFocusable();
        if (focusables.length > 0) focusables[0].focus();
      });
    }

    closeMenu() {
      if (!this.menuOpen || !this.drawer) return;
      this.menuOpen = false;

      this.el.classList.remove(MENU_OPEN_CLASS);
      this.drawer.classList.remove('is-open');
      this.drawer.setAttribute('aria-hidden', 'true');

      if (this.toggle) {
        this.toggle.setAttribute('aria-expanded', 'false');
        this.toggle.setAttribute('aria-label', 'Open menu');
      }

      document.body.style.overflow = '';
      document.body.classList.remove('pham-no-scroll');

      document.removeEventListener('keydown', this._onKeydown);
      document.removeEventListener('focusin', this._onFocusIn);

      if (this.lastFocused && typeof this.lastFocused.focus === 'function') {
        try { this.lastFocused.focus(); } catch (e) { /* element gone */ }
      } else if (this.toggle) {
        this.toggle.focus();
      }
      this.lastFocused = null;
    }

    _onKeydown(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        this.closeMenu();
        return;
      }
      if (e.key === 'Tab') {
        this._trapFocus(e);
      }
    }

    _onFocusIn(e) {
      if (!this.drawer || !this.menuOpen) return;
      if (this.drawer.contains(e.target)) return;
      const focusables = this._getFocusable();
      if (focusables.length > 0) {
        e.stopPropagation();
        focusables[0].focus();
      }
    }

    _trapFocus(e) {
      const focusables = this._getFocusable();
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !this.drawer.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    _getFocusable() {
      if (!this.drawer) return [];
      return Array.from(this.drawer.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((el) => {
          if (el.hasAttribute('disabled')) return false;
          if (el.getAttribute('aria-hidden') === 'true') return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          return true;
        });
    }

    destroy() {
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('resize', this._onResize);
      document.removeEventListener('keydown', this._onKeydown);
      document.removeEventListener('focusin', this._onFocusIn);
    }
  }

  /* ====================================================================
     Boot — binds to every header instance, idempotent
     ==================================================================== */
  const bound = new WeakSet();

  function bindAll() {
    document.querySelectorAll(HEADER_SELECTOR).forEach((el) => {
      if (bound.has(el)) return;
      bound.add(el);
      try {
        new PhamHeader(el);
      } catch (err) {
        console.error('[PHAM header] init failed:', err);
      }
    });
  }

  function boot() {
    bindAll();
    document.addEventListener('shopify:section:load',    bindAll);
    document.addEventListener('shopify:section:reorder', bindAll);
    document.addEventListener('pham:header:bind',        bindAll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
