// @ts-nocheck
/* ==========================================================================
   PHAM — Lookbook carousel + lightbox
   ========================================================================== */

'use strict';

(function () {
  if (window.__PHAM_LOOKBOOK_BOOTED__) return;
  window.__PHAM_LOOKBOOK_BOOTED__ = true;

  const ZOOM_FACTOR = 2;
  const BODY_LB_CLASS = 'pham-lookbook-lightbox-open';

  function parseImages(root) {
    const raw = root.querySelector('[data-pham-carousel-data]');
    if (!raw) return [];
    try {
      const data = JSON.parse(raw.textContent || '[]');
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  class LookbookCarousel {
    constructor(el) {
      this.el = el;
      this.slides = Array.from(el.querySelectorAll('[data-pham-carousel-slide]'));
      this.prevBtn = el.querySelector('[data-pham-carousel-prev]');
      this.nextBtn = el.querySelector('[data-pham-carousel-next]');
      this.counter = el.querySelector('[data-pham-carousel-current]');
      this.index = 0;
      this.total = this.slides.length;
      this.autoplayMs = parseInt(el.getAttribute('data-autoplay') || '0', 10);
      this.timer = null;
      this.paused = false;

      this._onPrev = () => this.go(this.index - 1, true);
      this._onNext = () => this.go(this.index + 1, true);
      this._onMouseEnter = () => this.pause();
      this._onMouseLeave = () => this.resume();
      this._onFocusIn = () => this.pause();
      this._onFocusOut = (e) => {
        if (!this.el.contains(e.relatedTarget)) this.resume();
      };
      this._onVisibility = () => {
        if (document.hidden) this.pause();
        else this.resume();
      };
      this._onKeydown = (e) => {
        if (document.body.classList.contains(BODY_LB_CLASS)) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); this._onPrev(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); this._onNext(); }
      };

      this._bind();
      this.go(0, false);
    }

    _bind() {
      if (this.prevBtn) this.prevBtn.addEventListener('click', this._onPrev);
      if (this.nextBtn) this.nextBtn.addEventListener('click', this._onNext);
      this.el.addEventListener('mouseenter', this._onMouseEnter);
      this.el.addEventListener('mouseleave', this._onMouseLeave);
      this.el.addEventListener('focusin', this._onFocusIn);
      this.el.addEventListener('focusout', this._onFocusOut);
      this.el.addEventListener('keydown', this._onKeydown);
      document.addEventListener('visibilitychange', this._onVisibility);
    }

    go(index, userTriggered) {
      if (!this.total) return;
      if (index < 0) index = this.total - 1;
      if (index >= this.total) index = 0;
      this.index = index;

      this.slides.forEach((slide, i) => {
        slide.classList.toggle('is-active', i === this.index);
        slide.setAttribute('aria-hidden', i === this.index ? 'false' : 'true');
      });

      if (this.counter) this.counter.textContent = String(this.index + 1);
      this.el.setAttribute('data-active-index', String(this.index));

      if (userTriggered) this._resetAutoplay();
    }

    pause() {
      this.paused = true;
      this._clearAutoplay();
    }

    resume() {
      if (document.body.classList.contains(BODY_LB_CLASS)) return;
      this.paused = false;
      this._startAutoplay();
    }

    forcePause() {
      this.paused = true;
      this._clearAutoplay();
    }

    forceResume() {
      this.paused = false;
      this._startAutoplay();
    }

    _startAutoplay() {
      this._clearAutoplay();
      if (!this.autoplayMs || this.total < 2 || this.paused) return;
      this.timer = window.setInterval(() => {
        this.go(this.index + 1, false);
      }, this.autoplayMs);
    }

    _resetAutoplay() {
      this._clearAutoplay();
      this._startAutoplay();
    }

    _clearAutoplay() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }

    destroy() {
      this._clearAutoplay();
      document.removeEventListener('visibilitychange', this._onVisibility);
    }
  }

  class LookbookLightbox {
    constructor(section) {
      this.section = section;
      this.modal = section.querySelector('[data-pham-lookbook-lightbox]');
      if (!this.modal) return;

      if (this.modal.parentNode !== document.body) {
        document.body.appendChild(this.modal);
      }

      this.stage = this.modal.querySelector('[data-pham-lightbox-stage]');
      this.viewport = this.modal.querySelector('[data-pham-lightbox-viewport]');
      this.img = this.modal.querySelector('[data-pham-lightbox-img]');
      this.counter = this.modal.querySelector('[data-pham-lightbox-counter]');
      this.prevBtn = this.modal.querySelector('[data-pham-lightbox-prev]');
      this.nextBtn = this.modal.querySelector('[data-pham-lightbox-next]');
      this.zoomBtn = this.modal.querySelector('[data-pham-lightbox-zoom]');
      this.closers = this.modal.querySelectorAll('[data-pham-lightbox-close]');

      this.images = [];
      this.index = 0;
      this.carousel = null;
      this.lastFocused = null;
      this.zoomed = false;
      this.fitScale = 1;
      this.drag = null;

      this._onKeydown = (e) => this._handleKey(e);
      this._onResize = () => {
        if (this.modal.classList.contains('is-open')) this._applyFit();
      };
      this._onImgLoad = () => {
        if (this.modal.classList.contains('is-open')) {
          if (this.zoomed) this._applyZoom();
          else this._applyFit();
        }
      };

      this._bind();
      window.addEventListener('resize', this._onResize, { passive: true });
      if (this.img) this.img.addEventListener('load', this._onImgLoad);
    }

    _bind() {
      this.section.querySelectorAll('[data-pham-lookbook-open]').forEach((btn) => {
        if (btn.__phamLbBound) return;
        btn.__phamLbBound = true;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const carouselEl = btn.closest('[data-pham-lookbook-carousel]');
          const images = carouselEl ? parseImages(carouselEl) : [];
          const single = {
            src: btn.getAttribute('data-pham-src') || '',
            srcset: btn.getAttribute('data-pham-srcset') || '',
            alt: btn.getAttribute('data-pham-alt') || ''
          };

          if (images.length) {
            this.carousel = carouselEl && carouselEl.__phamCarousel ? carouselEl.__phamCarousel : null;
            this.images = images;
            const idx = parseInt(btn.getAttribute('data-pham-index') || '0', 10);
            this.open(isNaN(idx) ? 0 : idx);
          } else if (single.src) {
            this.carousel = null;
            this.images = [single];
            this.open(0);
          }
        });
      });

      if (this.prevBtn) {
        this.prevBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.go(this.index - 1);
        });
      }
      if (this.nextBtn) {
        this.nextBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.go(this.index + 1);
        });
      }
      if (this.zoomBtn) {
        this.zoomBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleZoom();
        });
      }

      this.closers.forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        });
      });

      if (this.img) {
        this.img.addEventListener('dblclick', (e) => {
          e.preventDefault();
          this.toggleZoom();
        });
        this.img.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.zoomed) this.toggleZoom(false);
        });
      }

      this._bindPan();
    }

    _bindPan() {
      if (!this.viewport) return;

      const onDown = (e) => {
        if (!this.zoomed) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        this.drag = {
          x: e.clientX,
          y: e.clientY,
          sl: this.viewport.scrollLeft,
          st: this.viewport.scrollTop,
          id: e.pointerId
        };
        this.viewport.classList.add('is-dragging');
        try { this.viewport.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      };

      const onMove = (e) => {
        if (!this.drag || this.drag.id !== e.pointerId) return;
        e.preventDefault();
        this.viewport.scrollLeft = this.drag.sl - (e.clientX - this.drag.x);
        this.viewport.scrollTop = this.drag.st - (e.clientY - this.drag.y);
      };

      const onUp = (e) => {
        if (!this.drag || this.drag.id !== e.pointerId) return;
        this.drag = null;
        this.viewport.classList.remove('is-dragging');
        try { this.viewport.releasePointerCapture(e.pointerId); } catch (err) { /* */ }
      };

      this.viewport.addEventListener('pointerdown', onDown);
      this.viewport.addEventListener('pointermove', onMove);
      this.viewport.addEventListener('pointerup', onUp);
      this.viewport.addEventListener('pointercancel', onUp);
    }

    open(index) {
      if (!this.modal || !this.img || !this.images.length) return;

      this.lastFocused = document.activeElement;
      if (this.carousel) this.carousel.forcePause();

      this.go(index);
      this.modal.removeAttribute('hidden');
      this.modal.classList.add('is-open');
      this.modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('pham-no-scroll', BODY_LB_CLASS);
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', this._onKeydown, true);

      const closeEl = this.modal.querySelector('[data-pham-lightbox-close]:not([data-pham-lightbox-backdrop])');
      if (closeEl) {
        requestAnimationFrame(() => { try { closeEl.focus(); } catch (e) { /* */ } });
      }
    }

    close() {
      if (!this.modal) return;

      const syncIndex = this.index;

      this.setZoom(false);
      this.modal.classList.remove('is-open');
      this.modal.setAttribute('hidden', '');
      this.modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('pham-no-scroll', BODY_LB_CLASS);
      document.body.style.overflow = '';
      document.removeEventListener('keydown', this._onKeydown, true);

      if (this.img) {
        this.img.removeAttribute('srcset');
        this.img.style.width = '';
        this.img.style.height = '';
        this.img.src = '';
      }

      if (this.carousel) {
        this.carousel.go(syncIndex, false);
        this.carousel.forceResume();
      }
      this.carousel = null;

      if (this.lastFocused && typeof this.lastFocused.focus === 'function') {
        try { this.lastFocused.focus(); } catch (e) { /* */ }
      }
      this.lastFocused = null;
    }

    go(index) {
      if (!this.images.length) return;
      if (index < 0) index = this.images.length - 1;
      if (index >= this.images.length) index = 0;
      this.index = index;

      const item = this.images[this.index];
      this.setZoom(false);

      if (item.srcset) this.img.setAttribute('srcset', item.srcset);
      else this.img.removeAttribute('srcset');
      this.img.alt = item.alt || '';
      this.img.src = item.src;

      if (this.img.complete && this.img.naturalWidth) {
        this._applyFit();
      }

      const multi = this.images.length > 1;
      if (this.prevBtn) this.prevBtn.hidden = !multi;
      if (this.nextBtn) this.nextBtn.hidden = !multi;
      if (this.counter) {
        this.counter.textContent = multi ? (this.index + 1) + ' / ' + this.images.length : '';
        this.counter.hidden = !multi;
      }
    }

    _stageSize() {
      if (!this.viewport) return { w: 0, h: 0 };
      return {
        w: this.viewport.clientWidth,
        h: this.viewport.clientHeight
      };
    }

    _applyFit() {
      if (!this.img || !this.viewport) return;

      this.zoomed = false;
      if (this.modal) this.modal.classList.remove('is-zoomed');
      if (this.zoomBtn) {
        this.zoomBtn.setAttribute('aria-pressed', 'false');
        this.zoomBtn.setAttribute('aria-label', 'Zoom in');
      }

      this.viewport.scrollTo(0, 0);
      this.viewport.style.overflow = 'hidden';
      this.img.style.width = '100%';
      this.img.style.height = '100%';
      this.img.style.maxWidth = '100%';
      this.img.style.maxHeight = '100%';

      const nw = this.img.naturalWidth;
      const nh = this.img.naturalHeight;
      const stage = this._stageSize();
      if (nw > 0 && nh > 0 && stage.w > 0 && stage.h > 0) {
        this.fitScale = Math.min(stage.w / nw, stage.h / nh);
      } else {
        this.fitScale = 1;
      }
    }

    _applyZoom() {
      if (!this.img || !this.viewport) return;

      const nw = this.img.naturalWidth;
      const nh = this.img.naturalHeight;
      if (!nw || !nh) return;

      const stage = this._stageSize();
      if (stage.w <= 0 || stage.h <= 0) return;

      this.fitScale = Math.min(stage.w / nw, stage.h / nh);
      const scale = this.fitScale * ZOOM_FACTOR;
      const w = Math.round(nw * scale);
      const h = Math.round(nh * scale);

      this.viewport.style.overflow = 'auto';
      this.img.style.width = w + 'px';
      this.img.style.height = h + 'px';
      this.img.style.maxWidth = 'none';
      this.img.style.maxHeight = 'none';

      requestAnimationFrame(() => {
        this.viewport.scrollLeft = Math.max(0, (w - stage.w) / 2);
        this.viewport.scrollTop = Math.max(0, (h - stage.h) / 2);
      });
    }

    toggleZoom(force) {
      const next = typeof force === 'boolean' ? force : !this.zoomed;
      if (next) {
        this.setZoom(true);
      } else {
        this.setZoom(false);
      }
    }

    setZoom(on) {
      this.zoomed = on;
      if (this.modal) this.modal.classList.toggle('is-zoomed', on);
      if (this.zoomBtn) {
        this.zoomBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        this.zoomBtn.setAttribute('aria-label', on ? 'Zoom out' : 'Zoom in');
      }

      if (on) {
        if (this.img.complete && this.img.naturalWidth) this._applyZoom();
        else this.img.addEventListener('load', () => this._applyZoom(), { once: true });
      } else {
        this._applyFit();
      }
    }

    _handleKey(e) {
      if (!this.modal.classList.contains('is-open')) return;

      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        this.go(this.index - 1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.go(this.index + 1);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleZoom(true);
      }
      if (e.key === '-') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleZoom(false);
      }
    }
  }

  const boundSections = new WeakSet();

  function bindSection(section) {
    if (!section || boundSections.has(section)) return;
    boundSections.add(section);

    section.querySelectorAll('[data-pham-lookbook-carousel]').forEach((el) => {
      if (el.__phamCarousel) return;
      el.__phamCarousel = new LookbookCarousel(el);
    });

    new LookbookLightbox(section);
  }

  function bindAll() {
    document.querySelectorAll('[data-pham-lookbook-v2]').forEach(bindSection);
  }

  function boot() {
    bindAll();
    document.addEventListener('shopify:section:load', (e) => {
      const section = e.target.querySelector('[data-pham-lookbook-v2]') || e.target.closest('[data-pham-lookbook-v2]');
      if (section) bindSection(section);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
