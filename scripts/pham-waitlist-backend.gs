/**
 * PHAM Waitlist backend — Google Apps Script
 *
 * Deploy as web app (Execute as: Me, Who has access: Anyone).
 * Script properties (Project settings → Script properties):
 *   TURNSTILE_SECRET_KEY       — Cloudflare Turnstile secret
 *   SHOPIFY_WEBHOOK_SECRET     — Shopify webhook signing secret
 *   SHOPIFY_ADMIN_ACCESS_TOKEN — Custom app Admin API token (read/write customers)
 *   SHOPIFY_STORE              — e.g. pham-9867.myshopify.com
 *   PHAM_STOREFRONT_URL        — e.g. https://pham-9867.myshopify.com or custom domain
 *   PHAM_ACCESS_PAGE_PATH        — default /pages/pre-order-access
 *   ACCESS_LINK_SECRET           — HMAC secret for Klaviyo → generate_access_link calls
 *   MULTIPASS_SECRET             — (Shopify Plus only) for true silent login URLs
 *
 * Run setupDatabase() once to create the DigitalAccessPasses sheet.
 */

var SHEET_NAME = 'DigitalAccessPasses';
var HEADERS = ['order_id', 'full_name', 'email', 'phone', 'registered_at', 'payment_status', 'customer_id', 'access_link'];

function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function doPost(e) {
  var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
  if (!body) {
    return jsonResponse({ success: false, error: 'empty_body' });
  }

  var shopifyHmac = e && e.headers && (e.headers['X-Shopify-Hmac-Sha256'] || e.headers['x-shopify-hmac-sha256']);
  if (shopifyHmac) {
    setupDatabase();
    return handleShopifyOrderWebhook(body, shopifyHmac);
  }

  var payload;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    return jsonResponse({ success: false, error: 'invalid_json' });
  }

  // Turnstile verify only — no spreadsheet access (browser POST from storefront).
  if (payload.token) {
    return verifyTurnstileToken(payload.token);
  }

  setupDatabase();

  if (payload.action === 'generate_access_link') {
    return generateAccessLink(payload);
  }

  return jsonResponse({ success: false, error: 'unknown_request' });
}

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  if (params.token) {
    return verifyTurnstileToken(params.token);
  }

  if (params.action === 'generate_access_link' && params.email) {
    return generateAccessLink({
      email: params.email,
      return_to: params.return_to || '/checkout',
      signature: params.signature || params.sig || '',
    });
  }

  return jsonResponse({ success: false, error: 'unknown_request' });
}

function verifyTurnstileToken(token) {
  var secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET_KEY');
  if (!secret) {
    return jsonResponse({ success: false, error: 'turnstile_not_configured' });
  }

  if (!token) {
    return jsonResponse({ success: false, error: 'missing_token' });
  }

  // Official endpoint — v0 is version "zero", not v/0 (see Cloudflare Turnstile server-side validation docs).
  var response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      secret: secret,
      response: token,
    },
    muteHttpExceptions: true,
  });

  var status = response.getResponseCode();
  var data = {};
  try {
    data = JSON.parse(response.getContentText() || '{}');
  } catch (err) {
    data = {};
  }

  if (data.success === true) {
    return jsonResponse({ success: true });
  }

  return jsonResponse({
    success: false,
    error: 'turnstile_failed',
    http_status: status,
    error_codes: data['error-codes'] || [],
  });
}

function handleShopifyOrderWebhook(rawBody, hmacHeader) {
  var secret = PropertiesService.getScriptProperties().getProperty('SHOPIFY_WEBHOOK_SECRET');
  if (!secret) {
    return jsonResponse({ success: false, error: 'webhook_not_configured' });
  }

  if (!verifyShopifyHmac(rawBody, hmacHeader, secret)) {
    return jsonResponse({ success: false, error: 'invalid_hmac' });
  }

  var order = JSON.parse(rawBody);
  if (!isWaitlistOrder(order)) {
    return jsonResponse({ success: true, skipped: true });
  }

  upsertAccessPassRow(normalizeOrder(order));
  syncCustomerFromOrder(order);
  return jsonResponse({ success: true });
}

function isWaitlistOrder(order) {
  var attrs = order.note_attributes || [];
  for (var i = 0; i < attrs.length; i++) {
    if (attrs[i].name === 'Waitlist signup' && attrs[i].value === 'yes') {
      return true;
    }
  }

  var items = order.line_items || [];
  for (var j = 0; j < items.length; j++) {
    var props = items[j].properties || [];
    for (var k = 0; k < props.length; k++) {
      if (props[k].name === '_waitlist' && props[k].value === 'yes') {
        return true;
      }
    }
  }

  return false;
}

function normalizeOrder(order) {
  var fullName = '';
  if (order.customer && (order.customer.first_name || order.customer.last_name)) {
    fullName = ((order.customer.first_name || '') + ' ' + (order.customer.last_name || '')).trim();
  }
  if (!fullName && order.billing_address && order.billing_address.name) {
    fullName = order.billing_address.name;
  }
  if (!fullName && order.shipping_address && order.shipping_address.name) {
    fullName = order.shipping_address.name;
  }

  var phone = order.phone || '';
  if (!phone && order.billing_address && order.billing_address.phone) {
    phone = order.billing_address.phone;
  }
  if (!phone && order.shipping_address && order.shipping_address.phone) {
    phone = order.shipping_address.phone;
  }

  return {
    order_id: String(order.name || order.id || ''),
    full_name: fullName,
    email: String(order.email || order.contact_email || ''),
    phone: String(phone || ''),
    registered_at: String(order.created_at || new Date().toISOString()),
    payment_status: String(order.financial_status || 'unknown'),
    customer_id: order.customer && order.customer.id ? String(order.customer.id) : '',
  };
}

function upsertAccessPassRow(row) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var targetRow = -1;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === row.order_id) {
      targetRow = i + 1;
      break;
    }
  }

  var output = [
    row.order_id,
    row.full_name,
    row.email,
    row.phone,
    row.registered_at,
    row.payment_status,
    row.customer_id || '',
    row.access_link || '',
  ];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, HEADERS.length).setValues([output]);
  } else {
    sheet.appendRow(output);
  }
}

function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  var digest = Utilities.computeHmacSha256Signature(rawBody, secret);
  var computed = Utilities.base64Encode(digest);
  return computed === hmacHeader;
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getScriptProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function shopifyAdminGraphql(query, variables) {
  var token = getScriptProp('SHOPIFY_ADMIN_ACCESS_TOKEN');
  var shop = getScriptProp('SHOPIFY_STORE');
  if (!token || !shop) {
    throw new Error('shopify_admin_not_configured');
  }

  var response = UrlFetchApp.fetch('https://' + shop + '/admin/api/2024-10/graphql.json', {
    method: 'post',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({ query: query, variables: variables || {} }),
    muteHttpExceptions: true,
  });

  var body = JSON.parse(response.getContentText() || '{}');
  if (body.errors && body.errors.length) {
    throw new Error(body.errors[0].message || 'shopify_graphql_error');
  }
  return body.data || {};
}

function syncCustomerFromOrder(order) {
  try {
    var email = String(order.email || order.contact_email || '').trim().toLowerCase();
    if (!email) return;

    var customerGid = '';
    if (order.customer && order.customer.id) {
      customerGid = 'gid://shopify/Customer/' + String(order.customer.id);
      tagCustomerAsPassHolder(customerGid);
      patchSheetRowByOrderId({
        order_id: String(order.name || order.id || ''),
        customer_id: String(order.customer.id),
      });
      return;
    }

    var customer = ensureAccessPassCustomer(order, email);
    if (!customer || !customer.id) return;

    patchSheetRowByOrderId({
      order_id: String(order.name || order.id || ''),
      customer_id: String(customer.legacyResourceId || customer.id || ''),
    });
  } catch (err) {
    Logger.log('syncCustomerFromOrder failed: ' + err);
  }
}

function ensureAccessPassCustomer(order, email) {
  var existing = findCustomerByEmail(email);
  if (existing) {
    tagCustomerAsPassHolder(existing.id);
    return existing;
  }

  var firstName = '';
  var lastName = '';
  if (order.customer) {
    firstName = order.customer.first_name || '';
    lastName = order.customer.last_name || '';
  }
  if (!firstName && !lastName && order.billing_address && order.billing_address.name) {
    var parts = String(order.billing_address.name).trim().split(/\s+/);
    firstName = parts.shift() || '';
    lastName = parts.join(' ');
  }

  var phone = order.phone || '';
  if (!phone && order.billing_address) phone = order.billing_address.phone || '';

  var mutation = [
    'mutation customerCreate($input: CustomerInput!) {',
    '  customerCreate(input: $input) {',
    '    customer { id legacyResourceId email state tags }',
    '    userErrors { field message }',
    '  }',
    '}',
  ].join('\n');

  var data = shopifyAdminGraphql(mutation, {
    input: {
      email: email,
      firstName: firstName,
      lastName: lastName,
      phone: phone,
      tags: ['access-pass', 'waitlist'],
      emailMarketingConsent: {
        marketingState: 'NOT_SUBSCRIBED',
      },
    },
  });

  var created = data.customerCreate && data.customerCreate.customer;
  if (created) return created;

  var errors = (data.customerCreate && data.customerCreate.userErrors) || [];
  if (errors.length && /already/i.test(errors[0].message || '')) {
    return findCustomerByEmail(email);
  }

  throw new Error((errors[0] && errors[0].message) || 'customer_create_failed');
}

function findCustomerByEmail(email) {
  var query = [
    'query customersByEmail($query: String!) {',
    '  customers(first: 1, query: $query) {',
    '    nodes { id legacyResourceId email state tags }',
    '  }',
    '}',
  ].join('\n');

  var data = shopifyAdminGraphql(query, { query: 'email:' + email });
  var nodes = data.customers && data.customers.nodes;
  return nodes && nodes.length ? nodes[0] : null;
}

function tagCustomerAsPassHolder(customerGid) {
  var mutation = [
    'mutation tagsAdd($id: ID!, $tags: [String!]!) {',
    '  tagsAdd(id: $id, tags: $tags) {',
    '    node { id }',
    '    userErrors { field message }',
    '  }',
    '}',
  ].join('\n');

  shopifyAdminGraphql(mutation, {
    id: customerGid,
    tags: ['access-pass'],
  });
}

function generateAccessLink(payload) {
  try {
    if (!verifyAccessLinkSignature(payload)) {
      return jsonResponse({ success: false, error: 'invalid_signature' });
    }

    var email = String(payload.email || '').trim().toLowerCase();
    if (!email) {
      return jsonResponse({ success: false, error: 'missing_email' });
    }

    var customer = findCustomerByEmail(email);
    if (!customer || !customer.id) {
      return jsonResponse({ success: false, error: 'customer_not_found' });
    }

    var storefront = getScriptProp('PHAM_STOREFRONT_URL').replace(/\/$/, '');
    var accessPage = getScriptProp('PHAM_ACCESS_PAGE_PATH') || '/pages/pre-order-access';
    var returnTo = String(payload.return_to || '/checkout').trim() || '/checkout';
    if (returnTo.charAt(0) !== '/') returnTo = '/' + returnTo;

    var accessUrl;
    var activationUrl = '';

    if (customer.state === 'ENABLED') {
      accessUrl = storefront + '/account/login?return_url=' + encodeURIComponent(returnTo);
    } else {
      activationUrl = createAccountActivationUrl(customer.id);
      accessUrl = storefront + accessPage
        + '?return_to=' + encodeURIComponent(returnTo)
        + '&activation_url=' + encodeURIComponent(activationUrl);
    }

    patchSheetRowByEmail(email, {
      access_link: accessUrl,
      customer_id: String(customer.legacyResourceId || ''),
    });

    return jsonResponse({
      success: true,
      email: email,
      access_url: accessUrl,
      activation_url: activationUrl,
      customer_state: customer.state,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function createAccountActivationUrl(customerGid) {
  var mutation = [
    'mutation customerGenerateAccountActivationUrl($customerId: ID!) {',
    '  customerGenerateAccountActivationUrl(customerId: $customerId) {',
    '    accountActivationUrl',
    '    userErrors { field message }',
    '  }',
    '}',
  ].join('\n');

  var data = shopifyAdminGraphql(mutation, { customerId: customerGid });
  var payload = data.customerGenerateAccountActivationUrl || {};
  var errors = payload.userErrors || [];
  if (errors.length) {
    throw new Error(errors[0].message || 'activation_url_failed');
  }
  if (!payload.accountActivationUrl) {
    throw new Error('activation_url_missing');
  }
  return payload.accountActivationUrl;
}

function verifyAccessLinkSignature(payload) {
  var secret = getScriptProp('ACCESS_LINK_SECRET');
  if (!secret) return true;

  var email = String(payload.email || '').trim().toLowerCase();
  var signature = String(payload.signature || payload.sig || '');
  if (!signature) return false;

  var digest = Utilities.computeHmacSha256Signature(email, secret);
  var expected = Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '');
  return signature === expected;
}

function patchSheetRowByOrderId(patch) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;

  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== String(patch.order_id)) continue;
    if (patch.customer_id) sheet.getRange(i + 1, 7).setValue(patch.customer_id);
    if (patch.access_link) sheet.getRange(i + 1, 8).setValue(patch.access_link);
    return;
  }
}

function patchSheetRowByEmail(email, patch) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return;

  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][2]).toLowerCase() !== String(email).toLowerCase()) continue;
    if (patch.customer_id) sheet.getRange(i + 1, 7).setValue(patch.customer_id);
    if (patch.access_link) sheet.getRange(i + 1, 8).setValue(patch.access_link);
    return;
  }
}
