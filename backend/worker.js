const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, service: 'pham-campaign' });
      }

      if (request.method === 'GET' && url.pathname === '/api/campaign') {
        return getCampaign(env, url.searchParams.get('edition') || 'edition-01');
      }

      if (request.method === 'POST' && url.pathname === '/webhooks/orders-paid') {
        return handleOrdersPaid(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/internal/final-payment/open') {
        requireInternalKey(request, env);
        return openFinalPayment(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/internal/standby/promote') {
        requireInternalKey(request, env);
        const body = await request.json();
        const result = await promoteNextStandby(env, body.editionId || 'edition-01');
        return json(result);
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: error.message || 'Internal error' }, error.status || 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(expireReservationsAndPromote(env));
  }
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function requireInternalKey(request, env) {
  const expected = env.INTERNAL_ADMIN_KEY;
  const actual = request.headers.get('authorization') || '';
  if (!expected || actual !== `Bearer ${expected}`) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }
}

async function getCampaign(env, editionId) {
  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();

  if (!edition) return json({ error: 'Edition not found' }, 404);

  const reserved = await scalar(env,
    "SELECT COUNT(*) AS count FROM reservations WHERE edition_id = ? AND status NOT IN ('cancelled','expired')",
    editionId
  );
  const identityClaimed = await scalar(env,
    "SELECT COUNT(*) AS count FROM identity_claims WHERE edition_id = ? AND status NOT IN ('revoked')",
    editionId
  );
  const standby = await scalar(env,
    "SELECT COUNT(*) AS count FROM standby WHERE edition_id = ? AND status = 'waiting'",
    editionId
  );

  return json({
    edition: {
      id: edition.id,
      label: edition.label,
      productCode: edition.product_code,
      editionSize: edition.edition_size,
      state: edition.state,
      reservationPriceCents: edition.reservation_price_cents,
      finalPriceCents: edition.final_price_cents,
      balanceDueCents: edition.final_price_cents - edition.reservation_price_cents,
      identityLimit: edition.identity_limit,
      paymentWindowHours: edition.payment_window_hours,
      standbyWindowHours: edition.standby_window_hours
    },
    counters: {
      reserved,
      identityClaimed,
      standby
    }
  });
}

async function handleOrdersPaid(request, env) {
  const raw = await request.arrayBuffer();
  const verified = await verifyShopifyWebhook(raw, request.headers.get('x-shopify-hmac-sha256'), env.SHOPIFY_WEBHOOK_SECRET);
  if (!verified) return json({ error: 'Invalid webhook signature' }, 401);

  const webhookId = request.headers.get('x-shopify-webhook-id') || '';
  const topic = request.headers.get('x-shopify-topic') || 'orders/paid';

  if (webhookId) {
    const seen = await env.PHAM_CAMPAIGN_DB.prepare(
      'SELECT id FROM webhook_events WHERE id = ?'
    ).bind(webhookId).first();
    if (seen) return json({ ok: true, duplicate: true });
  }

  const order = JSON.parse(new TextDecoder().decode(raw));
  const reservationLine = findLineBySku(order, 'PHAM-001-RES-E01');
  const finalLine = findLineBySku(order, 'PHAM-001-E01');

  if (!reservationLine && finalLine) {
    const finalResult = await handleFinalAcquisitionPaid(env, order);
    if (webhookId) await recordWebhook(env, webhookId, topic);
    return json(finalResult);
  }

  if (!reservationLine) {
    if (webhookId) await recordWebhook(env, webhookId, topic);
    return json({ ok: true, ignored: true });
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind('edition-01').first();
  if (!edition) throw new Error('Edition configuration missing');

  const shopifyOrderId = toGid('Order', order.id);
  const shopifyCustomerId = order.customer && order.customer.id ? toGid('Customer', order.customer.id) : null;
  const email = (order.email || (order.customer && order.customer.email) || '').toLowerCase();
  const existing = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM reservations WHERE shopify_order_id = ?'
  ).bind(shopifyOrderId).first();

  if (existing) {
    if (webhookId) await recordWebhook(env, webhookId, topic);
    return json({ ok: true, reservationId: existing.id, duplicateOrder: true });
  }

  const activeReservations = await scalar(env,
    "SELECT COUNT(*) AS count FROM reservations WHERE edition_id = ? AND status NOT IN ('cancelled','expired')",
    edition.id
  );

  if (activeReservations >= edition.edition_size) {
    await env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE editions SET state = 'reservation_full', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(edition.id).run();
    throw new Error('Reservation capacity exceeded; manual review required');
  }

  const reservationId = await uniqueReservationId(env);
  const referralCode = await uniqueReferralCode(env);
  const referredByCode = safeCode(propertyValue(reservationLine, '_PHAM Referral Code'));
  const reservationPaidCents = moneyToCents(reservationLine.price || order.current_subtotal_price || '24.99');
  const balanceDueCents = Math.max(0, edition.final_price_cents - edition.reservation_price_cents);

  await env.PHAM_CAMPAIGN_DB.prepare(
    `INSERT INTO reservations (
      id, edition_id, shopify_order_id, shopify_customer_id, email, status,
      reservation_paid_cents, balance_due_cents, referral_code, referred_by_code,
      digital_lookbook_status
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'entitled')`
  ).bind(
    reservationId,
    edition.id,
    shopifyOrderId,
    shopifyCustomerId,
    email,
    reservationPaidCents,
    balanceDueCents,
    referralCode,
    referredByCode || null
  ).run();

  const identityLine = findLineBySku(order, 'PHAM-ID-E01');
  let identityResult = { claimed: false };

  if (identityLine) {
    identityResult = await claimIdentity(env, {
      editionId: edition.id,
      reservationId,
      source: 'paid'
    });
  }

  let referralResult = { verified: false };
  if (referredByCode) {
    referralResult = await verifyReferral(env, {
      edition,
      referredReservationId: reservationId,
      referredCustomerId: shopifyCustomerId,
      referredEmail: email,
      referrerCode: referredByCode
    });
  }

  await syncReservationMetafields(env, {
    orderId: shopifyOrderId,
    customerId: shopifyCustomerId,
    edition,
    reservationId,
    referralCode,
    referredByCode,
    identityClaimed: identityResult.claimed,
    identitySource: identityResult.claimed ? 'paid' : '',
    lookbookStatus: 'entitled',
    balanceDueCents
  });

  const afterCount = activeReservations + 1;
  if (afterCount >= edition.edition_size) {
    await env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE editions SET state = 'reservation_full', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(edition.id).run();
  }

  if (webhookId) await recordWebhook(env, webhookId, topic);

  return json({
    ok: true,
    reservationId,
    referralCode,
    identity: identityResult,
    referral: referralResult,
    reservationsClaimed: afterCount
  });
}

async function handleFinalAcquisitionPaid(env, order) {
  const reservationId = orderAttribute(order, 'PHAM Reservation ID');
  if (!reservationId) {
    return { ok: true, ignored: true, reason: 'final_order_without_reservation_id' };
  }

  const reservation = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM reservations WHERE id = ?'
  ).bind(reservationId).first();

  if (!reservation) {
    return { ok: false, reason: 'unknown_reservation_id', reservationId };
  }

  const finalOrderId = toGid('Order', order.id);

  await env.PHAM_CAMPAIGN_DB.prepare(
    `UPDATE reservations
     SET status = 'final_paid',
         final_payment_status = 'paid',
         payment_deadline = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(reservationId).run();

  const fields = [
    metafield(reservation.shopify_order_id, 'final_payment_status', 'single_line_text_field', 'paid')
  ];

  if (reservation.shopify_customer_id) {
    fields.push(
      metafield(reservation.shopify_customer_id, 'current_reservation_status', 'single_line_text_field', 'final_paid')
    );
  }

  await setMetafields(env, fields);

  return {
    ok: true,
    type: 'final_acquisition_paid',
    reservationId,
    finalOrderId
  };
}

async function claimIdentity(env, { editionId, reservationId, source }) {
  const existing = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT reservation_id, source, status FROM identity_claims WHERE reservation_id = ?'
  ).bind(reservationId).first();
  if (existing) return { claimed: true, existing: true, source: existing.source };

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT identity_limit FROM editions WHERE id = ?'
  ).bind(editionId).first();
  if (!edition) throw new Error('Edition not found');

  // D1 serializes individual writes. The conditional INSERT is the final guard;
  // referral and paid claims share this same table/pool.
  const result = await env.PHAM_CAMPAIGN_DB.prepare(
    `INSERT INTO identity_claims (reservation_id, edition_id, source, status)
     SELECT ?, ?, ?, 'claimed'
     WHERE (SELECT COUNT(*) FROM identity_claims WHERE edition_id = ? AND status != 'revoked') < ?`
  ).bind(reservationId, editionId, source, editionId, edition.identity_limit).run();

  return {
    claimed: (result.meta && result.meta.changes || 0) > 0,
    source
  };
}

async function verifyReferral(env, context) {
  const referrer = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM reservations WHERE edition_id = ? AND referral_code = ?'
  ).bind(context.edition.id, context.referrerCode).first();

  if (!referrer) return { verified: false, reason: 'unknown_referrer' };
  if (referrer.id === context.referredReservationId) return { verified: false, reason: 'self_referral' };
  if (referrer.shopify_customer_id && context.referredCustomerId && referrer.shopify_customer_id === context.referredCustomerId) {
    return { verified: false, reason: 'same_customer' };
  }
  if (referrer.email && context.referredEmail && referrer.email.toLowerCase() === context.referredEmail.toLowerCase()) {
    return { verified: false, reason: 'same_email' };
  }

  const duplicate = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT id FROM referrals WHERE referred_reservation_id = ?'
  ).bind(context.referredReservationId).first();
  if (duplicate) return { verified: false, reason: 'already_attributed' };

  const referralId = crypto.randomUUID();
  await env.PHAM_CAMPAIGN_DB.prepare(
    `INSERT INTO referrals (
      id, edition_id, referrer_reservation_id, referred_reservation_id, status
    ) VALUES (?, ?, ?, ?, 'verified')`
  ).bind(referralId, context.edition.id, referrer.id, context.referredReservationId).run();

  const identity = await claimIdentity(env, {
    editionId: context.edition.id,
    reservationId: referrer.id,
    source: 'referral'
  });

  if (referrer.shopify_customer_id) {
    const successful = await scalar(env,
      "SELECT COUNT(*) AS count FROM referrals WHERE referrer_reservation_id = ? AND status = 'verified'",
      referrer.id
    );

    await setMetafields(env, [
      metafield(referrer.shopify_customer_id, 'successful_referrals', 'number_integer', String(successful)),
      metafield(referrer.shopify_customer_id, 'identity_status', 'single_line_text_field', identity.claimed ? 'claimed' : 'pool_closed'),
      metafield(referrer.shopify_customer_id, 'identity_source', 'single_line_text_field', identity.claimed ? 'referral' : '')
    ]);
  }

  return { verified: true, referrerReservationId: referrer.id, identity };
}

async function syncReservationMetafields(env, data) {
  const orderFields = [
    metafield(data.orderId, 'edition_label', 'single_line_text_field', data.edition.label),
    metafield(data.orderId, 'reservation_id', 'single_line_text_field', data.reservationId),
    metafield(data.orderId, 'referral_code', 'single_line_text_field', data.referredByCode || ''),
    metafield(data.orderId, 'identity_selected', 'boolean', data.identityClaimed ? 'true' : 'false'),
    metafield(data.orderId, 'identity_source', 'single_line_text_field', data.identitySource || ''),
    metafield(data.orderId, 'digital_lookbook_status', 'single_line_text_field', data.lookbookStatus),
    metafield(data.orderId, 'final_payment_status', 'single_line_text_field', 'pending')
  ];

  await setMetafields(env, orderFields);

  if (data.customerId) {
    await setMetafields(env, [
      metafield(data.customerId, 'referral_code', 'single_line_text_field', data.referralCode),
      metafield(data.customerId, 'successful_referrals', 'number_integer', '0'),
      metafield(data.customerId, 'current_reservation_status', 'single_line_text_field', 'active'),
      metafield(data.customerId, 'identity_status', 'single_line_text_field', data.identityClaimed ? 'claimed' : 'locked'),
      metafield(data.customerId, 'identity_source', 'single_line_text_field', data.identitySource || ''),
      metafield(data.customerId, 'reservation_id', 'single_line_text_field', data.reservationId),
      metafield(data.customerId, 'digital_lookbook_status', 'single_line_text_field', data.lookbookStatus)
    ]);
  }
}

async function openFinalPayment(request, env) {
  const body = await request.json();
  const editionId = body.editionId || 'edition-01';
  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();

  if (!edition) return json({ error: 'Edition not found' }, 404);
  if (!edition.final_product_variant_id) {
    return json({ error: 'Final product variant is not configured for this edition' }, 409);
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + edition.payment_window_hours * 3600000).toISOString();

  const rows = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, email, shopify_customer_id, shopify_order_id, final_draft_order_id, final_invoice_url
     FROM reservations
     WHERE edition_id = ? AND status = 'active'`
  ).bind(editionId).all();

  const results = [];

  for (const row of rows.results || []) {
    try {
      let draftOrderId = row.final_draft_order_id;
      let invoiceUrl = row.final_invoice_url;

      if (!draftOrderId) {
        const draft = await createFinalAcquisitionDraft(env, {
          edition,
          reservation: row,
          deadline
        });
        draftOrderId = draft.id;
        invoiceUrl = draft.invoiceUrl;

        await env.PHAM_CAMPAIGN_DB.prepare(
          `UPDATE reservations
           SET final_draft_order_id = ?, final_invoice_url = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(draftOrderId, invoiceUrl || null, row.id).run();
      }

      await sendFinalAcquisitionInvoice(env, {
        draftOrderId,
        email: row.email,
        edition,
        reservationId: row.id,
        deadline
      });

      await env.PHAM_CAMPAIGN_DB.prepare(
        `UPDATE reservations
         SET status = 'final_payment_open',
             final_payment_status = 'open',
             payment_deadline = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(deadline, row.id).run();

      const fields = [
        metafield(row.shopify_order_id, 'final_payment_status', 'single_line_text_field', 'open'),
        metafield(row.shopify_order_id, 'payment_deadline', 'date_time', deadline)
      ];

      if (row.shopify_customer_id) {
        fields.push(
          metafield(row.shopify_customer_id, 'current_reservation_status', 'single_line_text_field', 'final_payment_open'),
          metafield(row.shopify_customer_id, 'payment_deadline', 'date_time', deadline)
        );
      }

      await setMetafields(env, fields);

      results.push({
        reservationId: row.id,
        ok: true,
        draftOrderId,
        invoiceUrl,
        deadline
      });
    } catch (error) {
      console.error('Final payment opening failed', row.id, error);
      results.push({
        reservationId: row.id,
        ok: false,
        error: error.message || 'Unknown final payment error'
      });
    }
  }

  const opened = results.filter(item => item.ok).length;
  const failed = results.length - opened;

  if (opened > 0) {
    await env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE editions SET state = 'final_payment', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(editionId).run();
  }

  return json({ ok: failed === 0, editionId, opened, failed, deadline, results });
}

async function createFinalAcquisitionDraft(env, { edition, reservation, deadline }) {
  const mutation = `mutation CreateFinalAcquisitionDraft($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }`;

  const currencyCode = edition.currency_code || 'USD';
  const reservationCredit = centsToMoney(edition.reservation_price_cents);

  const input = {
    email: reservation.email || undefined,
    lineItems: [{
      variantId: edition.final_product_variant_id,
      quantity: 1
    }],
    appliedDiscount: {
      title: 'Priority Reservation Credit',
      description: `${edition.label} reservation already paid`,
      valueType: 'FIXED_AMOUNT',
      value: reservationCredit
    },
    acceptAutomaticDiscounts: false,
    allowDiscountCodesInCheckout: false,
    customAttributes: [
      { key: 'PHAM Reservation ID', value: reservation.id },
      { key: 'PHAM Edition', value: edition.label },
      { key: 'PHAM Product', value: edition.product_code },
      { key: 'PHAM Payment Deadline', value: deadline }
    ],
    note: `${edition.label} final acquisition. Reservation credit applied: ${reservationCredit} ${currencyCode}.`,
    tags: ['PHAM', edition.label, 'Final Acquisition', reservation.id]
  };

  const result = await shopifyGraphQL(env, mutation, { input });
  const payload = result && result.data && result.data.draftOrderCreate;
  const errors = payload && payload.userErrors || [];

  if (errors.length) {
    throw new Error('Draft order creation failed: ' + JSON.stringify(errors));
  }
  if (!payload || !payload.draftOrder) {
    throw new Error('Draft order creation returned no draft order');
  }

  return payload.draftOrder;
}

async function sendFinalAcquisitionInvoice(env, { draftOrderId, email, edition, reservationId, deadline }) {
  const mutation = `mutation SendFinalAcquisitionInvoice($id: ID!, $email: EmailInput) {
    draftOrderInvoiceSend(id: $id, email: $email) {
      draftOrder { id name invoiceUrl email status }
      userErrors { field message }
    }
  }`;

  const subject = `${edition.product_code} · Your acquisition window is open`;
  const customMessage = [
    `Your ${edition.label} allocation is ready to be completed.`,
    '',
    `Reservation: ${reservationId}`,
    `Reservation credit: ${centsToMoney(edition.reservation_price_cents)} ${edition.currency_code || 'USD'}`,
    `Remaining object balance: ${centsToMoney(edition.final_price_cents - edition.reservation_price_cents)} ${edition.currency_code || 'USD'}`,
    `Payment deadline: ${deadline}`,
    '',
    'If payment is not completed within the active window, PHAM may release the allocation according to the published edition terms and applicable law.'
  ].join('\n');

  const emailInput = {
    subject,
    customMessage
  };

  if (email) emailInput.to = email;

  const result = await shopifyGraphQL(env, mutation, {
    id: draftOrderId,
    email: emailInput
  });

  const payload = result && result.data && result.data.draftOrderInvoiceSend;
  const errors = payload && payload.userErrors || [];

  if (errors.length) {
    throw new Error('Draft order invoice send failed: ' + JSON.stringify(errors));
  }

  return payload && payload.draftOrder;
}

function centsToMoney(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

async function expireReservationsAndPromote(env) {
  const expired = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, edition_id, shopify_customer_id, shopify_order_id
     FROM reservations
     WHERE status = 'final_payment_open'
       AND payment_deadline IS NOT NULL
       AND payment_deadline <= ?`
  ).bind(new Date().toISOString()).all();

  const touchedEditions = new Set();

  for (const row of expired.results || []) {
    await env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE reservations SET status = 'expired', final_payment_status = 'expired', object_number = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(row.id).run();

    const fields = [
      metafield(row.shopify_order_id, 'final_payment_status', 'single_line_text_field', 'expired')
    ];
    if (row.shopify_customer_id) {
      fields.push(
        metafield(row.shopify_customer_id, 'current_reservation_status', 'single_line_text_field', 'expired')
      );
    }
    await setMetafields(env, fields);
    touchedEditions.add(row.edition_id);
  }

  for (const editionId of touchedEditions) {
    await promoteNextStandby(env, editionId);
  }
}

async function promoteNextStandby(env, editionId) {
  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();
  if (!edition) return { ok: false, reason: 'edition_not_found' };

  const next = await env.PHAM_CAMPAIGN_DB.prepare(
    "SELECT * FROM standby WHERE edition_id = ? AND status = 'waiting' ORDER BY position ASC LIMIT 1"
  ).bind(editionId).first();

  if (!next) return { ok: true, promoted: false, reason: 'queue_empty' };

  const promotedAt = new Date();
  const deadline = new Date(promotedAt.getTime() + edition.standby_window_hours * 3600000).toISOString();

  await env.PHAM_CAMPAIGN_DB.prepare(
    "UPDATE standby SET status = 'promoted', promoted_at = ?, offer_deadline = ? WHERE id = ? AND status = 'waiting'"
  ).bind(promotedAt.toISOString(), deadline, next.id).run();

  return {
    ok: true,
    promoted: true,
    standbyId: next.id,
    email: next.email,
    offerDeadline: deadline,
    priceCents: edition.final_price_cents
  };
}

function findLineBySku(order, sku) {
  return (order.line_items || []).find(line => line.sku === sku) || null;
}

function orderAttribute(order, name) {
  const attributes = order && (order.note_attributes || order.noteAttributes) || [];
  const found = attributes.find(item => item && (item.name === name || item.key === name));
  return found ? String(found.value || '') : '';
}

function propertyValue(line, name) {
  const properties = line && line.properties || [];
  const found = properties.find(p => p && p.name === name);
  return found ? String(found.value || '') : '';
}

function safeCode(value) {
  return /^[A-Za-z0-9_-]{3,64}$/.test(value || '') ? value : '';
}

function moneyToCents(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function toGid(type, id) {
  const value = String(id || '');
  return value.startsWith('gid://') ? value : `gid://shopify/${type}/${value}`;
}

function metafield(ownerId, key, type, value) {
  return { ownerId, namespace: 'pham', key, type, value };
}

async function setMetafields(env, metafields) {
  const clean = metafields.filter(field => field.ownerId && field.value !== undefined && field.value !== null);
  if (!clean.length) return;

  const query = `mutation SetPhamMetafields($metafields:[MetafieldsSetInput!]!){
    metafieldsSet(metafields:$metafields){
      metafields{ id namespace key value }
      userErrors{ field message code }
    }
  }`;

  const result = await shopifyGraphQL(env, query, { metafields: clean });
  const errors = result && result.data && result.data.metafieldsSet && result.data.metafieldsSet.userErrors || [];
  if (errors.length) throw new Error('Shopify metafield update failed: ' + JSON.stringify(errors));
}

async function shopifyGraphQL(env, query, variables) {
  if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_TOKEN) {
    throw new Error('Shopify backend secrets are not configured');
  }

  const response = await fetch(`https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-access-token': env.SHOPIFY_ADMIN_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error('Shopify GraphQL request failed: ' + JSON.stringify(payload.errors || payload));
  }
  return payload;
}

async function scalar(env, sql, ...bindings) {
  const row = await env.PHAM_CAMPAIGN_DB.prepare(sql).bind(...bindings).first();
  return Number(row && row.count || 0);
}

async function uniqueReservationId(env) {
  for (let i = 0; i < 8; i++) {
    const id = 'PHAM-R-' + randomToken(10).toUpperCase();
    const existing = await env.PHAM_CAMPAIGN_DB.prepare('SELECT id FROM reservations WHERE id = ?').bind(id).first();
    if (!existing) return id;
  }
  throw new Error('Unable to allocate reservation ID');
}

async function uniqueReferralCode(env) {
  for (let i = 0; i < 8; i++) {
    const code = randomToken(7).toUpperCase();
    const existing = await env.PHAM_CAMPAIGN_DB.prepare('SELECT id FROM reservations WHERE referral_code = ?').bind(code).first();
    if (!existing) return code;
  }
  throw new Error('Unable to allocate referral code');
}

function randomToken(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

async function recordWebhook(env, id, topic) {
  await env.PHAM_CAMPAIGN_DB.prepare(
    'INSERT OR IGNORE INTO webhook_events (id, topic) VALUES (?, ?)'
  ).bind(id, topic).run();
}

async function verifyShopifyWebhook(rawBody, provided, secret) {
  if (!secret || !provided) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, rawBody);
  const expected = bytesToBase64(new Uint8Array(signature));
  return timingSafeEqual(expected, provided);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
