(function () {
  'use strict';

  if (!document.body.classList.contains('pham-policy-page')) return;

  var body = document.querySelector('.shopify-policy__body');
  if (!body || body.dataset.phamPolicyReady === 'true') return;
  body.dataset.phamPolicyReady = 'true';

  var H2_CLASS = 'pham-policy-h2';
  var SECTION_HEAD_RE = /^(SECTION\s+\d+\s*[-–—]|OVERVIEW)/i;

  function createH2(text) {
    var h2 = document.createElement('h2');
    h2.className = H2_CLASS;
    h2.textContent = text.trim();
    return h2;
  }

  function createParagraph(nodes) {
    var p = document.createElement('p');
    var hasContent = false;

    nodes.forEach(function (node) {
      if (node.nodeType === 3 && !node.textContent.trim()) return;
      p.appendChild(node);
      hasContent = true;
    });

    return hasContent && p.textContent.trim() ? p : null;
  }

  function skipBreakNodes(nodes, index) {
    while (index < nodes.length) {
      var node = nodes[index];
      if (node.nodeType === 1 && node.tagName === 'BR') {
        index += 1;
        continue;
      }
      if (node.nodeType === 3 && !node.textContent.trim()) {
        index += 1;
        continue;
      }
      break;
    }
    return index;
  }

  function splitParagraphByStrongSections(p) {
    var nodes = Array.prototype.slice.call(p.childNodes);
    var sectionIndexes = [];

    nodes.forEach(function (node, index) {
      if (node.nodeType !== 1) return;
      if (node.tagName !== 'STRONG' && node.tagName !== 'B') return;
      if (SECTION_HEAD_RE.test(node.textContent.trim())) {
        sectionIndexes.push(index);
      }
    });

    if (sectionIndexes.length === 0) return false;

    var fragment = document.createDocumentFragment();
    var cursor = 0;

    sectionIndexes.forEach(function (sectionIndex) {
      var before = nodes.slice(cursor, sectionIndex);
      var lead = createParagraph(before);
      if (lead) fragment.appendChild(lead);

      var title = nodes[sectionIndex].textContent.trim();
      fragment.appendChild(createH2(title));

      cursor = skipBreakNodes(nodes, sectionIndex + 1);
    });

    var tail = createParagraph(nodes.slice(cursor));
    if (tail) fragment.appendChild(tail);

    p.replaceWith(fragment);
    return true;
  }

  function promoteStrongLeadParagraph(p) {
    var strong = p.querySelector(':scope > strong:first-child, :scope > b:first-child');
    if (!strong || p.firstElementChild !== strong) return false;

    var title = strong.textContent.trim();
    if (!title || title.length > 140) return false;

    strong.remove();

    while (p.firstChild) {
      var node = p.firstChild;
      if (node.nodeType === 1 && node.tagName === 'BR') {
        node.remove();
        continue;
      }
      if (node.nodeType === 3 && !node.textContent.trim()) {
        node.remove();
        continue;
      }
      break;
    }

    p.parentNode.insertBefore(createH2(title), p);

    if (!p.textContent.trim() && !p.querySelector('a, img, iframe')) {
      p.remove();
    }

    return true;
  }

  function normalizeTopLevelList() {
    var topList = body.querySelector(':scope > ul, :scope > ol, .rte > ul, .rte > ol');
    if (!topList) return;

    var items = Array.prototype.slice.call(topList.children).filter(function (node) {
      return node.tagName === 'LI';
    });

    items.forEach(function (li) {
      var strong = li.querySelector(':scope > strong:first-child, :scope > b:first-child');
      if (strong && SECTION_HEAD_RE.test(strong.textContent.trim())) {
        li.before(createH2(strong.textContent));
        strong.remove();
      }
      while (li.firstChild) {
        topList.parentNode.insertBefore(li.firstChild, topList);
      }
    });

    topList.remove();
  }

  function tagExistingHeadings() {
    Array.prototype.forEach.call(body.querySelectorAll('h2, h3'), function (heading) {
      if (heading.classList.contains(H2_CLASS)) return;
      heading.classList.add(H2_CLASS);
      if (heading.tagName === 'H3') {
        var replacement = createH2(heading.textContent);
        heading.replaceWith(replacement);
      }
    });
  }

  function normalizeAll() {
    tagExistingHeadings();
    normalizeTopLevelList();

    var paragraphs = Array.prototype.slice.call(body.querySelectorAll('p'));
    paragraphs.forEach(function (p) {
      if (!body.contains(p)) return;
      if (!splitParagraphByStrongSections(p)) {
        promoteStrongLeadParagraph(p);
      }
    });

    tagExistingHeadings();
  }

  normalizeAll();
})();
