(function () {
  'use strict';

  if (window.__PHAM_VAULT__) return;
  window.__PHAM_VAULT__ = true;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const damp = (current, target, speed, delta) => current + (target - current) * (1 - Math.exp(-speed * delta));

  function mountVault(root) {
    if (root.dataset.phamVaultMounted === 'true') return;
    root.dataset.phamVaultMounted = 'true';
    const sticky = root.querySelector('.pham-vault__sticky');
    const orbit = root.querySelector('[data-pham-vault-orbit]');
    const orbitPlane = root.querySelector('[data-pham-vault-orbit-plane]');
    const orbitRing = root.querySelector('.pham-vault__orbit-ring');
    const cards = Array.from(root.querySelectorAll('[data-pham-vault-card]'));
    const chapters = Array.from(root.querySelectorAll('[data-pham-vault-chapter]'));
    const jumps = Array.from(root.querySelectorAll('[data-pham-vault-jump]'));
    if (!sticky || !orbit || !orbitPlane || !cards.length) return;
    const autoSpeed = clamp(Number.parseFloat(root.dataset.orbitSpeed) || 6, 0, 16) * Math.PI / 180;
    const baseTilt = clamp(Number.parseFloat(root.dataset.orbitTilt) || 8, 2, 16);
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

    function measureOrbit() {
      const width = orbit.clientWidth;
      radius = window.innerWidth < 600
        ? clamp(width * 0.31, 118, 168)
        : clamp(width * 0.31, 210, 455);
    }

    function measureProgress() {
      const rect = root.getBoundingClientRect();
      const distance = Math.max(root.offsetHeight - window.innerHeight, 1);
      progress = clamp(-rect.top / distance, 0, 1);
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
        if (!dragging) {
          rotation += (autoSpeed + velocity) * delta;
          velocity *= Math.exp(-3.2 * delta);
        }
        currentTilt = damp(currentTilt, targetTilt, 6, delta);
      }

      const spacing = reducedMotion ? 1 : 1 + Math.sin(smoothProgress * Math.PI * 3) * 0.1;
      const orbitRadius = radius * spacing;
      const step = Math.PI * 2 / cards.length;
      const orbitLean = 4 + Math.sin(smoothProgress * Math.PI * 2) * 1.25;
      orbitPlane.style.transform = 'rotateX(' + currentTilt.toFixed(2) + 'deg) rotateZ(' + orbitLean.toFixed(2) + 'deg)';
      if (orbitRing) {
        const ringDiameter = orbitRadius * 1.32;
        orbitRing.style.width = ringDiameter.toFixed(2) + 'px';
        orbitRing.style.height = ringDiameter.toFixed(2) + 'px';
      }

      cards.forEach(function (card, index) {
        const angle = rotation + step * index;
        const depth = (Math.cos(angle) + 1) * 0.5;
        const cardScale = 0.82 + depth * 0.2;
        const cardLean = Math.sin(angle) * 8;
        card.style.zIndex = String(Math.round(depth * 100));
        card.style.opacity = String(0.34 + depth * 0.66);
        card.style.filter = 'brightness(' + (0.48 + depth * 0.58).toFixed(3) + ')';
        card.style.transform = 'translate3d(-50%, -50%, 0) rotateY(' + angle.toFixed(5) + 'rad) translateZ(' + orbitRadius.toFixed(2) + 'px) rotateZ(' + cardLean.toFixed(2) + 'deg) scale(' + cardScale.toFixed(3) + ')';
      });

      frame = requestAnimationFrame(render);
    }

    function start() {
      if (frame || !active) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(render);
    }

    measureProgress();
    measureOrbit();
    setChapter(0);
    window.addEventListener('scroll', measureProgress, { passive: true });
    window.addEventListener('resize', function () {
      measureProgress();
      measureOrbit();
    }, { passive: true });

    orbit.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      dragging = true;
      horizontalDrag = event.pointerType === 'mouse';
      dragMoved = false;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragStartRotation = rotation;
      lastPointerX = event.clientX;
      lastPointerTime = performance.now();
      velocity = 0;
      orbit.classList.add('is-dragging');
      if (event.pointerType === 'mouse') orbit.setPointerCapture(event.pointerId);
    });

    orbit.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;
      if (!horizontalDrag && Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
        horizontalDrag = true;
        orbit.setPointerCapture(event.pointerId);
      }
      if (!horizontalDrag) return;
      event.preventDefault();
      dragMoved = dragMoved || Math.abs(deltaX) > 5;
      rotation = dragStartRotation + deltaX * 0.009;
      targetTilt = clamp(baseTilt - deltaY * 0.03, baseTilt - 3, baseTilt + 3);
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

    jumps.forEach(function (jump, index) {
      jump.addEventListener('click', function () {
        const sectionTop = window.scrollY + root.getBoundingClientRect().top;
        const distance = root.offsetHeight - window.innerHeight;
        const denominator = Math.max(chapters.length - 1, 1);
        window.scrollTo({ top: sectionTop + distance * (index / denominator), behavior: reducedMotion ? 'auto' : 'smooth' });
      });
    });

    root.querySelectorAll('[data-pham-magnetic]').forEach(function (element) {
      if (!finePointer || reducedMotion) return;
      element.addEventListener('pointermove', function (event) {
        const rect = element.getBoundingClientRect();
        element.style.transform = 'translate3d(' + ((event.clientX - rect.left - rect.width / 2) * 0.08).toFixed(2) + 'px,' + ((event.clientY - rect.top - rect.height / 2) * 0.12).toFixed(2) + 'px,0)';
      });
      element.addEventListener('pointerleave', function () { element.style.transform = ''; });
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

    function fromScroll() {
      if (dragging) return;
      const rect = root.getBoundingClientRect();
      target = clamp(-rect.top / Math.max(root.offsetHeight - window.innerHeight, 1), 0, 1);
    }

    function draw(time) {
      if (!active) {
        frame = 0;
        return;
      }
      const delta = Math.min((time - previousTime) / 1000, 0.1);
      previousTime = time;
      current = damp(current, target, 6, delta);
      const distance = Math.max(track.scrollWidth - window.innerWidth, 0);
      track.style.transform = 'translate3d(' + (-distance * current).toFixed(2) + 'px,0,0)';
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
      const distance = Math.max(track.scrollWidth - window.innerWidth, 1);
      target = clamp(dragProgress - (event.clientX - dragStart) / distance, 0, 1);
    });
    viewport.addEventListener('pointerup', function (event) {
      dragging = false;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointercancel', function () { dragging = false; });
    window.addEventListener('scroll', fromScroll, { passive: true });
    window.addEventListener('resize', fromScroll, { passive: true });

    const observer = new IntersectionObserver(function (entries) {
      active = entries[0].isIntersecting;
      if (active) {
        fromScroll();
        start();
      }
    }, { rootMargin: '20% 0px' });
    observer.observe(root);
  }

  function mountAll(scope) {
    (scope || document).querySelectorAll('[data-pham-vault]').forEach(mountVault);
    (scope || document).querySelectorAll('[data-pham-archive]').forEach(mountArchive);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mountAll(); }, { once: true });
  else mountAll();
  document.addEventListener('shopify:section:load', function (event) { mountAll(event.target); });
})();
