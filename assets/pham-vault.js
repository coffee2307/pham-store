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
  const smoothStep = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const interpolateStops = (stops, value) => {
    if (!stops.length) return 1;
    if (stops.length === 1) return stops[0];
    const scaled = clamp(value, 0, 1) * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(scaled));
    const local = smoothStep(scaled - index);
    return stops[index] + (stops[index + 1] - stops[index]) * local;
  };

  function mountVault(root) {
    if (root.dataset.phamVaultMounted === 'true') return;
    root.dataset.phamVaultMounted = 'true';
    const sticky = root.querySelector('.pham-vault__sticky');
    const orbit = root.querySelector('[data-pham-vault-orbit]');
    const orbitPlane = root.querySelector('[data-pham-vault-orbit-plane]');
    const orbitCore = root.querySelector('[data-pham-vault-core]');
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
    let rotation = 0.08;
    let currentTilt = baseTilt;
    let targetTilt = baseTilt;
    let targetPointerX = 0;
    let targetPointerY = 0;
    let currentPointerX = 0;
    let currentPointerY = 0;
    let targetPointerPresence = 0;
    let currentPointerPresence = 0;
    let dragging = false;
    let horizontalDrag = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartRotation = 0;
    let dragTargetRotation = rotation;
    let lastPointerX = 0;
    let lastPointerTime = 0;
    let velocity = 0;
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
    let cardDialogSettled = false;
    let cardDialogClosing = false;
    let sourceCardTransform = '';
    let dialogOpenScrollY = 0;
    let dialogPlaneTilt = 0;
    let dialogPlaneLean = 0;
    let mobileOrbitResume = 1;

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
        // Desktop: keep the ring a little tighter so the larger cards read
        // as one sculptural object instead of isolated tiles.
        targetRadius = Math.max(width * 0.295, cardWidth * 1.16 * density);
        radius = clamp(targetRadius, 265, 430);
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
        ? Math.min(window.innerWidth * 0.78, 330)
        : tablet
          ? Math.min(window.innerWidth * 0.54, 460)
          : Math.min(540, window.innerWidth * 0.34);
      const targetHeight = mobile
        ? Math.min(window.innerHeight * 0.64, 500)
        : tablet
          ? Math.min(window.innerHeight * 0.68, 620)
          : Math.min(window.innerHeight * 0.78, 720);
      return clamp(
        Math.min(targetWidth / width, targetHeight / height),
        mobile ? 1.3 : 1.45,
        mobile ? 2.8 : tablet ? 3.05 : 3.45
      );
    }

    function markExpandedCardOcclusion(card, targetScale, orbitRect, mobileDialog) {
      cards.forEach(function (peer) {
        peer.classList.remove('is-occluded-by-expanded');
      });

      // Mobile already fades every peer completely while the card is open.
      // On larger viewports, keep the surrounding orbit visible but remove
      // only peers whose projected bounds would cross the enlarged card.
      if (mobileDialog) return;

      const targetWidth = Math.max(card.offsetWidth * targetScale, 1);
      const targetHeight = Math.max(card.offsetHeight * targetScale, 1);
      const centerX = orbitRect.left + orbitRect.width * 0.5;
      const centerY = orbitRect.top + orbitRect.height * 0.5;
      const margin = 18;
      const targetRect = {
        left: centerX - targetWidth * 0.5 - margin,
        right: centerX + targetWidth * 0.5 + margin,
        top: centerY - targetHeight * 0.5 - margin,
        bottom: centerY + targetHeight * 0.5 + margin
      };

      cards.forEach(function (peer) {
        if (peer === card) return;
        const rect = peer.getBoundingClientRect();
        const overlaps =
          rect.right > targetRect.left &&
          rect.left < targetRect.right &&
          rect.bottom > targetRect.top &&
          rect.top < targetRect.bottom;

        if (overlaps) peer.classList.add('is-occluded-by-expanded');
      });
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

      cards.forEach(function (card) {
        card.classList.remove('is-occluded-by-expanded');
      });

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
      if (window.innerWidth < 600) mobileOrbitResume = 0;

      if (expandedSource && expandedSource.getAttribute('role') === 'button') {
        expandedSource.setAttribute('aria-expanded', 'false');
      }

      expandedSource = null;
      sourceCardTransform = '';
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

      // Release peer occlusion as soon as the close transition starts.
      // Previously these classes stayed on until finishCardDialogClose(), so
      // overlapping neighbour cards remained forced to opacity: 0 and then
      // popped back only after the expanded-card reverse animation finished.
      cards.forEach(function (peer) {
        peer.classList.remove('is-occluded-by-expanded');
      });

      root.classList.remove('is-card-settled');
      root.classList.add('is-card-closing');
      cardDialog.classList.remove('is-settled');
      cardDialog.classList.add('is-closing');

      if (reducedMotion || !cardDialogAnimation) {
        finishCardDialogClose();
        return;
      }

      reverseAnimation(cardDialogAnimation, 820);
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
      if (!cardExpandMode.matches || cardDialogOpen) return;

      ensureCardDialog();
      cancelDialogAnimations();

      cardDialogOpen = true;
      cardDialogClosing = false;
      cardDialogSettled = false;
      if (window.innerWidth < 600) mobileOrbitResume = 0;
      expandedSource = card;
      if (card.getAttribute('role') === 'button') card.setAttribute('aria-expanded', 'true');
      dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      sourceCardTransform = card.style.transform || window.getComputedStyle(card).transform;
      dialogOpenScrollY = window.scrollY;
      targetPointerX = 0;
      targetPointerY = 0;
      targetPointerPresence = 0;
      dialogPlaneTilt = currentTilt;
      dialogPlaneLean =
        6 +
        Math.sin(smoothProgress * Math.PI * 2) * 0.35 +
        currentPointerX * 2.6 * currentPointerPresence;

      const mobileDialog = window.innerWidth < 600;
      const targetScale = getExpandedCardScale(card);
      const orbitRect = orbit.getBoundingClientRect();
      const mobileOffsetX = mobileDialog
        ? (window.innerWidth * 0.5) - (orbitRect.left + orbitRect.width * 0.5)
        : 0;
      const mobileOffsetY = mobileDialog
        ? (window.innerHeight * 0.5) - (orbitRect.top + orbitRect.height * 0.5)
        : 0;

      markExpandedCardOcclusion(card, targetScale, orbitRect, mobileDialog);

      const targetCardTransform = mobileDialog
        ? 'translate3d(-50%, -50%, 0) ' +
          'rotateZ(' + (-dialogPlaneLean).toFixed(3) + 'deg) ' +
          'rotateX(' + (-dialogPlaneTilt).toFixed(3) + 'deg) ' +
          'translate3d(' +
          mobileOffsetX.toFixed(2) + 'px,' +
          mobileOffsetY.toFixed(2) + 'px,0) ' +
          'rotateY(0rad) translateZ(0px) rotateZ(0deg) scale(' +
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

      cardDialogAnimation.onfinish = function () {
        if (cardDialogClosing) return;
        cardDialogAnimation.pause();
        cardDialogAnimation.currentTime = duration;
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
        currentPointerX = damp(currentPointerX, targetPointerX, 5.6, delta);
        currentPointerY = damp(currentPointerY, targetPointerY, 5.6, delta);
        currentPointerPresence = damp(currentPointerPresence, targetPointerPresence, 4.8, delta);

        if (dragging) {
          rotation = damp(rotation, dragTargetRotation, 24, delta);
        } else if (!cardDialogOpen) {
          if (window.innerWidth < 600) {
            mobileOrbitResume = damp(mobileOrbitResume, 1, 4.8, delta);
            rotation += (autoSpeed * mobileOrbitResume + velocity) * delta;
          } else {
            mobileOrbitResume = 1;
            rotation += (autoSpeed + velocity) * delta;
          }
          velocity *= Math.exp(-3.0 * delta);
        }

        targetTilt = baseTilt - currentPointerY * 15.5 * currentPointerPresence;
        currentTilt = damp(currentTilt, targetTilt, 5.2, delta);
      } else {
        currentPointerX = 0;
        currentPointerY = 0;
        currentPointerPresence = 0;
        currentTilt = baseTilt;
      }

      const pointerMagnitude = Math.min(1, Math.hypot(currentPointerX, currentPointerY));
      const pointerEnergy = pointerMagnitude * currentPointerPresence;

      // The reference exposes zoom and three spacing states as explicit controls.
      // PHAM maps those states continuously to the scroll narrative instead.
      const scrollZoom = reducedMotion
        ? 1
        : interpolateStops([0.97, 1.01, 1.10, 1.05, 1.02], smoothProgress);
      const scrollSpacing = reducedMotion
        ? 1
        : interpolateStops([0.96, 1.00, 1.08, 1.05, 1.02], smoothProgress);
      const pointerSpacing = reducedMotion
        ? 1
        : 1 + currentPointerPresence * (0.012 + pointerMagnitude * 0.055);
      const orbitRadius = radius * scrollSpacing * pointerSpacing;
      const step = Math.PI * 2 / cards.length;
      const responsiveRotation = rotation + currentPointerX * 0.12 * currentPointerPresence;
      // Initial composition: let the card ring sit lower and lean slightly
      // left so the PHAM wordmark remains visually dominant on first load.
      // Both offsets ease back into the normal orbit choreography as the
      // visitor begins scrolling through the vault.
      const introRelease = clamp(smoothProgress / 0.24, 0, 1);
      const introEase = introRelease * introRelease * (3 - 2 * introRelease);
      const introRingDrop = (1 - introEase) * 46;
      const introLean = -4.5 * (1 - introEase);
      const orbitLean =
        6 * introEase +
        introLean +
        Math.sin(smoothProgress * Math.PI * 2) * 0.3 +
        currentPointerX * 2.2 * currentPointerPresence;
      const ringTiltY = currentPointerX * 18.5 * currentPointerPresence;
      const pointerShiftX = currentPointerX * 22 * currentPointerPresence;
      const pointerShiftY = currentPointerY * 12 * currentPointerPresence;

      // Counter-parallax keeps the copy feeling suspended in the centre,
      // rather than printed onto the same plane as the cards.
      const coreShiftX = currentPointerX * -10 * currentPointerPresence;
      const coreShiftY = currentPointerY * -6 * currentPointerPresence;
      const coreTiltX = currentPointerY * -1.8 * currentPointerPresence;
      const coreTiltY = currentPointerX * 2.8 * currentPointerPresence;
      // One restrained scroll pulse: PHAM grows slightly while the card
      // surfaces become translucent, then both return to their neutral state.
      const scrollEmphasis = reducedMotion ? 0 : Math.sin(Math.PI * smoothProgress);
      const coreScale =
        1 +
        pointerEnergy * 0.012 +
        (scrollZoom - 1) * 0.16 +
        scrollEmphasis * 0.085;
      const cardContentOpacity = 1 - scrollEmphasis * 0.48;

      root.style.setProperty('--vault-pointer-energy', pointerEnergy.toFixed(3));
      root.style.setProperty('--vault-card-content-opacity', cardContentOpacity.toFixed(3));
      root.style.setProperty('--vault-scroll-zoom', scrollZoom.toFixed(4));
      root.style.setProperty('--vault-scroll-spacing', scrollSpacing.toFixed(4));

      if (orbitCore && !cardDialogOpen && window.innerWidth >= 900) {
        orbitCore.style.transform =
          'translate3d(calc(-50% + ' + coreShiftX.toFixed(2) + 'px), calc(-50% + ' + coreShiftY.toFixed(2) + 'px), 0) ' +
          'rotateX(' + coreTiltX.toFixed(2) + 'deg) rotateY(' + coreTiltY.toFixed(2) + 'deg) ' +
          'scale(' + coreScale.toFixed(4) + ')';
      }

      if (!cardDialogOpen) {
        orbitPlane.style.transform =
          'translate3d(' + pointerShiftX.toFixed(2) + 'px,' + pointerShiftY.toFixed(2) + 'px,0) ' +
          'rotateX(' + currentTilt.toFixed(2) + 'deg) ' +
          'rotateY(' + ringTiltY.toFixed(2) + 'deg) ' +
          'rotateZ(' + orbitLean.toFixed(2) + 'deg) ' +
          'scale(' + scrollZoom.toFixed(4) + ')';
      }

      const compactOrbit = window.innerWidth < 600;
      const mobileFocus = window.innerWidth < 900;
      const cardStates = cards.map(function (card, index) {
        const angle = responsiveRotation + step * index;
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
        card.style.zIndex = String(Math.round(state.depth * 100) + (isFront ? 2 : 0));
        card.style.opacity = String(Math.min(1, 0.34 + state.depth * 0.66 + focus * 0.04));
        card.style.filter = 'brightness(' + (0.48 + state.depth * 0.58 + focus * 0.05).toFixed(3) + ')';
        card.style.transform =
          'translate3d(-50%, -50%, 0) ' +
          'rotateY(' + state.visualAngle.toFixed(5) + 'rad) ' +
          'translateZ(' + orbitRadius.toFixed(2) + 'px) rotateZ(' + cardLean.toFixed(2) + 'deg) ' +
          'translate3d(0,' + (introRingDrop - lift).toFixed(2) + 'px,0) scale(' + cardScale.toFixed(3) + ')';
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

    function updateOrbitPointer(event) {
      if (!finePointer || reducedMotion || cardDialogOpen || dragging) return;

      const rect = sticky.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      targetPointerX = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
      targetPointerY = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
      targetPointerPresence = 1;
    }

    function resetOrbitPointer() {
      targetPointerX = 0;
      targetPointerY = 0;
      targetPointerPresence = 0;
    }

    sticky.addEventListener('pointermove', updateOrbitPointer, { passive: true });
    sticky.addEventListener('pointerleave', resetOrbitPointer, { passive: true });

    function beginOrbitDrag(event) {
      if (cardDialogOpen) return;
      if (event.button !== undefined && event.button !== 0) return;

      dragging = true;
      horizontalDrag = false;
      dragMoved = false;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragStartRotation = rotation;
      dragTargetRotation = rotation;
      lastPointerX = event.clientX;
      lastPointerTime = performance.now();
      velocity = 0;
      targetPointerPresence = 0;
      orbit.classList.add('is-dragging');
    }

    function moveOrbitDrag(event) {
      if (!dragging) return;

      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;
      const distance = Math.hypot(deltaX, deltaY);
      const threshold = event.pointerType === 'mouse' ? 3 : 7;

      if (!horizontalDrag && distance > threshold) {
        horizontalDrag = true;
        dragMoved = true;
        try { orbit.setPointerCapture(event.pointerId); } catch (error) {}
      }
      if (!horizontalDrag) return;

      event.preventDefault();

      dragTargetRotation = dragStartRotation + deltaX * 0.0105;
      targetPointerX = clamp(deltaX / Math.max(orbit.clientWidth * 0.30, 1), -1, 1);
      targetPointerY = clamp(deltaY / Math.max(orbit.clientHeight * 0.30, 1), -1, 1);
      targetPointerPresence = 0.94;

      const now = performance.now();
      const elapsed = Math.max((now - lastPointerTime) / 1000, 0.012);
      const instantaneous = clamp(
        (event.clientX - lastPointerX) * 0.0105 / elapsed,
        -3.8,
        3.8
      );
      velocity = velocity * 0.58 + instantaneous * 0.42;
      lastPointerX = event.clientX;
      lastPointerTime = now;
    }

    function finishOrbitDrag(event) {
      if (!dragging) return;

      dragging = false;
      horizontalDrag = false;
      dragTargetRotation = rotation;
      targetPointerX = 0;
      targetPointerY = 0;
      targetPointerPresence = 0;
      orbit.classList.remove('is-dragging');

      if (event && orbit.hasPointerCapture && orbit.hasPointerCapture(event.pointerId)) {
        try { orbit.releasePointerCapture(event.pointerId); } catch (error) {}
      }

      window.setTimeout(function () {
        dragMoved = false;
      }, 120);
    }

    function spinOrbitFromTrackpad(event) {
      if (reducedMotion || cardDialogOpen || dragging) return;

      const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.72;
      if (!horizontalIntent) return;

      event.preventDefault();
      velocity = clamp(velocity + event.deltaX * 0.0032, -3.4, 3.4);
    }

    orbit.addEventListener('pointerdown', beginOrbitDrag);
    orbit.addEventListener('pointermove', moveOrbitDrag, { passive: false });
    orbit.addEventListener('pointerup', finishOrbitDrag);
    orbit.addEventListener('pointercancel', finishOrbitDrag);
    orbit.addEventListener('lostpointercapture', finishOrbitDrag);
    orbit.addEventListener('wheel', spinOrbitFromTrackpad, { passive: false });

    cards.forEach(function (card) {
      card.addEventListener('click', function (event) {
        if (dragMoved) {
          event.preventDefault();
          event.stopPropagation();
          dragMoved = false;
          return;
        }
        // Cards with an explicit link must remain normal links. Only the
        // button-style archive cards use the expanded-image interaction.
        if (card.getAttribute('role') !== 'button') return;
        if (!cardExpandMode.matches) return;
        event.preventDefault();
        event.stopPropagation();
        openCardDialog(card);
      });
      card.addEventListener('keydown', function (event) {
        if (card.getAttribute('role') !== 'button') return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
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
      sticky.removeEventListener('pointermove', updateOrbitPointer);
      sticky.removeEventListener('pointerleave', resetOrbitPointer);
      orbit.removeEventListener('pointerdown', beginOrbitDrag);
      orbit.removeEventListener('pointermove', moveOrbitDrag);
      orbit.removeEventListener('pointerup', finishOrbitDrag);
      orbit.removeEventListener('pointercancel', finishOrbitDrag);
      orbit.removeEventListener('lostpointercapture', finishOrbitDrag);
      orbit.removeEventListener('wheel', spinOrbitFromTrackpad);
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
