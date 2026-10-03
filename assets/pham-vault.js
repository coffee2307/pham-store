/* PHAM Vault: scroll-directed product theatre with a resilient 2D fallback. */
(function () {
  'use strict';

  if (window.__PHAM_VAULT__) return;
  window.__PHAM_VAULT__ = true;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.min.js';
  let threePromise;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const damp = (current, target, speed, delta) => current + (target - current) * (1 - Math.exp(-speed * delta));

  function loadThree() {
    if (!threePromise) threePromise = import(THREE_URL);
    return threePromise;
  }

  function createVaultScene(root, canvas) {
    if (!canvas || reducedMotion || saveData || window.innerWidth < 760) return Promise.resolve(null);

    return loadThree().then(function (THREE) {
      const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
      renderer.setClearColor(0x050505, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x050505, 0.092);
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
      camera.position.set(0, 0.15, 8.2);

      const rig = new THREE.Group();
      scene.add(rig);
      const frameMaterial = new THREE.LineBasicMaterial({ color: 0xd8d8d2, transparent: true, opacity: 0.15 });
      const frameGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(5.2, 6.8, 0.08));
      for (let index = 0; index < 10; index += 1) {
        const frame = new THREE.LineSegments(frameGeometry, frameMaterial.clone());
        frame.position.z = -index * 1.85;
        frame.scale.setScalar(1 + index * 0.055);
        frame.material.opacity = Math.max(0.025, 0.16 - index * 0.012);
        rig.add(frame);
      }

      const floor = new THREE.GridHelper(34, 34, 0x777777, 0x242424);
      floor.position.set(0, -3.45, -7);
      floor.material.transparent = true;
      floor.material.opacity = 0.22;
      scene.add(floor);

      const sideGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-4.7, -3.4, 1), new THREE.Vector3(-4.7, 3.4, -18),
        new THREE.Vector3(4.7, -3.4, 1), new THREE.Vector3(4.7, 3.4, -18)
      ]);
      scene.add(new THREE.LineSegments(sideGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09 })));

      function resize() {
        const width = root.clientWidth;
        const height = root.querySelector('.pham-vault__sticky').clientHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      }
      resize();
      root.classList.add('is-webgl-ready');

      return { THREE: THREE, renderer: renderer, scene: scene, camera: camera, rig: rig, floor: floor, resize: resize };
    }).catch(function () {
      root.classList.add('is-webgl-fallback');
      return null;
    });
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
    let sceneState = null;
    let active = true;
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
      const delta = Math.min((time - previousTime) / 1000, 0.1);
      previousTime = time;
      smoothProgress = damp(smoothProgress, progress, 5.5, delta);
      smoothPointerX = damp(smoothPointerX, pointerX, 7, delta);
      smoothPointerY = damp(smoothPointerY, pointerY, 7, delta);

      root.style.setProperty('--vault-progress', smoothProgress.toFixed(4));
      const chapter = Math.min(3, Math.floor(smoothProgress * 4));
      setChapter(chapter);

      if (object && !reducedMotion) {
        const wave = Math.sin(smoothProgress * Math.PI * 2);
        const x = wave * 4.2 + smoothPointerX * 10;
        const y = -48 + Math.sin(smoothProgress * Math.PI) * -2 + smoothPointerY * 4;
        const scale = 1 + Math.sin(smoothProgress * Math.PI) * 0.09;
        const rotateY = wave * -3 + smoothPointerX * 2.5;
        object.style.transform = 'translate3d(calc(-50% + ' + x.toFixed(2) + 'px), ' + y.toFixed(2) + '%, 0) rotateY(' + rotateY.toFixed(2) + 'deg) scale(' + scale.toFixed(4) + ')';
      }

      if (sceneState && active) {
        sceneState.camera.position.x = smoothPointerX * 0.36 + Math.sin(smoothProgress * Math.PI * 2) * 0.18;
        sceneState.camera.position.y = 0.15 - smoothPointerY * 0.24 + smoothProgress * 0.4;
        sceneState.camera.position.z = 8.2 - smoothProgress * 2.2;
        sceneState.camera.lookAt(0, 0, -2.5 - smoothProgress * 2.5);
        sceneState.rig.rotation.z = smoothPointerX * 0.008;
        sceneState.rig.position.z = smoothProgress * 2.4;
        sceneState.floor.position.z = -7 + smoothProgress * 4;
        sceneState.renderer.render(sceneState.scene, sceneState.camera);
      }
      frame = requestAnimationFrame(render);
    }

    measureProgress();
    setChapter(0);
    createVaultScene(root, canvas).then(function (created) { sceneState = created; });

    window.addEventListener('scroll', measureProgress, { passive: true });
    window.addEventListener('resize', function () {
      measureProgress();
      if (sceneState) sceneState.resize();
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
        window.scrollTo({ top: sectionTop + distance * (index / 3), behavior: reducedMotion ? 'auto' : 'smooth' });
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
    }, { rootMargin: '20% 0px' });
    observer.observe(root);
    frame = requestAnimationFrame(render);
  }

  function mountAll(scope) {
    (scope || document).querySelectorAll('[data-pham-vault]').forEach(mountVault);
    (scope || document).querySelectorAll('[data-pham-archive]').forEach(mountArchive);
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
    let previousTime = performance.now();

    function fromScroll() {
      if (dragging) return;
      const rect = root.getBoundingClientRect();
      target = clamp(-rect.top / Math.max(root.offsetHeight - window.innerHeight, 1), 0, 1);
    }

    function draw(time) {
      const delta = Math.min((time - previousTime) / 1000, 0.1);
      previousTime = time;
      current = damp(current, target, 6, delta);
      const distance = Math.max(track.scrollWidth - window.innerWidth, 0);
      track.style.transform = 'translate3d(' + (-distance * current).toFixed(2) + 'px,0,0)';
      root.style.setProperty('--archive-progress', current.toFixed(4));
      requestAnimationFrame(draw);
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
    fromScroll();
    requestAnimationFrame(draw);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mountAll(); }, { once: true });
  else mountAll();
  document.addEventListener('shopify:section:load', function (event) { mountAll(event.target); });
})();
