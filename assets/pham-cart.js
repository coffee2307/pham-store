// @ts-nocheck
/* ==========================================================================
   PHAM — AJAX Cart Drawer Controller
   "Silence is luxury. Restraint is power."
   --------------------------------------------------------------------------
   File:    assets/pham-cart.js
   Phase:   4 — Cart AJAX + Section Rendering API + Recommendations
   --------------------------------------------------------------------------
   DO NOT EDIT — managed by PHAM theme architecture

   - Event-delegated submit/click/change on document.body
   - Intercepts every form posting to /cart/add(.js) and posts as JSON
   - Refreshes [data-pham-cart-drawer] via Shopify Section Rendering API
     against the section ID `pham-cart-drawer`
   - Quantity +/− and remove triggers post to /cart/change.js
   - After each successful add, fetches
     /recommendations/products.json?product_id=…&limit=3 and injects
     into [data-cart-recommendations]
   - Listens to custom events: pham:cart:open, pham:cart:close, pham:cart:refresh
   - Dispatches: pham:cart:opened, pham:cart:closed, pham:cart:added,
     pham:cart:updated, pham:cart:error
   ========================================================================== */

'use strict';

(function () {
  if (window.__PHAM_CART_BOOTED__) return;
  window.__PHAM_CART_BOOTED__ = true;

  const DRAWER_SELECTOR     = '[data-pham-cart-drawer]';
  const BACKDROP_SELECTOR   = '[data-pham-cart-backdrop]';
  const CART_SECTION_ID     = 'pham-cart-drawer';
  const RECOMMENDATION_LIMIT = 3;

  const CART_ADD_URL    = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root)
                            ? `${window.Shopify.routes.root}cart/add.js`
                            : '/cart/add.js';
  const CART_CHANGE_URL = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root)
                            ? `${window.Shopify.routes.root}cart/change.js`
                            : '/cart/change.js';
  const CART_GET_URL    = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root)
                            ? `${window.Shopify.routes.root}cart.js`
                            : '/cart.js';
  const RECS_URL        = '/recommendations/products.json';

  /* ====================================================================
     Utility: HTML escape for safe string interpolation
     ==================================================================== */
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function formatMoney(cents) {
    if (typeof cents !== 'number' || !isFinite(cents)) return '';
    const currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency
      }).format(cents / 100);
    } catch (e) {
      return `$${(cents / 100).toFixed(2)}`;
    }
  }

  /* ====================================================================
     PhamCart class
     ==================================================================== */
  class PhamCart {
    constructor() {
      this.drawer = null;
      this.busy = false;
      this.lastFocused = null;
      this.boundKeydown = this._onKeydown.bind(this);
      this._init();
    }

    _init() {
      this._refreshDrawerRef();

      document.body.addEventListener('submit', (e) => this._onSubmit(e));
      document.body.addEventListener('click',  (e) => this._onClick(e));
      document.body.addEventListener('change', (e) => this._onChange(e));

      document.addEventListener('pham:cart:open',    () => this.open());
      document.addEventListener('pham:cart:close',   () => this.close());
      document.addEventListener('pham:cart:refresh', () => this.refresh());
    }

    _refreshDrawerRef() {
      this.drawer = document.querySelector(DRAWER_SELECTOR);
    }

    /* ---- Delegated submit: cart-add forms ---- */
    _onSubmit(evt) {
      const form = evt.target instanceof Element
        ? evt.target.closest('form[action*="/cart/add"]')
        : null;
      if (!form) return;
      if (form.hasAttribute('data-pham-no-ajax')) return;

      evt.preventDefault();
      this.add(form);
    }

    /* ---- Delegated click: open, close, qty +/−, remove ---- */
    _onClick(evt) {
      const target = evt.target instanceof Element ? evt.target : null;
      if (!target) return;

      const openTrigger = target.closest('[data-pham-cart-open]');
      if (openTrigger) {
        evt.preventDefault();
        this.open();
        return;
      }

      const closeTrigger = target.closest('[data-pham-cart-close]');
      if (closeTrigger) {
        evt.preventDefault();
        this.close();
        return;
      }

      const backdrop = target.closest(BACKDROP_SELECTOR);
      if (backdrop) {
        evt.preventDefault();
        this.close();
        return;
      }

      const inc = target.closest('[data-pham-qty-increase]');
      if (inc) {
        evt.preventDefault();
        const line = parseInt(inc.dataset.line, 10);
        const qty  = (parseInt(inc.dataset.quantity, 10) || 0) + 1;
        this.changeLine(line, qty);
        return;
      }

      const dec = target.closest('[data-pham-qty-decrease]');
      if (dec) {
        evt.preventDefault();
        const line = parseInt(dec.dataset.line, 10);
        const qty  = Math.max(0, (parseInt(dec.dataset.quantity, 10) || 0) - 1);
        this.changeLine(line, qty);
        return;
      }

      const remove = target.closest('[data-pham-cart-remove]');
      if (remove) {
        evt.preventDefault();
        const line = parseInt(remove.dataset.line, 10);
        this.changeLine(line, 0);
        return;
      }
    }

    /* ---- Delegated change: qty input ---- */
    _onChange(evt) {
      const input = evt.target instanceof Element
        ? evt.target.closest('[data-pham-qty-input]')
        : null;
      if (!input) return;
      const line = parseInt(input.dataset.line, 10);
      const qty  = Math.max(0, parseInt(input.value, 10) || 0);
      this.changeLine(line, qty);
    }

    /* ---- Escape key handler (bound while open) ---- */
    _onKeydown(e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && this.drawer && this.drawer.classList.contains('is-open')) {
        e.preventDefault();
        this.close();
      }
    }

    /* ====================================================================
       Cart API actions
       ==================================================================== */
    async add(form) {
      if (this.busy) return;
      this.busy = true;
      this._setFormPending(form, true);

      const formData = new FormData(form);
      const payload = {};
      const properties = {};
      formData.forEach((value, key) => {
        if (key.indexOf('properties[') === 0) {
          const propKey = key.slice(11, -1);
          properties[propKey] = value;
        } else {
          payload[key] = value;
        }
      });
      if (Object.keys(properties).length > 0) payload.properties = properties;

      try {
        const res = await fetch(CART_ADD_URL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/javascript',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = data && (data.description || data.message) || 'Could not add to cart';
          this._notifyError(msg, data);
          return;
        }

        document.dispatchEvent(new CustomEvent('pham:cart:added', { detail: data }));

        await this.refresh();
        this.open();

        const productId = data.product_id || (data.items && data.items[0] && data.items[0].product_id);
        if (productId) this.fetchRecommendations(productId);
      } catch (err) {
        console.error('[PHAM cart] add error:', err);
        this._notifyError('Network error', err);
      } finally {
        this._setFormPending(form, false);
        this.busy = false;
      }
    }

    async changeLine(line, quantity) {
      if (this.busy) return;
      if (!Number.isFinite(line) || line < 1) return;
      this.busy = true;

      try {
        const res = await fetch(CART_CHANGE_URL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/javascript',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ line: line, quantity: quantity })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = data && (data.description || data.message) || 'Could not update cart';
          this._notifyError(msg, data);
          return;
        }
        await this.refresh();
      } catch (err) {
        console.error('[PHAM cart] change error:', err);
        this._notifyError('Network error', err);
      } finally {
        this.busy = false;
      }
    }

    async refresh() {
      try {
        const sectionUrl = `${window.location.pathname}?section_id=${CART_SECTION_ID}&_=${Date.now()}`;
        const [sectionRes, cartRes] = await Promise.all([
          fetch(sectionUrl, { credentials: 'same-origin', headers: { 'Accept': 'text/html' } }),
          fetch(CART_GET_URL, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
        ]);

        if (sectionRes.ok) {
          const html = await sectionRes.text();
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          const freshDrawer = parsed.querySelector(DRAWER_SELECTOR);
          const currentDrawer = document.querySelector(DRAWER_SELECTOR);
          if (freshDrawer && currentDrawer) {
            const wasOpen = currentDrawer.classList.contains('is-open');
            currentDrawer.replaceWith(freshDrawer);
            this.drawer = document.querySelector(DRAWER_SELECTOR);
            if (wasOpen && this.drawer) {
              this.drawer.classList.add('is-open');
              this.drawer.setAttribute('aria-hidden', 'false');
            }
          } else if (freshDrawer && !currentDrawer) {
            document.body.appendChild(freshDrawer);
            this.drawer = document.querySelector(DRAWER_SELECTOR);
          }
        }

        if (cartRes.ok) {
          const cart = await cartRes.json();
          this._updateBubble(cart.item_count);
          document.dispatchEvent(new CustomEvent('pham:cart:updated', { detail: cart }));
        }

        if (window.PhamAnimations && typeof window.PhamAnimations.refresh === 'function') {
          window.PhamAnimations.refresh();
        }
      } catch (err) {
        console.error('[PHAM cart] refresh error:', err);
      }
    }

    async fetchRecommendations(productId) {
      try {
        const url = `${RECS_URL}?product_id=${encodeURIComponent(productId)}&limit=${RECOMMENDATION_LIMIT}&intent=related`;
        const res = await fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;
        const data = await res.json();
        const products = (data && data.products) || [];
        const container = document.querySelector('[data-cart-recommendations]');
        if (!container) return;
        container.innerHTML = this._renderRecommendations(products);
      } catch (err) {
        console.error('[PHAM cart] recommendations error:', err);
      }
    }

    _renderRecommendations(products) {
      if (!products || products.length === 0) return '';
      const items = products.slice(0, RECOMMENDATION_LIMIT).map((p) => {
        const imgRaw = p.featured_image || (p.images && p.images[0]) || '';
        const img = typeof imgRaw === 'string' ? imgRaw : (imgRaw && imgRaw.src) || '';
        const url = p.url || '#';
        const title = escapeHtml(p.title || '');
        const price = formatMoney(p.price);
        const safeImg = escapeHtml(img);
        const variantId = (p.variants && p.variants[0] && p.variants[0].id) || '';
        return `
          <li class="pham-cart-rec__item">
            <a href="${escapeHtml(url)}" class="pham-cart-rec__link" aria-label="${title}">
              ${img ? `<img class="pham-cart-rec__img" src="${safeImg}" alt="${title}" loading="lazy" width="120" height="160">` : '<span class="pham-cart-rec__img pham-skeleton" aria-hidden="true"></span>'}
              <span class="pham-cart-rec__meta">
                <span class="pham-cart-rec__title">${title}</span>
                <span class="pham-cart-rec__price">${price}</span>
              </span>
            </a>
            ${variantId ? `
              <form action="${escapeHtml(CART_ADD_URL.replace('.js',''))}" method="post" enctype="multipart/form-data" data-pham-rec-form>
                <input type="hidden" name="id" value="${escapeHtml(String(variantId))}">
                <button type="submit" class="pham-cart-rec__add" aria-label="Add ${title} to cart">+ Add</button>
              </form>` : ''}
          </li>
        `;
      }).join('');
      return `
        <header class="pham-cart-rec__head">
          <span class="pham-eyebrow">You may also like</span>
        </header>
        <ul class="pham-cart-rec__list" role="list">${items}</ul>
      `;
    }

    _updateBubble(count) {
      document.querySelectorAll('[data-pham-cart-count]').forEach((b) => {
        b.textContent = String(count);
        if (count === 0) {
          b.setAttribute('data-empty', 'true');
        } else {
          b.removeAttribute('data-empty');
        }
      });
    }

    _setFormPending(form, pending) {
      if (!form) return;
      const btn = form.querySelector('[type="submit"], button');
      if (!btn) return;
      if (pending) {
        btn.setAttribute('aria-busy', 'true');
        btn.dataset.phamPrevLabel = btn.textContent;
        btn.disabled = true;
      } else {
        btn.removeAttribute('aria-busy');
        if (btn.dataset.phamPrevLabel != null) {
          btn.textContent = btn.dataset.phamPrevLabel;
          delete btn.dataset.phamPrevLabel;
        }
        btn.disabled = false;
      }
    }

    _notifyError(msg, payload) {
      console.warn('[PHAM cart]', msg, payload || '');
      document.dispatchEvent(new CustomEvent('pham:cart:error', {
        detail: { message: msg, payload: payload }
      }));
    }

    /* ====================================================================
       Open / Close
       ==================================================================== */
    open() {
      this._refreshDrawerRef();
      if (!this.drawer) return;

      this.lastFocused = document.activeElement;

      this.drawer.classList.add('is-open');
      this.drawer.setAttribute('aria-hidden', 'false');
      document.body.classList.add('pham-cart-open', 'pham-no-scroll');
      document.body.style.overflow = 'hidden';

      document.addEventListener('keydown', this.boundKeydown);

      requestAnimationFrame(() => {
        const closeBtn = this.drawer.querySelector('[data-pham-cart-close]');
        if (closeBtn) {
          try { closeBtn.focus(); } catch (e) { /* */ }
        }
      });

      document.dispatchEvent(new CustomEvent('pham:cart:opened'));
    }

    close() {
      this._refreshDrawerRef();
      if (!this.drawer) return;

      this.drawer.classList.remove('is-open');
      this.drawer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('pham-cart-open', 'pham-no-scroll');
      document.body.style.overflow = '';

      document.removeEventListener('keydown', this.boundKeydown);

      if (this.lastFocused && typeof this.lastFocused.focus === 'function') {
        try { this.lastFocused.focus(); } catch (e) { /* */ }
      }
      this.lastFocused = null;

      document.dispatchEvent(new CustomEvent('pham:cart:closed'));
    }
  }

  /* ====================================================================
     Boot
     ==================================================================== */
  function boot() {
    window.PhamCart = new PhamCart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
