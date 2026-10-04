// @ts-nocheck
/* ==========================================================================
   PHAM — Lookbook carousel + lightbox
   ========================================================================== */

'use strict';

(function () {
  if (window.__PHAM_LOOKBOOK_BOOTED__) return;
  window.__PHAM_LOOKBOOK_BOOTED__ = true;

  const BODY_LB_CLASS = 'pham-lookbook-lightbox-open';
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

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
      this.autoplayMs = prefersReducedMotion ? 0 : parseInt(el.getAttribute('data-autoplay') || '0', 10);
      this.timer = null;
      this.paused = false;
      this.inViewport = true;
      this.viewportObserver = null;
      this.transitionMs = prefersReducedMotion ? 0 : 720;
      this.transitioning = false;
      this._transitionTimer = null;
      this._enterFrame = null;
      this._transitionGen = 0;
      this._queuedIndex = null;
      this._queuedDirection = null;

      this._onPrev = () => {
        const base = this._effectiveIndex();
        const nextIndex = (base - 1 + this.total) % this.total;
        this._navigateTo(nextIndex, 'prev', true);
      };
      this._onNext = () => {
        const base = this._effectiveIndex();
        const nextIndex = (base + 1) % this.total;
        this._navigateTo(nextIndex, 'next', true);
      };
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
      this._initSlides();
      this._observeViewport();
      this._startAutoplay();
    }

    _observeViewport() {
      if (!('IntersectionObserver' in window)) return;
      this.inViewport = false;
      this.viewportObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        const visible = Boolean(entry && entry.isIntersecting);
        if (visible === this.inViewport) return;
        this.inViewport = visible;
        if (visible) this._startAutoplay();
        else this._clearAutoplay();
      }, { rootMargin: '120px 0px', threshold: 0.01 });
      this.viewportObserver.observe(this.el);
    }

    _initSlides() {
      this._cancelEnterFrame();
      this._clearTransitionTimer();
      this._queuedIndex = null;
      this._queuedDirection = null;
      this.transitioning = false;
      this.index = 0;
      this.slides.forEach((slide, i) => {
        slide.classList.remove('is-exiting-left', 'is-exiting-right');
        slide.style.transition = '';
        const active = i === 0;
        slide.classList.toggle('is-active', active);
        slide.style.transform = active ? '' : this._restingTransform();
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
      if (this.counter) this.counter.textContent = '1';
      this.el.setAttribute('data-active-index', '0');
    }

    _clearTransitionTimer() {
      if (this._transitionTimer) {
        clearTimeout(this._transitionTimer);
        this._transitionTimer = null;
      }
    }

    _cancelEnterFrame() {
      if (this._enterFrame) {
        cancelAnimationFrame(this._enterFrame);
        this._enterFrame = null;
      }
    }

    _effectiveIndex() {
      if (this._queuedIndex !== null && this._queuedIndex !== undefined) {
        return this._queuedIndex;
      }
      return this.index;
    }

    _navigateTo(index, direction, userTriggered) {
      if (!this.total) return;
      if (index < 0) index = this.total - 1;
      if (index >= this.total) index = 0;

      if (this.transitioning) {
        this._queuedIndex = index;
        this._queuedDirection = direction;
        if (userTriggered) this._resetAutoplay();
        return;
      }

      if (index === this.index) return;
      this.go(index, userTriggered, direction);
    }

    _processQueue() {
      if (this._queuedIndex === null || this._queuedIndex === undefined) return;
      if (this._queuedIndex === this.index) {
        this._queuedIndex = null;
        this._queuedDirection = null;
        return;
      }

      const index = this._queuedIndex;
      const direction = this._queuedDirection || this._direction(this.index, index);
      this._queuedIndex = null;
      this._queuedDirection = null;
      this.go(index, false, direction);
    }

    _restingTransform() {
      return 'translate3d(100%, 0, 0)';
    }

    _finalizeTransition() {
      this.slides.forEach((slide, i) => {
        slide.classList.remove('is-exiting-left', 'is-exiting-right');
        slide.style.transition = '';
        const active = i === this.index;
        slide.classList.toggle('is-active', active);
        if (active) {
          slide.style.transform = '';
        } else {
          slide.style.transform = this._restingTransform();
        }
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
      this.transitioning = false;
    }

    jumpTo(index) {
      if (!this.total) return;
      if (index < 0) index = this.total - 1;
      if (index >= this.total) index = 0;
      if (index === this.index && !this.transitioning) return;

      this._cancelEnterFrame();
      this._clearTransitionTimer();
      this._queuedIndex = null;
      this._queuedDirection = null;
      this._transitionGen += 1;
      this.index = index;
      this._finalizeTransition();
      if (this.counter) this.counter.textContent = String(this.index + 1);
      this.el.setAttribute('data-active-index', String(this.index));
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

    go(index, userTriggered, direction) {
      if (!this.total) return;
      if (index < 0) index = this.total - 1;
      if (index >= this.total) index = 0;

      const prevIndex = this.index;
      if (index === prevIndex && !this.transitioning) return;
      if (this.transitioning) return;

      if (!direction) direction = this._direction(prevIndex, index);

      const prevSlide = this.slides[prevIndex];
      const nextSlide = this.slides[index];
      const gen = ++this._transitionGen;

      this._cancelEnterFrame();
      this._clearTransitionTimer();
      this.transitioning = true;
      this.index = index;

      if (prevSlide && prevSlide !== nextSlide) {
        prevSlide.classList.remove('is-active', 'is-exiting-left', 'is-exiting-right');
        prevSlide.style.transition = '';
        prevSlide.style.transform = '';
        prevSlide.classList.add(direction === 'next' ? 'is-exiting-left' : 'is-exiting-right');
        prevSlide.setAttribute('aria-hidden', 'true');
      }

      if (nextSlide) {
        nextSlide.classList.remove('is-exiting-left', 'is-exiting-right', 'is-active');
        nextSlide.style.transition = 'none';
        nextSlide.style.transform = direction === 'next'
          ? 'translate3d(100%, 0, 0)'
          : 'translate3d(-100%, 0, 0)';
        nextSlide.setAttribute('aria-hidden', 'false');
      }

      this.slides.forEach((slide, i) => {
        if (i !== index && i !== prevIndex) {
          slide.classList.remove('is-active', 'is-exiting-left', 'is-exiting-right');
          slide.style.transition = '';
          slide.style.transform = this._restingTransform();
          slide.setAttribute('aria-hidden', 'true');
        }
      });

      if (this.counter) this.counter.textContent = String(this.index + 1);
      this.el.setAttribute('data-active-index', String(this.index));

      if (nextSlide) {
        // eslint-disable-next-line no-unused-expressions
        nextSlide.offsetHeight;
        this._enterFrame = requestAnimationFrame(() => {
          this._enterFrame = null;
          if (gen !== this._transitionGen || !this.transitioning || this.index !== index) return;
          nextSlide.style.transition = '';
          nextSlide.style.transform = '';
          nextSlide.classList.add('is-active');
        });
      }

      this._transitionTimer = window.setTimeout(() => {
        this._transitionTimer = null;
        if (gen !== this._transitionGen) return;
        this._finalizeTransition();
        this._processQueue();
      }, this.transitionMs);

      if (userTriggered) this._resetAutoplay();
    }

    _direction(from, to) {
      if (from === to) return 'next';
      if (from === this.total - 1 && to === 0) return 'next';
      if (from === 0 && to === this.total - 1) return 'prev';
      return to > from ? 'next' : 'prev';
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
      if (!this.autoplayMs || this.total < 2 || this.paused || !this.inViewport) return;

      const schedule = (delay) => {
        this.timer = window.setTimeout(() => {
          if (this.paused || document.hidden || document.body.classList.contains(BODY_LB_CLASS)) {
            schedule(this.autoplayMs);
            return;
          }
          if (this.transitioning) {
            schedule(150);
            return;
          }
          const next = (this.index + 1) % this.total;
          this._navigateTo(next, 'next', false);
          schedule(this.autoplayMs);
        }, delay);
      };

      schedule(this.autoplayMs);
    }

    _resetAutoplay() {
      this._clearAutoplay();
      this._startAutoplay();
    }

    _clearAutoplay() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }

    destroy() {
      this._cancelEnterFrame();
      this._clearTransitionTimer();
      this._clearAutoplay();
      if (this.viewportObserver) {
        this.viewportObserver.disconnect();
        this.viewportObserver = null;
      }
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

      this.viewport = this.modal.querySelector('[data-pham-lightbox-viewport]');
      this.canvas = this.modal.querySelector('[data-pham-lightbox-canvas]');
      this.img = this.modal.querySelector('[data-pham-lightbox-img]');
      this.counter = this.modal.querySelector('[data-pham-lightbox-counter]');
      this.prevBtn = this.modal.querySelector('[data-pham-lightbox-prev]');
      this.nextBtn = this.modal.querySelector('[data-pham-lightbox-next]');
      this.closers = this.modal.querySelectorAll('[data-pham-lightbox-close]');

      this.images = [];
      this.index = 0;
      this.carousel = null;
      this.lastFocused = null;
      this.scale = 1;
      this.panX = 0;
      this.panY = 0;
      this.baseW = 0;
      this.baseH = 0;
      this.drag = null;
      this.pinch = null;
      this._pointers = new Map();

      this._onKeydown = (e) => this._handleKey(e);
      this._onResize = () => {
        if (this.modal.classList.contains('is-open')) this._layoutFit(true);
      };
      this._onImgLoad = () => {
        if (this.modal.classList.contains('is-open')) {
          this._layoutFit(true);
        }
      };
      this._onWheel = (e) => this._handleWheel(e);

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

      this.closers.forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        });
      });

      this._bindPan();
    }

    _bindWheel() {
      if (!this.modal) return;
      this.modal.addEventListener('wheel', this._onWheel, { passive: false });
    }

    _unbindWheel() {
      if (!this.modal) return;
      this.modal.removeEventListener('wheel', this._onWheel);
    }

    _handleWheel(e) {
      if (!this.modal.classList.contains('is-open')) return;
      e.preventDefault();
      e.stopPropagation();

      const factor = e.deltaY < 0 ? 1.12 : 0.88;
      const next = clamp(this.scale * factor, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(next - this.scale) < 0.001) return;

      this._zoomTo(next, e.clientX, e.clientY);
    }

    _zoomTo(nextScale, clientX, clientY) {
      if (!this.viewport || !this.baseW) return;

      const rect = this.viewport.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (nextScale <= 1.001) {
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
        this._renderTransform();
        return;
      }

      const imgX = (clientX - centerX - this.panX) / this.scale;
      const imgY = (clientY - centerY - this.panY) / this.scale;

      this.scale = nextScale;
      this.panX = clientX - centerX - imgX * this.scale;
      this.panY = clientY - centerY - imgY * this.scale;

      this._clampPan();
      this._renderTransform();
    }

    _bindPan() {
      if (!this.viewport) return;

      const stopNativeDrag = (e) => {
        e.preventDefault();
      };

      [this.viewport, this.canvas, this.img].forEach((el) => {
        if (!el) return;
        el.addEventListener('dragstart', stopNativeDrag);
        el.addEventListener('selectstart', stopNativeDrag);
      });

      const pointFromEvent = (e) => ({ x: e.clientX, y: e.clientY });

      const onDown = (e) => {
        this._pointers.set(e.pointerId, pointFromEvent(e));

        if (this._pointers.size === 2) {
          this.drag = null;
          this.viewport.classList.remove('is-dragging');
          this._startPinch();
          e.preventDefault();
          try { this.viewport.setPointerCapture(e.pointerId); } catch (err) { /* */ }
          return;
        }

        if (this.scale <= 1.01) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        this.drag = {
          x: e.clientX,
          y: e.clientY,
          panX: this.panX,
          panY: this.panY,
          id: e.pointerId
        };
        this.viewport.classList.add('is-dragging');
        try { this.viewport.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      };

      const onMove = (e) => {
        if (!this._pointers.has(e.pointerId)) return;
        this._pointers.set(e.pointerId, pointFromEvent(e));

        if (this._pointers.size === 2 && this.pinch) {
          e.preventDefault();
          this._updatePinch();
          return;
        }

        if (!this.drag || this.drag.id !== e.pointerId || this._pointers.size !== 1) return;
        e.preventDefault();
        this.panX = this.drag.panX + (e.clientX - this.drag.x);
        this.panY = this.drag.panY + (e.clientY - this.drag.y);
        this._clampPan();
        this._renderTransform();
      };

      const onUp = (e) => {
        const wasDragging = this.drag && this.drag.id === e.pointerId;
        this._pointers.delete(e.pointerId);

        if (this._pointers.size < 2) {
          this.pinch = null;
          this.viewport.classList.remove('is-pinching');
        }

        if (wasDragging) {
          this.drag = null;
          this.viewport.classList.remove('is-dragging');
        }

        try { this.viewport.releasePointerCapture(e.pointerId); } catch (err) { /* */ }
      };

      this.viewport.addEventListener('pointerdown', onDown);
      this.viewport.addEventListener('pointermove', onMove);
      this.viewport.addEventListener('pointerup', onUp);
      this.viewport.addEventListener('pointercancel', onUp);
    }

    _startPinch() {
      const pts = Array.from(this._pointers.values());
      if (pts.length < 2 || !this.viewport) return;

      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy);
      if (dist < 8) return;

      const rect = this.viewport.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const scale = this.scale || 1;

      this.pinch = {
        startDist: dist,
        startScale: scale,
        anchorImgX: (midX - centerX - this.panX) / scale,
        anchorImgY: (midY - centerY - this.panY) / scale
      };
      this.viewport.classList.add('is-pinching');
    }

    _updatePinch() {
      const pts = Array.from(this._pointers.values());
      if (pts.length < 2 || !this.pinch || !this.viewport) return;

      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy);
      if (!dist || !this.pinch.startDist) return;

      const rect = this.viewport.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const nextScale = clamp(
        this.pinch.startScale * (dist / this.pinch.startDist),
        MIN_ZOOM,
        MAX_ZOOM
      );

      if (nextScale <= 1.001) {
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
      } else {
        this.scale = nextScale;
        this.panX = midX - centerX - this.pinch.anchorImgX * this.scale;
        this.panY = midY - centerY - this.pinch.anchorImgY * this.scale;
        this._clampPan();
      }

      this._renderTransform();
    }

    open(index) {
      if (!this.modal || !this.img || !this.images.length) return;

      this.lastFocused = document.activeElement;
      if (this.carousel) this.carousel.forcePause();

      this.scale = 1;
      this.panX = 0;
      this.panY = 0;
      this.baseW = 0;
      this.baseH = 0;
      this.drag = null;
      this.pinch = null;
      this._pointers.clear();
      if (this.viewport) {
        this.viewport.classList.remove('is-dragging', 'is-pinching');
      }
      this.go(index);
      this.modal.removeAttribute('hidden');
      this.modal.classList.add('is-open');
      this.modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('pham-no-scroll', BODY_LB_CLASS);
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', this._onKeydown, true);
      this._bindWheel();

      const closeEl = this.modal.querySelector('.pham-lookbook-v2__lightbox-close');
      if (closeEl) {
        requestAnimationFrame(() => { try { closeEl.focus(); } catch (e) { /* */ } });
      }
    }

    close() {
      if (!this.modal) return;

      const syncIndex = this.index;

      this.scale = 1;
      this._unbindWheel();
      this.drag = null;
      this.pinch = null;
      this._pointers.clear();
      if (this.viewport) {
        this.viewport.classList.remove('is-dragging', 'is-pinching');
      }
      this.modal.classList.remove('is-open', 'is-zoomed');
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
      if (this.canvas) {
        this.canvas.style.transform = '';
      }

      if (this.carousel) {
        this.carousel.jumpTo(syncIndex);
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
      this.scale = 1;
      this.panX = 0;
      this.panY = 0;
      this.drag = null;
      this.pinch = null;
      this._pointers.clear();
      if (this.viewport) {
        this.viewport.classList.remove('is-dragging', 'is-pinching');
      }

      if (item.srcset) this.img.setAttribute('srcset', item.srcset);
      else this.img.removeAttribute('srcset');
      this.img.alt = item.alt || '';
      this.img.src = item.src;

      if (this.img.complete && this.img.naturalWidth) {
        this._layoutFit(false);
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

    _layoutFit(keepZoom) {
      if (!this.img || !this.viewport || !this.canvas) return;

      const nw = this.img.naturalWidth;
      const nh = this.img.naturalHeight;
      if (!nw || !nh) return;

      const stage = this._stageSize();
      if (stage.w <= 0 || stage.h <= 0) return;

      const fit = Math.min(stage.w / nw, stage.h / nh);
      this.baseW = Math.round(nw * fit);
      this.baseH = Math.round(nh * fit);

      this.img.style.width = this.baseW + 'px';
      this.img.style.height = this.baseH + 'px';

      if (!keepZoom) {
        this.scale = 1;
        this.panX = 0;
        this.panY = 0;
      } else {
        this._clampPan();
      }

      this._renderTransform();
    }

    _clampPan() {
      if (!this.viewport || this.scale <= 1.001) {
        this.panX = 0;
        this.panY = 0;
        return;
      }

      const stage = this._stageSize();
      const scaledW = this.baseW * this.scale;
      const scaledH = this.baseH * this.scale;
      const maxPanX = Math.max(0, (scaledW - stage.w) / 2);
      const maxPanY = Math.max(0, (scaledH - stage.h) / 2);

      this.panX = clamp(this.panX, -maxPanX, maxPanX);
      this.panY = clamp(this.panY, -maxPanY, maxPanY);
    }

    _renderTransform() {
      if (!this.canvas || !this.modal) return;

      this.modal.classList.toggle('is-zoomed', this.scale > 1.001);
      this.canvas.style.transform =
        'translate(' + this.panX + 'px, ' + this.panY + 'px) scale(' + this.scale + ')';
    }

    _handleKey(e) {
      if (!this.modal.classList.contains('is-open')) return;

      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        this.go(this.index - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.go(this.index + 1);
      } else if (e.key === 'Tab') {
        const focusable = Array.from(
          this.modal.querySelectorAll('button:not([disabled]):not([hidden]), a[href], [tabindex]:not([tabindex="-1"])')
        ).filter((el) => el.getClientRects().length > 0);
        if (!focusable.length) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
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
