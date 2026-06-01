(function () {
  'use strict';

  var isPolicyPath = document.body.classList.contains('pham-policy-page') || /\/policies\//.test(window.location.pathname);
  if (!isPolicyPath) return;

  document.body.classList.add('pham-policy-page');

  var body = document.querySelector('.shopify-policy__body');
  if (!body || body.dataset.phamPolicyReady === 'true') return;
  body.dataset.phamPolicyReady = 'true';

  var H2_CLASS = 'pham-policy-h2';
  var H3_CLASS = 'pham-policy-h3';
  var SECTION_HEAD_RE =
    /^(SECTION\s+\d+\s*[-–—]|OVERVIEW|PERSONAL INFORMATION|HOW WE USE|HOW WE DISCLOSE|YOUR RIGHTS|CHANGES TO|CONTACT US)/i;
  var ROMAN_SECTION_RE = /^[IVXLC]+\.\s+/i;
  var NUMBERED_SUBSECTION_RE = /^\d+\.\s+/;
  var DECIMAL_SUBSECTION_RE = /^\d+\.\d+\.?\s*$/;
  var SUBSECTION_RE = /:$/;
  var NON_HEADING_RE = /^(unless|as required|continuous|please note|note|important|we recommend|didn't receive)/i;
  var EMPHASIS_VALUE_RE =
    /^\d+[-–—]\d+\b|^\d+\s*(hours?|days?|minutes?|weeks?|months?|business days?)\b|^\$\d/i;
  var MOBILE_MQ = window.matchMedia('(max-width: 749px)');
  var blockUid = 0;

  function policyParagraphs() {
    return body.querySelectorAll('.rte > p, .shopify-policy__body > p, .rte > div > p');
  }

  function stripImportedClasses() {
    var rte = body.querySelector('.rte') || body;
    rte.querySelectorAll('[class]').forEach(function (el) {
      el.removeAttribute('class');
    });
  }

  function looksLikeEmphasisValue(text) {
    var t = text.trim();
    if (!t) return true;
    if (EMPHASIS_VALUE_RE.test(t)) return true;
    if (/^[a-z]/.test(t)) return true;
    if (/[.!?]$/.test(t) && !SUBSECTION_RE.test(t)) return true;
    if (t.split(/\s+/).length <= 4 && /days|hours|minutes|weeks|months/i.test(t)) return true;
    return false;
  }

  function isTitleCasePhrase(text) {
    var words = text.trim().split(/\s+/);
    if (words.length < 2) return false;
    var significant = words.filter(function (word) {
      return !/^(and|or|the|of|in|to|for|a|an|&)$/i.test(word);
    });
    if (!significant.length) return false;
    return significant.every(function (word) {
      return /^[A-Z0-9"“(']/.test(word);
    });
  }

  function isSectionTitle(text) {
    var t = text.trim();
    if (!t || t.length > 140) return false;
    if (NON_HEADING_RE.test(t)) return false;
    if (looksLikeEmphasisValue(t)) return false;
    if (ROMAN_SECTION_RE.test(t)) return true;
    if (SECTION_HEAD_RE.test(t)) return true;
    if (NUMBERED_SUBSECTION_RE.test(t) || DECIMAL_SUBSECTION_RE.test(t)) return false;
    if (/^(CONTACT US|SHIPPING POLICY|REFUND POLICY|PRIVACY POLICY|TERMS OF SERVICE)$/i.test(t)) {
      return true;
    }
    if (SUBSECTION_RE.test(t)) return false;
    if (/[.!?]$/.test(t) || /[,;]/.test(t)) return false;
    if (t.length > 72) return false;
    return isTitleCasePhrase(t);
  }

  function isInlineFieldLabel(text) {
    var t = text.trim();
    if (!SUBSECTION_RE.test(t)) return false;
    if (NUMBERED_SUBSECTION_RE.test(t) || DECIMAL_SUBSECTION_RE.test(t)) return false;
    return t.length <= 32;
  }

  function isSubsectionTitle(text) {
    var t = text.trim();
    if (!t || t.length > 96) return false;
    if (looksLikeEmphasisValue(t)) return false;
    if (isSectionTitle(t)) return false;
    if (isInlineFieldLabel(t)) return false;
    if (NON_HEADING_RE.test(t.replace(/:$/, ''))) return false;
    if (NUMBERED_SUBSECTION_RE.test(t)) return true;
    if (DECIMAL_SUBSECTION_RE.test(t)) return true;
    if (t.length <= 36 && /^[A-Z0-9][A-Z0-9\s\-–—/&().,'"]+$/.test(t)) return true;
    return false;
  }

  function labeledParagraph(title, level) {
    var p = document.createElement('p');
    p.className = level === 'section' ? 'pham-policy-section' : 'pham-policy-subsection';
    var strong = document.createElement('strong');
    strong.textContent = title;
    p.appendChild(strong);
    return p;
  }

  function revertPromotedHeadings() {
    var rte = body.querySelector('.rte') || body;
    Array.prototype.forEach.call(rte.querySelectorAll('h1, h2, h3'), function (heading) {
      if (heading.closest('.shopify-policy__title')) return;
      var text = heading.textContent.trim();
      var level = isSectionTitle(text) ? 'section' : 'subsection';
      heading.replaceWith(labeledParagraph(text, level));
    });
  }

  function labelHeadingParagraphs() {
    Array.prototype.forEach.call(policyParagraphs(), function (p) {
      var onlyStrong = p.querySelector(':scope > strong:only-child, :scope > b:only-child');
      if (!onlyStrong || p.children.length !== 1) return;

      var title = onlyStrong.textContent.trim();
      if (isSectionTitle(title)) {
        p.classList.add('pham-policy-section');
      } else if (isInlineFieldLabel(title)) {
        p.classList.add('pham-policy-labeled-row');
      } else if (isSubsectionTitle(title)) {
        p.classList.add('pham-policy-subsection');
      }
    });

    Array.prototype.forEach.call(policyParagraphs(), function (p) {
      if (p.classList.contains('pham-policy-section') || p.classList.contains('pham-policy-subsection')) {
        return;
      }

      var strong = p.querySelector(':scope > strong:first-child, :scope > b:first-child');
      if (!strong || p.firstElementChild !== strong) return;
      if (p.querySelector(':scope > strong:only-child, :scope > b:only-child')) return;

      var title = strong.textContent.trim();
      if (isInlineFieldLabel(title) || isSubsectionTitle(title)) {
        p.classList.add('pham-policy-labeled-row');
      } else if (DECIMAL_SUBSECTION_RE.test(title)) {
        p.classList.add('pham-policy-decimal-row');
      }
    });
  }

  function tagExistingHeadings() {
    Array.prototype.forEach.call(body.querySelectorAll('h2'), function (heading) {
      if (heading.closest('.shopify-policy__title')) return;
      heading.classList.add(H2_CLASS);
    });
    Array.prototype.forEach.call(body.querySelectorAll('h3'), function (heading) {
      heading.classList.add(H3_CLASS);
    });
  }

  function normalizePolicyBlocks() {
    body.querySelectorAll('.rte > hr, .shopify-policy__body > hr').forEach(function (hr) {
      hr.classList.add('pham-policy-divider');
    });
  }

  function cellHeading(cell, index) {
    var strong = cell.querySelector('strong, b');
    if (strong && strong.textContent.trim()) {
      return strong.textContent.trim().replace(/:$/, '');
    }
    var text = cell.textContent.trim().replace(/\s+/g, ' ');
    if (text.length <= 72) return text.replace(/:$/, '');
    return text.slice(0, 69).trim() + '…';
  }

  function makeAccordion(heading, contentHtml, shellId, index) {
    var accId = shellId + '-acc-' + index;
    var details = document.createElement('details');
    details.className = 'pham-accordion pham-accordion--sm pham-policy-table-acc-item';
    details.setAttribute('data-pham-accordion', '');

    var summary = document.createElement('summary');
    summary.className = 'pham-accordion__summary';
    summary.id = accId + '-summary';
    summary.setAttribute('aria-controls', accId + '-panel');

    var headingEl = document.createElement('span');
    headingEl.className = 'pham-accordion__heading';
    headingEl.textContent = heading;

    var icon = document.createElement('span');
    icon.className = 'pham-accordion__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
      '<span class="pham-accordion__icon-bar pham-accordion__icon-bar--h"></span>' +
      '<span class="pham-accordion__icon-bar pham-accordion__icon-bar--v"></span>';

    summary.appendChild(headingEl);
    summary.appendChild(icon);

    var bodyEl = document.createElement('div');
    bodyEl.className = 'pham-accordion__body';
    bodyEl.id = accId + '-panel';
    bodyEl.setAttribute('role', 'region');
    bodyEl.setAttribute('aria-labelledby', accId + '-summary');

    var contentWrap = document.createElement('div');
    contentWrap.className = 'pham-accordion__content';
    contentWrap.innerHTML = contentHtml;

    bodyEl.appendChild(contentWrap);
    details.appendChild(summary);
    details.appendChild(bodyEl);
    return details;
  }

  function getTableRows(table) {
    var tbodyRows = table.querySelectorAll('tbody tr');
    if (tbodyRows.length) return Array.prototype.slice.call(tbodyRows);
    return Array.prototype.slice.call(table.querySelectorAll('tr'));
  }

  function buildTableAccordion(table, shell) {
    if (shell.nextElementSibling && shell.nextElementSibling.classList.contains('pham-policy-table-accordion')) {
      return;
    }

    var rows = getTableRows(table);
    if (!rows.length) return;

    var colCount = 0;
    rows.forEach(function (row) {
      colCount = Math.max(colCount, row.cells.length);
    });
    if (colCount < 2) return;

    blockUid += 1;
    var shellId = 'pham-policy-table-' + blockUid;
    shell.id = shellId;

    var accordion = document.createElement('div');
    accordion.className = 'pham-policy-table-accordion pham-policy-mobile-accordion';
    accordion.setAttribute('role', 'region');
    accordion.setAttribute('aria-label', 'Table details');

    var thead = table.querySelector('thead');
    var theadLabels = thead
      ? Array.prototype.map.call(thead.querySelectorAll('th, td'), function (c) {
          return c.textContent.trim();
        })
      : [];

    if (rows.length === 1 && colCount >= 2) {
      Array.prototype.forEach.call(rows[0].cells, function (cell, i) {
        var title = theadLabels[i] || cellHeading(cell, i);
        accordion.appendChild(makeAccordion(title, cell.innerHTML, shellId, i));
      });
    } else if (rows.length >= 2 && rows[0].querySelectorAll('th').length === rows[0].cells.length) {
      var headerLabels = Array.prototype.map.call(rows[0].cells, function (c) {
        return c.textContent.trim();
      });
      for (var ci = 0; ci < headerLabels.length; ci++) {
        var chunks = [];
        for (var ri = 1; ri < rows.length; ri++) {
          if (rows[ri].cells[ci]) chunks.push(rows[ri].cells[ci].innerHTML);
        }
        accordion.appendChild(
          makeAccordion(headerLabels[ci], chunks.join('') || rows[0].cells[ci].innerHTML, shellId, ci)
        );
      }
    } else {
      rows.forEach(function (row, ri) {
        if (row.cells.length < 2) return;
        var title = row.cells[0].textContent.trim().slice(0, 96) || cellHeading(row.cells[0], ri);
        var content = row.cells[1].innerHTML;
        accordion.appendChild(makeAccordion(title, content, shellId, ri));
      });
    }

    if (!accordion.children.length) return;
    shell.insertAdjacentElement('afterend', accordion);
  }

  function bindTableScroll(shell, wrap) {
    function update() {
      var scrollable = wrap.scrollWidth > wrap.clientWidth + 2;
      shell.classList.toggle('is-scrollable', scrollable);
      if (!scrollable) {
        shell.classList.remove('at-start', 'at-end');
        return;
      }
      var atStart = wrap.scrollLeft <= 4;
      var atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 4;
      shell.classList.toggle('at-start', atStart);
      shell.classList.toggle('at-end', atEnd);
    }

    wrap.addEventListener('scroll', update, { passive: true });
    if (typeof MOBILE_MQ.addEventListener === 'function') {
      MOBILE_MQ.addEventListener('change', update);
    } else if (typeof MOBILE_MQ.addListener === 'function') {
      MOBILE_MQ.addListener(update);
    }
    window.addEventListener('resize', update);
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(update);
      ro.observe(wrap);
      var table = wrap.querySelector('table');
      if (table) ro.observe(table);
    }
    update();
  }

  function appendScrollChrome(shell) {
    var fade = document.createElement('div');
    fade.className = 'pham-policy-table-fade';
    fade.setAttribute('aria-hidden', 'true');

    var hint = document.createElement('p');
    hint.className = 'pham-policy-table-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = 'Vuốt ngang để xem thêm →';

    shell.appendChild(fade);
    shell.appendChild(hint);
  }

  function wrapTables() {
    Array.prototype.forEach.call(body.querySelectorAll('table'), function (table) {
      if (table.closest('.pham-policy-table-shell')) return;

      var parent = table.parentElement;
      if (!parent) return;

      if (parent.classList.contains('rte-table-wrapper')) {
        parent.classList.add('pham-policy-table-wrap');
        parent.setAttribute('data-pham-policy-table-scroll', '');
        if (!parent.parentElement || !parent.parentElement.classList.contains('pham-policy-table-shell')) {
          var shellFromRte = document.createElement('div');
          shellFromRte.className = 'pham-policy-table-shell';
          parent.parentNode.insertBefore(shellFromRte, parent);
          shellFromRte.appendChild(parent);
          appendScrollChrome(shellFromRte);
          buildTableAccordion(table, shellFromRte);
          bindTableScroll(shellFromRte, parent);
        }
        return;
      }

      var shell = document.createElement('div');
      shell.className = 'pham-policy-table-shell';

      var wrap = document.createElement('div');
      wrap.className = 'pham-policy-table-wrap';
      wrap.setAttribute('data-pham-policy-table-scroll', '');
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Scrollable table');

      parent.insertBefore(shell, table);
      shell.appendChild(wrap);
      wrap.appendChild(table);
      appendScrollChrome(shell);
      buildTableAccordion(table, shell);
      bindTableScroll(shell, wrap);
    });
  }

  function listItemTitle(li) {
    var strong = li.querySelector('strong, b');
    if (strong && strong.textContent.trim()) {
      return strong.textContent.trim().replace(/:$/, '');
    }
    return li.textContent.trim().slice(0, 80);
  }

  function listItemContent(li) {
    var clone = li.cloneNode(true);
    var strong = clone.querySelector('strong, b');
    if (strong) {
      strong.remove();
      var html = clone.innerHTML.replace(/^[\s\u2014\-–]+/, '').trim();
      return html ? '<p>' + html + '</p>' : li.innerHTML;
    }
    return '<p>' + clone.innerHTML + '</p>';
  }

  function shouldConvertListToAccordion(list) {
    if (list.closest('.pham-policy-list-shell')) return false;
    if (list.closest('table')) return false;
    var items = list.querySelectorAll(':scope > li');
    if (items.length < 2) return false;
    var withStrong = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].querySelector('strong, b')) withStrong += 1;
    }
    return withStrong >= 2;
  }

  function buildListAccordions() {
    var lists = body.querySelectorAll('.rte > ul, .rte > ol, .shopify-policy__body > ul, .shopify-policy__body > ol');
    Array.prototype.forEach.call(lists, function (list) {
      if (!shouldConvertListToAccordion(list)) return;

      blockUid += 1;
      var shellId = 'pham-policy-list-' + blockUid;
      var shell = document.createElement('div');
      shell.className = 'pham-policy-list-shell';
      shell.id = shellId;

      list.parentNode.insertBefore(shell, list);
      shell.appendChild(list);

      var accordion = document.createElement('div');
      accordion.className = 'pham-policy-table-accordion pham-policy-mobile-accordion';
      accordion.setAttribute('role', 'region');
      accordion.setAttribute('aria-label', 'Policy details');

      Array.prototype.forEach.call(list.children, function (li, i) {
        if (li.tagName !== 'LI') return;
        accordion.appendChild(makeAccordion(listItemTitle(li), listItemContent(li), shellId, i));
      });

      if (!accordion.children.length) {
        while (list.firstChild) shell.parentNode.insertBefore(list.firstChild, shell);
        shell.remove();
        return;
      }

      shell.insertAdjacentElement('afterend', accordion);
    });
  }

  function normalizeAll() {
    stripImportedClasses();
    revertPromotedHeadings();
    labelHeadingParagraphs();
    normalizePolicyBlocks();
    tagExistingHeadings();
    wrapTables();
    buildListAccordions();
  }

  normalizeAll();
})();
