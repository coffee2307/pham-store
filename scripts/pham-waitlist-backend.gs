/**
 * @deprecated Use scripts/pham-contact-backend.gs instead.
 *
 * PHAM no longer syncs Shopify orders, customers, or webhooks via Apps Script.
 * Copy pham-contact-backend.gs into your Apps Script project and redeploy.
 */

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: false,
      error: 'deprecated_backend',
      message: 'Replace this deployment with scripts/pham-contact-backend.gs (contact form only).',
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost() {
  return doGet();
}
