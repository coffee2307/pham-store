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

  window.PhamSecurity = {
    isSafeSameOriginPath: isSafeSameOriginPath,
    isSafeSameOriginUrl: isSafeSameOriginUrl,
    secureRandomPassword: secureRandomPassword,
  };
})();
