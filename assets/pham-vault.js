(function () {
  'use strict';

  if (window.__PHAM_VAULT__) return;
  window.__PHAM_VAULT__ = true;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const damp = (current, target, speed, delta) => current + (target - current) * (1 - Math.exp(-speed * delta));

  function createSpatialCanvas(root, canvas) {
    if (!canvas || reducedMotion || saveData || window.innerWidth < 900 || root.dataset.canvasEnabled === 'false') return null;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;

    function resize() {
      width = root.clientWidth;
      height = root.querySelector('.pham-vault__sticky').clientHeight;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function draw(progress, pointerX, pointerY) {
      context.fillStyle = '#050505';
      context.fillRect(0, 0, width, height);
      const centerX = width * (0.5 + pointerX * 0.018);
      const centerY = height * (0.47 + pointerY * 0.014);
      const maxWidth = Math.min(width * 0.76, 1040);
      const maxHeight = Math.min(height * 0.78, 840);
      const offset = (progress * 10) % 1;

      for (let index = 0; index < 11; index += 1) {
        const depth = (index + offset) / 10;
        const eased = depth * depth;
        const frameWidth = 80 + (maxWidth - 80) * eased;
        const frameHeight = 110 + (maxHeight - 110) * eased;
        const opacity = 0.035 + depth * 0.095;
        context.strokeStyle = 'rgba(224,224,218,' + opacity.toFixed(3) + ')';
        context.lineWidth = 1;
        context.strokeRect(centerX - frameWidth / 2, centerY - frameHeight / 2, frameWidth, frameHeight);
      }

      context.strokeStyle = 'rgba(224,224,218,.07)';
      [
        [centerX - maxWidth / 2, centerY - maxHeight / 2],
        [centerX + maxWidth / 2, centerY - maxHeight / 2],
        [centerX - maxWidth / 2, centerY + maxHeight / 2],
        [centerX + maxWidth / 2, centerY + maxHeight / 2]
      ].forEach(function (corner) {
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(corner[0], corner[1]);
        context.stroke();
      });

      const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.62);
      gradient.addColorStop(0, 'rgba(255,255,255,.035)');
      gradient.addColorStop(0.52, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,.58)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }

    resize();
    root.classList.add('is-canvas-ready');
    return { resize: resize, draw: draw };
  }

  function mountVault(root) {
    if (root.dataset.phamVaultMounted === 'true') return;
    root.dataset.phamVaultMounted = 'true';
    const sticky = root.querySelector('.pham-vault__sticky');
    const canvas = root.querySelector('[data-pham-vault-canvas]');
    const object = root.querySelector('[data-pham-vault-object]');
    const chapters = Array.from(root.querySelectorAll('[data-pham-vault-chapter]'));
    const jumps = Array.from(root.querySelectorAll('[data-pham-vault-jump]'));
    const cursor = root.querySelector('[data-pham-vault-cursor]');
    const canvasState = createSpatialCanvas(root, canvas);
    const objectScale = clamp(Number.parseFloat(root.dataset.objectScale) || 0.85, 0.7, 1.1);
    let active = false;
    let frame = 0;
    let previousTime = performance.now();
    let progress = 0;
    let smoothProgress = 0;
    let pointerX = 0;
    let pointerY = 0;
    let smoothPointerX = 0;
    let smoothPointerY = 0;
    let currentChapter = -1;

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
      smoothPointerX = damp(smoothPointerX, pointerX, 7, delta);
      smoothPointerY = damp(smoothPointerY, pointerY, 7, delta);
      root.style.setProperty('--vault-progress', smoothProgress.toFixed(4));
      setChapter(Math.min(chapters.length - 1, Math.floor(smoothProgress * chapters.length)));

      if (object && !reducedMotion) {
        const wave = Math.sin(smoothProgress * Math.PI * 2);
        const x = wave * 4.2 + smoothPointerX * 10;
        const y = -48 + Math.sin(smoothProgress * Math.PI) * -2 + smoothPointerY * 4;
        const scale = objectScale * (1 + Math.sin(smoothProgress * Math.PI) * 0.06);
        const rotateY = wave * -3 + smoothPointerX * 2.5;
        object.style.transform = 'translate3d(calc(-50% + ' + x.toFixed(2) + 'px), ' + y.toFixed(2) + '%, 0) rotateY(' + rotateY.toFixed(2) + 'deg) scale(' + scale.toFixed(4) + ')';
      }
      if (canvasState) canvasState.draw(smoothProgress, smoothPointerX, smoothPointerY);
      frame = requestAnimationFrame(render);
    }

    function start() {
      if (frame || !active) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(render);
    }

    measureProgress();
    setChapter(0);
    window.addEventListener('scroll', measureProgress, { passive: true });
    window.addEventListener('resize', function () {
      measureProgress();
      if (canvasState) canvasState.resize();
    }, { passive: true });

    root.addEventListener('pointermove', function (event) {
      const rect = sticky.getBoundingClientRect();
      pointerX = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
      pointerY = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
      if (cursor && finePointer) cursor.style.transform = 'translate3d(' + (event.clientX - 38) + 'px,' + (event.clientY - 38) + 'px,0)';
    }, { passive: true });
    root.addEventListener('pointerleave', function () {
      pointerX = 0;
      pointerY = 0;
      if (cursor) cursor.style.transform = 'translate3d(-100px,-100px,0)';
    }, { passive: true });

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
