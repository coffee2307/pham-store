(function () {
  'use strict';

  if (window.__PHAM_VAULT__) return;
  window.__PHAM_VAULT__ = true;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const cardExpandMode = window.matchMedia('(min-width: 320px)');
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const damp = (current, target, speed, delta) => current + (target - current) * (1 - Math.exp(-speed * delta));
  const normalizeAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

  function mountVault(root) {
    if (root.dataset.phamVaultMounted === 'true') return;
    root.dataset.phamVaultMounted = 'true';
    const sticky = root.querySelector('.pham-vault__sticky');
    const orbit = root.querySelector('[data-pham-vault-orbit]');
    const orbitPlane = root.querySelector('[data-pham-vault-orbit-plane]');
    const orbitRing = root.querySelector('.pham-vault__orbit-ring');
    const orbitCards = root.querySelector('.pham-vault__orbit-cards');
    const cards = Array.from(root.querySelectorAll('[data-pham-vault-card]'));
    const chapters = Array.from(root.querySelectorAll('[data-pham-vault-chapter]'));
    const jumps = Array.from(root.querySelectorAll('[data-pham-vault-jump]'));
    if (!sticky || !orbit || !orbitPlane || !cards.length) return;
    const autoSpeed = clamp(Number.parseFloat(root.dataset.orbitSpeed) || 6, 0, 16) * Math.PI / 180;
    const baseTilt = clamp(Number.parseFloat(root.dataset.orbitTilt) || 5, 2, 10);
    let active = false;
    let frame = 0;
    let previousTime = performance.now();
    let progress = 0;
    let smoothProgress = 0;
    let currentChapter = -1;
    let rotation = 0.34;
    let velocity = 0;
    let currentTilt = baseTilt;
    let targetTilt = baseTilt;
    let dragging = false;
    let horizontalDrag = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartRotation = 0;
    let lastPointerX = 0;
    let lastPointerTime = 0;
    let radius = 320;
    let sectionTop = 0;
    let scrollDistance = 1;
    let frontIndex = -1;
    let cardDialogOpen = false;
    let cardDialog = null;
    let cardDialogClose = null;
    let expandedSource = null;
    let dialogReturnFocus = null;
    let cardDialogAnimation = null;
    let planeDialogAnimation = null;
    let cardDialogSettled = false;
    let cardDialogClosing = false;
    let sourceCardTransform = '';
    let sourcePlaneTransform = '';
    let dialogOpenScrollY = 0;
    let dialogPlaneTilt = 0;
    let dialogPlaneLean = 0;

    function measureOrbit() {
      const width = orbit.clientWidth;
      const cardWidth = cards[0] ? Number.parseFloat(window.getComputedStyle(cards[0]).width) || 120 : 120;
      const density = clamp(cards.length / 8, 1, 1.5);
      let targetRadius;

      if (window.innerWidth < 600) {
        targetRadius = Math.max(width * 0.38, cardWidth * 1.35 * density);
        radius = clamp(targetRadius, 155, 255);
      } else if (window.innerWidth < 900) {
        targetRadius = Math.max(width * 0.35, cardWidth * 1.32 * density);
        radius = clamp(targetRadius, 190, 320);
      } else if (window.innerWidth < 1200) {
        targetRadius = Math.max(width * 0.33, cardWidth * 1.28 * density);
        radius = clamp(targetRadius, 220, 360);
      } else {
        targetRadius = Math.max(width * 0.31, cardWidth * 1.22 * density);
        radius = clamp(targetRadius, 270, 455);
      }
    }

    function measureLayout() {
      const rect = root.getBoundingClientRect();
      sectionTop = window.scrollY + rect.top;
      scrollDistance = Math.max(root.offsetHeight - window.innerHeight, 1);
    }

    function measureProgress() {
      progress = clamp((window.scrollY - sectionTop) / scrollDistance, 0, 1);
    }

    function setChapter(index) {
      if (currentChapter === index) return;
      currentChapter = index;
      chapters.forEach(function (chapter, chapterIndex) {
        const selected = chapterIndex === index;
        chapter.classList.toggle('is-active', selected);
        chapter.setAttribute('aria-hidden', selected ? 'false' : 'true');
      });
      jumps.forEach(function (jump, jumpIndex) {
        jump.classList.toggle('is-active', jumpIndex === index);
        if (jumpIndex === index) jump.setAttribute('aria-current', 'step');
        else jump.removeAttribute('aria-current');
      });
    }

    function ensureCardDialog() {
      if (cardDialog) return;

      cardDialog = document.createElement('div');
      cardDialog.className = 'pham-vault-card-dialog';
      cardDialog.setAttribute('role', 'dialog');
      cardDialog.setAttribute('aria-modal', 'true');
      cardDialog.setAttribute('aria-label', 'Expanded archive image');
      cardDialog.setAttribute('aria-hidden', 'true');
      cardDialog.innerHTML =
        '<div class="pham-vault-card-dialog__backdrop" data-pham-vault-card-dismiss></div>' +
        '<button type="button" class="pham-vault-card-dialog__close" data-pham-vault-card-close aria-label="Close expanded archive image">&times;</button>';

      sticky.appendChild(cardDialog);
      cardDialogClose = cardDialog.querySelector('[data-pham-vault-card-close]');
      cardDialog.querySelector('[data-pham-vault-card-dismiss]').addEventListener('click', closeCardDialog);
      cardDialogClose.addEventListener('click', closeCardDialog);
    }

    function getExpandedCardScale(card) {
      const width = Math.max(card.offsetWidth, 1);
      const height = Math.max(card.offsetHeight, 1);
      const mobile = window.innerWidth < 600;
      const tablet = window.innerWidth >= 600 && window.innerWidth < 1024;
      const targetWidth = mobile
        ? Math.min(window.innerWidth * 0.60, 250)
        : tablet
          ? Math.min(window.innerWidth * 0.48, 400)
          : Math.min(430, window.innerWidth * 0.29);
      const targetHeight = mobile
        ? Math.min(window.innerHeight * 0.45, 380)
        : tablet
          ? Math.min(window.innerHeight * 0.62, 560)
          : Math.min(window.innerHeight * 0.72, 650);
      return clamp(
        Math.min(targetWidth / width, targetHeight / height),
        mobile ? 1.15 : 1.35,
        mobile ? 2.10 : tablet ? 2.8 : 3.1
      );
    }

    function settleCardDialogOpen() {
      if (!cardDialogOpen || cardDialogClosing) return;
      cardDialogSettled = true;
      root.classList.add('is-card-settled');
      cardDialog.classList.add('is-settled');
      if (cardDialogClose) cardDialogClose.focus({ preventScroll: true });
    }

    function cancelDialogAnimations() {
      if (cardDialogAnimation) {
        try { cardDialogAnimation.cancel(); } catch (error) {}
        cardDialogAnimation = null;
      }
      if (planeDialogAnimation) {
        try { planeDialogAnimation.cancel(); } catch (error) {}
        planeDialogAnimation = null;
      }
    }

    function onCardDialogWheel(event) {
      if (!cardDialogOpen || cardDialogClosing) return;
      if (event.deltaY > 4) closeCardDialog();
    }

    function onCardDialogScroll() {
      if (!cardDialogOpen || cardDialogClosing) return;
      if (window.scrollY > dialogOpenScrollY + 2) closeCardDialog();
    }

    function finishCardDialogClose() {
      cancelDialogAnimations();
      if (expandedSource) {
        expandedSource.classList.remove('is-tarot-expanded');
        expandedSource.style.transform = sourceCardTransform;
      }

      root.classList.remove('is-card-open', 'is-card-closing', 'is-card-settled');
      if (cardDialog) {
        cardDialog.classList.remove('is-open', 'is-closing', 'is-settled');
        cardDialog.setAttribute('aria-hidden', 'true');
      }

      document.body.classList.remove('pham-vault-card-open');
      document.removeEventListener('keydown', onCardDialogKeydown);
      window.removeEventListener('wheel', onCardDialogWheel);
      window.removeEventListener('scroll', onCardDialogScroll);
      cardDialogOpen = false;
      cardDialogClosing = false;
      cardDialogSettled = false;
      expandedSource = null;
      sourceCardTransform = '';
      sourcePlaneTransform = '';
      dialogOpenScrollY = 0;
      dialogPlaneTilt = 0;
      dialogPlaneLean = 0;

      if (dialogReturnFocus && typeof dialogReturnFocus.focus === 'function') {
        try { dialogReturnFocus.focus(); } catch (error) {}
      }
      dialogReturnFocus = null;
    }

    function reverseAnimation(animation, fallbackDuration) {
      if (!animation) return;
      const timing = animation.effect && animation.effect.getTiming ? animation.effect.getTiming() : null;
      const duration = timing && Number(timing.duration) ? Number(timing.duration) : fallbackDuration;
      if (animation.currentTime == null) animation.currentTime = duration;
      animation.playbackRate = -1;
      animation.play();
    }

    function closeCardDialog() {
      if (!cardDialogOpen || cardDialogClosing || !expandedSource) return;

      cardDialogClosing = true;
      cardDialogSettled = false;
      root.classList.remove('is-card-settled');
      root.classList.add('is-card-closing');
      cardDialog.classList.remove('is-settled');
      cardDialog.classList.add('is-closing');

      if (reducedMotion || !cardDialogAnimation) {
        finishCardDialogClose();
        return;
      }

      reverseAnimation(cardDialogAnimation, 820);
      if (planeDialogAnimation) reverseAnimation(planeDialogAnimation, 820);
      cardDialogAnimation.onfinish = finishCardDialogClose;
    }

    function onCardDialogKeydown(event) {
      if (!cardDialogOpen) return;
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        closeCardDialog();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        if (cardDialogClose && cardDialogSettled) cardDialogClose.focus();
      }
    }

    function openCardDialog(card) {
      if (!cardExpandMode.matches || cardDialogOpen || dragMoved) return;

      ensureCardDialog();
      cancelDialogAnimations();

      cardDialogOpen = true;
      cardDialogClosing = false;
      cardDialogSettled = false;
      expandedSource = card;
      dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      sourceCardTransform = card.style.transform || window.getComputedStyle(card).transform;
      sourcePlaneTransform = orbitPlane.style.transform || window.getComputedStyle(orbitPlane).transform;
      dialogOpenScrollY = window.scrollY;
      dialogPlaneTilt = currentTilt;
      dialogPlaneLean = 6 + Math.sin(smoothProgress * Math.PI * 2) * 0.35;

      const mobileDialog = window.innerWidth < 600;
      const targetScale = getExpandedCardScale(card);
      const targetCardTransform = mobileDialog
        ? 'translate3d(-50%, -50%, 0) rotateY(0rad) translateZ(0px) rotateZ(0deg) translate3d(0,0,0) scale(' +
          targetScale.toFixed(4) +
          ')'
        : 'translate3d(-50%, -50%, 0) ' +
          'rotateZ(' + (-dialogPlaneLean).toFixed(3) + 'deg) ' +
          'rotateX(' + (-dialogPlaneTilt).toFixed(3) + 'deg) ' +
          'rotateY(0rad) translateZ(0px) rotateZ(0deg) translate3d(0,0,0) scale(' +
          targetScale.toFixed(4) +
          ')';
      card.classList.add('is-tarot-expanded');
      root.classList.add('is-card-open');
      cardDialog.classList.add('is-open');
      cardDialog.setAttribute('aria-hidden', 'false');
      document.body.classList.add('pham-vault-card-open');
      document.addEventListener('keydown', onCardDialogKeydown);
      window.addEventListener('wheel', onCardDialogWheel, { passive: true });
      window.addEventListener('scroll', onCardDialogScroll, { passive: true });

      if (reducedMotion || typeof card.animate !== 'function') {
        card.style.transform = targetCardTransform;
        settleCardDialogOpen();
        return;
      }

      const duration = 820;
      const easing = 'cubic-bezier(.37,0,.63,1)';

      cardDialogAnimation = card.animate(
        [{ transform: sourceCardTransform }, { transform: targetCardTransform }],
        { duration, easing, fill: 'both' }
      );

      if (mobileDialog && typeof orbitPlane.animate === 'function') {
        planeDialogAnimation = orbitPlane.animate(
          [{ transform: sourcePlaneTransform }, { transform: 'rotateX(0deg) rotateZ(0deg)' }],
          { duration, easing, fill: 'both' }
        );
      }

      cardDialogAnimation.onfinish = function () {
        if (cardDialogClosing) return;
        cardDialogAnimation.pause();
        cardDialogAnimation.currentTime = duration;
        if (planeDialogAnimation) {
          planeDialogAnimation.pause();
          planeDialogAnimation.currentTime = duration;
        }
        settleCardDialogOpen();
      };
    }

    function render(time) {
      if (!active) {
        frame = 0;
        return;
      }
      const delta = Math.min((time - previousTime) / 1000, 0.1);
      previousTime = time;
      smoothProgress = damp(smoothProgress, progress, 5.5, delta);
      root.style.setProperty('--vault-progress', smoothProgress.toFixed(4));
      setChapter(Math.min(chapters.length - 1, Math.floor(smoothProgress * chapters.length)));

      if (!reducedMotion) {
        if (!dragging && !cardDialogOpen) {
          rotation += (autoSpeed + velocity) * delta;
          velocity *= Math.exp(-3.2 * delta);
        }
        currentTilt = damp(currentTilt, targetTilt, 6, delta);
      }

      const spacing = reducedMotion ? 1 : 1.02 + Math.sin(smoothProgress * Math.PI * 3) * 0.02;
      const orbitRadius = radius * spacing;
      const step = Math.PI * 2 / cards.length;
      const orbitLean = 6 + Math.sin(smoothProgress * Math.PI * 2) * 0.35;
      if (!cardDialogOpen) {
        orbitPlane.style.transform = 'rotateX(' + currentTilt.toFixed(2) + 'deg) rotateZ(' + orbitLean.toFixed(2) + 'deg)';
      }
      if (orbitRing) {
        const ringDiameter = orbitRadius * 1.32;
        orbitRing.style.width = ringDiameter.toFixed(2) + 'px';
        orbitRing.style.height = ringDiameter.toFixed(2) + 'px';
      }

      const compactOrbit = window.innerWidth < 600;
      const mobileFocus = window.innerWidth < 900;
      const cardStates = cards.map(function (card, index) {
        const angle = rotation + step * index;
        return {
          angle: angle,
          visualAngle: normalizeAngle(angle),
          depth: (Math.cos(angle) + 1) * 0.5
        };
      });

      let candidateFront = 0;
      for (let index = 1; index < cardStates.length; index += 1) {
        if (cardStates[index].depth > cardStates[candidateFront].depth) candidateFront = index;
      }

      if (
        frontIndex >= 0 &&
        frontIndex !== candidateFront &&
        cardStates[frontIndex] &&
        cardStates[candidateFront].depth < cardStates[frontIndex].depth + 0.035
      ) {
        candidateFront = frontIndex;
      }
      frontIndex = candidateFront;

      cards.forEach(function (card, index) {
        if (cardDialogOpen && card === expandedSource) return;
        const state = cardStates[index];
        const isFront = index === frontIndex;
        const baseScale = compactOrbit ? 0.76 + state.depth * 0.18 : 0.8 + state.depth * 0.2;

        // Continuous front-focus curve prevents the old binary handoff from snapping.
        const rawFocus = clamp((state.depth - 0.74) / 0.26, 0, 1);
        const focus = rawFocus * rawFocus * (3 - 2 * rawFocus);
        const focusScale = 1 + focus * (mobileFocus ? 0.045 : 0.024);
        const lift = focus * (mobileFocus ? 8 : 6);
        const focusLean = mobileFocus ? -4 * focus : 0;
        const cardLean = Math.sin(state.angle) * (compactOrbit ? 6 : 8) + focusLean;
        const cardScale = baseScale * focusScale;

        card.classList.toggle('is-front', isFront);
        card.style.setProperty('--pham-card-focus', focus.toFixed(3));
        card.style.zIndex = String(Math.round(state.depth * 100) + (isFront ? 2 : 0));
        card.style.opacity = String(Math.min(1, 0.34 + state.depth * 0.66 + focus * 0.04));
        card.style.filter = 'brightness(' + (0.48 + state.depth * 0.58 + focus * 0.05).toFixed(3) + ')';
        card.style.transform =
          'translate3d(-50%, -50%, 0) rotateY(' + state.visualAngle.toFixed(5) + 'rad) ' +
          'translateZ(' + orbitRadius.toFixed(2) + 'px) rotateZ(' + cardLean.toFixed(2) + 'deg) ' +
          'translate3d(0,' + (-lift).toFixed(2) + 'px,0) scale(' + cardScale.toFixed(3) + ')';
      });

      if (orbitCards && !orbitCards.classList.contains('is-positioned')) {
        orbitCards.classList.add('is-positioned');
      }

      frame = requestAnimationFrame(render);
    }

    function start() {
      if (frame || !active) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(render);
    }

    measureLayout();
    measureProgress();
    measureOrbit();
    setChapter(0);
    window.addEventListener('scroll', measureProgress, { passive: true });
    window.addEventListener('resize', function () {
      measureLayout();
      measureProgress();
      measureOrbit();
      if (cardDialogOpen && !cardExpandMode.matches) {
        closeCardDialog();
      }
    }, { passive: true });
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () {
        measureLayout();
        measureProgress();
      }).observe(root);
    }

    orbit.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      dragging = true;
      horizontalDrag = false;
      dragMoved = false;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragStartRotation = rotation;
      lastPointerX = event.clientX;
      lastPointerTime = performance.now();
      velocity = 0;
    });

    orbit.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;
      const dragThreshold = event.pointerType === 'mouse' ? 5 : 8;

      if (!horizontalDrag && Math.abs(deltaX) > dragThreshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
        horizontalDrag = true;
        dragMoved = true;
        orbit.classList.add('is-dragging');
        try { orbit.setPointerCapture(event.pointerId); } catch (error) { /* capture can fail after pointer cancellation */ }
      }
      if (!horizontalDrag) return;
      event.preventDefault();
      rotation = dragStartRotation + deltaX * 0.009;
      targetTilt = clamp(baseTilt - deltaY * 0.018, baseTilt - 1.5, baseTilt + 1.5);
      const now = performance.now();
      const elapsed = Math.max((now - lastPointerTime) / 1000, 0.016);
      velocity = clamp((event.clientX - lastPointerX) * 0.009 / elapsed, -3.2, 3.2);
      lastPointerX = event.clientX;
      lastPointerTime = now;
    }, { passive: false });

    function endDrag(event) {
      if (!dragging) return;
      dragging = false;
      horizontalDrag = false;
      targetTilt = baseTilt;
      orbit.classList.remove('is-dragging');
      if (event && orbit.hasPointerCapture(event.pointerId)) orbit.releasePointerCapture(event.pointerId);
    }

    orbit.addEventListener('pointerup', endDrag);
    orbit.addEventListener('pointercancel', endDrag);
    orbit.addEventListener('lostpointercapture', function () { endDrag(); });
    orbit.addEventListener('click', function (event) {
      if (dragMoved) {
        event.preventDefault();
        event.stopPropagation();
        dragMoved = false;
      }
    }, true);

    cards.forEach(function (card) {
      card.addEventListener('click', function (event) {
        if (!cardExpandMode.matches || dragMoved) return;
        event.preventDefault();
        event.stopPropagation();
        openCardDialog(card);
      });
    });

    jumps.forEach(function (jump, index) {
      jump.addEventListener('click', function () {
        const denominator = Math.max(chapters.length - 1, 1);
        window.scrollTo({ top: sectionTop + scrollDistance * (index / denominator), behavior: reducedMotion ? 'auto' : 'smooth' });
      });
    });

    root.querySelectorAll('[data-pham-magnetic]').forEach(function (element) {
      if (!finePointer || reducedMotion) return;
      let magneticRect = null;
      element.addEventListener('pointerenter', function () {
        magneticRect = element.getBoundingClientRect();
      }, { passive: true });
      element.addEventListener('pointermove', function (event) {
        if (!magneticRect) return;
        element.style.transform = 'translate3d(' + ((event.clientX - magneticRect.left - magneticRect.width / 2) * 0.08).toFixed(2) + 'px,' + ((event.clientY - magneticRect.top - magneticRect.height / 2) * 0.12).toFixed(2) + 'px,0)';
      });
      element.addEventListener('pointerleave', function () {
        magneticRect = null;
        element.style.transform = '';
      });
    });

    const observer = new IntersectionObserver(function (entries) {
      active = entries[0].isIntersecting;
      if (active) start();
    }, { rootMargin: '20% 0px' });
    observer.observe(root);

    document.addEventListener('visibilitychange', function () {
      active = !document.hidden && root.getBoundingClientRect().bottom > 0 && root.getBoundingClientRect().top < window.innerHeight;
      if (active) start();
    });

    root.addEventListener('shopify:section:unload', function () {
      document.removeEventListener('keydown', onCardDialogKeydown);
      window.removeEventListener('wheel', onCardDialogWheel);
      window.removeEventListener('scroll', onCardDialogScroll);
      cancelDialogAnimations();
      if (cardDialog && cardDialog.parentNode) cardDialog.parentNode.removeChild(cardDialog);
    }, { once: true });
  }

  function mountArchive(root) {
    if (root.dataset.phamArchiveMounted === 'true') return;
    root.dataset.phamArchiveMounted = 'true';
    const track = root.querySelector('[data-pham-archive-track]');
    const viewport = root.querySelector('[data-pham-archive-viewport]');
    if (!track || !viewport || reducedMotion) return;
    let target = 0;
    let current = 0;
    let dragging = false;
    let dragStart = 0;
    let dragProgress = 0;
    let active = false;
    let frame = 0;
    let previousTime = performance.now();
    let sectionTop = 0;
    let scrollDistance = 1;
    let translateDistance = 0;

    function measureArchiveLayout() {
      const rect = root.getBoundingClientRect();
      sectionTop = window.scrollY + rect.top;
      scrollDistance = Math.max(root.offsetHeight - window.innerHeight, 1);
      translateDistance = Math.max(track.scrollWidth - window.innerWidth, 0);
    }

    function fromScroll() {
      if (dragging) return;
      target = clamp((window.scrollY - sectionTop) / scrollDistance, 0, 1);
    }

    function draw(time) {
      if (!active) {
        frame = 0;
        return;
      }
      const delta = Math.min((time - previousTime) / 1000, 0.1);
      previousTime = time;
      current = damp(current, target, 6, delta);
      track.style.transform = 'translate3d(' + (-translateDistance * current).toFixed(2) + 'px,0,0)';
      root.style.setProperty('--archive-progress', current.toFixed(4));
      frame = requestAnimationFrame(draw);
    }

    function start() {
      if (frame || !active) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(draw);
    }

    viewport.addEventListener('pointerdown', function (event) {
      if (!finePointer) return;
      dragging = true;
      dragStart = event.clientX;
      dragProgress = target;
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      const distance = Math.max(translateDistance, 1);
      target = clamp(dragProgress - (event.clientX - dragStart) / distance, 0, 1);
    });
    viewport.addEventListener('pointerup', function (event) {
      dragging = false;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointercancel', function () { dragging = false; });
    measureArchiveLayout();
    fromScroll();
    window.addEventListener('scroll', fromScroll, { passive: true });
    window.addEventListener('resize', function () {
      measureArchiveLayout();
      fromScroll();
    }, { passive: true });
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () {
        measureArchiveLayout();
        fromScroll();
      }).observe(root);
    }

    const observer = new IntersectionObserver(function (entries) {
      active = entries[0].isIntersecting;
      if (active) {
        fromScroll();
        start();
      }
    }, { rootMargin: '20% 0px' });
    observer.observe(root);
  }

  function syncHeaderOffset() {
    const spacer = document.querySelector('.pham-header__spacer');
    const header = document.querySelector('.pham-header');
    const source = spacer || header;
    const height = source ? Math.max(0, Math.round(source.getBoundingClientRect().height)) : 0;
    document.documentElement.style.setProperty('--pham-header-offset', height + 'px');
  }

  function mountAll(scope) {
    syncHeaderOffset();
    (scope || document).querySelectorAll('[data-pham-vault]').forEach(mountVault);
    (scope || document).querySelectorAll('[data-pham-archive]').forEach(mountArchive);
  }

  window.addEventListener('resize', syncHeaderOffset, { passive: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mountAll(); }, { once: true });
  else mountAll();
  document.addEventListener('shopify:section:load', function (event) { mountAll(event.target); });
})();
