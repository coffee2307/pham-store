/**
 * PHAM — shared client-side security helpers (theme-only).
 */
(function () {
  'use strict';

  function isSafeSameOriginPath(target) {
    if (!target || typeof target !== 'string') return false;
    if (target.charAt(0) !== '/' || target.charAt(1) === '/') return false;
    if (/[:\\@]/.test(target)) return false;
    try {
      var url = new URL(target, window.location.origin);
      return url.origin === window.location.origin && url.pathname.charAt(0) === '/';
    } catch (e) {
      return false;
    }
  }

  function isSafeSameOriginUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      var url = new URL(rawUrl, window.location.origin);
      return url.origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function secureRandomPassword(length) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
    var size = length || 24;
    var out = '';
    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint8Array(size);
      window.crypto.getRandomValues(bytes);
      for (var i = 0; i < size; i++) {
        out += chars.charAt(bytes[i] % chars.length);
      }
      return out;
    }
    for (var j = 0; j < size; j++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function isDesignMode() {
    return document.documentElement.classList.contains('shopify-design-mode');
  }

  function initImageGuard() {
    if (window.__PHAM_IMAGE_GUARD__) return;
    window.__PHAM_IMAGE_GUARD__ = true;

    document.addEventListener('contextmenu', function (e) {
      if (isDesignMode()) return;
      var t = e.target;
      if (t instanceof HTMLImageElement) {
        e.preventDefault();
        return;
      }
      if (t instanceof Element && t.closest('picture img')) {
        e.preventDefault();
      }
    }, true);

    document.addEventListener('dragstart', function (e) {
      if (isDesignMode()) return;
      if (e.target instanceof HTMLImageElement) {
        e.preventDefault();
      }
    }, true);

    document.addEventListener('pointerdown', function (e) {
      if (isDesignMode()) return;
      if (e.target instanceof HTMLImageElement) {
        e.target.setAttribute('draggable', 'false');
      }
    }, true);

    function markImages(root) {
      if (isDesignMode()) return;
      var scope = root && root.querySelectorAll ? root : document;
      scope.querySelectorAll('img').forEach(function (img) {
        img.setAttribute('draggable', 'false');
        img.setAttribute('decoding', img.getAttribute('decoding') || 'async');
      });
    }

    markImages(document);

    document.addEventListener('shopify:section:load', function (e) {
      markImages(e.target);
    });
  }

  window.PhamSecurity = {
    isSafeSameOriginPath: isSafeSameOriginPath,
    isSafeSameOriginUrl: isSafeSameOriginUrl,
    secureRandomPassword: secureRandomPassword,
    initImageGuard: initImageGuard,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initImageGuard, { once: true });
  } else {
    initImageGuard();
  }
})();
