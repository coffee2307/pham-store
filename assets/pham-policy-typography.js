/* PHAM — semantic heading normalization for Shopify Admin policy HTML.
   Presentation only: no legal text, links, lists, or paragraphs are removed. */
(function () {
  "use strict";
  if (!document.body || !document.body.classList.contains('pham-policy-page')) return;
  const container = document.querySelector('.shopify-policy__body .rte');
  if (!container) return;

  Array.from(container.querySelectorAll('p')).forEach(function (p) {
    const section = p.classList.contains('pham-policy-section');
    const subsection = p.classList.contains('pham-policy-subsection');
    const children = Array.from(p.children);
    // Only the known Shipping subsection is missing semantic markup.
    // Do not reclassify ordinary bold labels in Returns or Terms.
    const singleStrong =
      location.pathname.endsWith('/policies/shipping-policy') &&
      p.textContent.trim() === 'Duties, Taxes and Import Charges' &&
      children.length === 1 &&
      (children[0].tagName === 'STRONG' || children[0].tagName === 'B');
    if (!section && !subsection && !singleStrong) return;

    const tag = section ? 'h2' : 'h3';
    const heading = document.createElement(tag);
    heading.className = 'pham-policy-' + tag;
    // Preserve span markup, but remove bold wrappers that otherwise
    // override the shared heading-weight design token.
    if (singleStrong && !section && !subsection) {
      heading.innerHTML = children[0].innerHTML;
    } else if (children.length === 1 &&
      (children[0].tagName === 'STRONG' || children[0].tagName === 'B')) {
      heading.innerHTML = children[0].innerHTML;
    } else {
      heading.innerHTML = p.innerHTML;
    }
    p.replaceWith(heading);
  });
})();
