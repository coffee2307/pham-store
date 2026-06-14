/**
 * PHAM Contact backend — Google Apps Script (contact form only)
 *
 * Deploy as web app: Execute as Me, Who has access: Anyone.
 *
 * Script properties (Project settings → Script properties):
 *   TURNSTILE_SECRET_KEY — Cloudflare Turnstile secret key (required)
 *   PHAM_CONTACT_EMAIL   — Inbox for notifications (default: contact@phamofficial.com)
 *
 * Setup:
 *   1. Paste this file into Apps Script → Deploy → New deployment → Web app
 *   2. Set TURNSTILE_SECRET_KEY (must match the Turnstile site key in theme settings)
 *   3. Run setupContactSheet() once to create the ContactSubmissions tab
 *   4. Paste the /exec URL into Theme settings → PHAM → Contact security → Backend URL
 *
 * Test: GET .../exec?action=contact_form&token=TEST&name=Test&email=a@b.com&body=Hi
 *       Expect success:false, error:turnstile_failed
 */

var CONTACT_SHEET_NAME = 'ContactSubmissions';
var CONTACT_FALLBACK_EMAIL = 'contact@phamofficial.com';

function setupContactSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONTACT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONTACT_SHEET_NAME);
    sheet.appendRow(['timestamp', 'name', 'email', 'body']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  if (params.action === 'contact_form') {
    return handleContactFormRequest(params);
  }

  if (params.token) {
    return jsonResponse(verifyTurnstileTokenData(params.token));
  }

  return jsonResponse({
    success: false,
    error: 'unknown_request',
    hint: 'Use action=contact_form with token, name, email, body',
  });
}

function doPost(e) {
  var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
  if (!body) {
    return jsonResponse({ success: false, error: 'empty_body' });
  }

  var payload;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    return jsonResponse({ success: false, error: 'invalid_json' });
  }

  if (payload.action === 'contact_form') {
    return handleContactFormRequest(payload);
  }

  return jsonResponse({ success: false, error: 'unknown_request' });
}

function verifyTurnstileTokenData(token) {
  var secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET_KEY');
  if (!secret) {
    return { success: false, error: 'turnstile_not_configured' };
  }
  if (!token) {
    return { success: false, error: 'missing_token' };
  }

  var response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      secret: secret,
      response: token,
    },
    muteHttpExceptions: true,
  });

  var data = {};
  try {
    data = JSON.parse(response.getContentText() || '{}');
  } catch (err) {
    data = {};
  }

  if (data.success === true) {
    return { success: true };
  }

  return {
    success: false,
    error: 'turnstile_failed',
    error_codes: data['error-codes'] || [],
  };
}

function sanitizeContactField(value, maxLen) {
  var text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (maxLen && text.length > maxLen) {
    return text.slice(0, maxLen);
  }
  return text;
}

function isValidContactEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getContactFormRecipient() {
  var configured = (PropertiesService.getScriptProperties().getProperty('PHAM_CONTACT_EMAIL') || '').trim();
  if (configured) return configured;
  return CONTACT_FALLBACK_EMAIL;
}

function logContactSubmission(name, email, body) {
  setupContactSheet().appendRow([new Date(), name, email, body]);
}

function sendContactFormEmail(name, email, body) {
  var payload = {
    to: getContactFormRecipient(),
    subject: '[PHAM Contact] ' + name,
    body: 'Name: ' + name + '\nEmail: ' + email + '\n\n' + body,
    name: 'PHAM Contact Form',
  };

  if (isValidContactEmail(email)) {
    payload.replyTo = email;
  }

  MailApp.sendEmail(payload);
}

function handleContactFormRequest(params) {
  var verification = verifyTurnstileTokenData(params.token);
  if (!verification.success) {
    return jsonResponse({
      success: false,
      error: verification.error || 'turnstile_failed',
      error_codes: verification.error_codes || [],
    });
  }

  var name = sanitizeContactField(params.name, 200);
  var email = sanitizeContactField(params.email, 320);
  var messageBody = sanitizeContactField(params.body, 5000);

  if (!name || !email || !messageBody) {
    return jsonResponse({ success: false, error: 'missing_fields' });
  }

  if (!isValidContactEmail(email)) {
    return jsonResponse({ success: false, error: 'invalid_email' });
  }

  logContactSubmission(name, email, messageBody);

  try {
    sendContactFormEmail(name, email, messageBody);
    return jsonResponse({ success: true, delivery: 'email' });
  } catch (err) {
    return jsonResponse({
      success: true,
      delivery: 'logged',
      email_error: err && err.message ? String(err.message) : 'unknown',
    });
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
