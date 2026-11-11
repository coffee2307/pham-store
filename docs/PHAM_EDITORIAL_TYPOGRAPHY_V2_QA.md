# PHAM Editorial Typography V2 — QA

- Goal: preserve natural reading units across storefront display headings.
- Shopify target: unpublished theme 168725709056, preview only; production theme not published.
- Fixes: short Vault headings stay intact; THE FIRST OBJECT stays intact; Founder title uses two semantic clauses with restrained emphasis; Lookbook no longer clips due to Syncopate wide font and letter spacing; About title flows inline; utility heading hard breaks removed.
- Tested routes: Home, Product, About, Founder Story, Edition 01, Size Guide, Contact, Standby.
- Chromium emulation: 320, 390, 428, 768, 1024, 1440, 1718 CSS pixels; 56 route/viewport checks; zero failures, zero page JS errors, zero detected horizontal overflow.
- Intrinsic glyph width checks: Home, Product and Founder Story at 320, 390, 428, 768, 1440, 1718. All 18 passed; no measured glyph overflow.
- Visual screenshots inspected: Home 390, Founder Story 390/1440, Lookbook heading 320/390. Clipping reproduced before fixes and resolved afterward.
- Scripts and local screenshot evidence: F:/pham-store/scripts/_qa_phrase_v2.cjs, _qa_phrase_intrinsic.cjs, _phrase_final_screenshots.cjs; F:/pham-store/_audit_perf/phrase-v2.
- Limitations: Chrome emulation only, not physical Android/iOS or Safari; no checkout changes; preview is unpublished.
