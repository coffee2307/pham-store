const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (['/campaign', '/status', '/identity/configure', '/standby/join', '/provenance'].includes(url.pathname)) {
        const proxyAuth = await verifyAppProxyRequest(url, env.SHOPIFY_API_SECRET, env.SHOPIFY_SHOP_DOMAIN);
        if (!proxyAuth.ok) return json({ ok: false, error: proxyAuth.error }, proxyAuth.status);

        if (request.method === 'GET' && url.pathname === '/campaign') {
          return getCampaign(env, url.searchParams.get('edition') || 'edition-01');
        }

        if (request.method === 'GET' && url.pathname === '/status') {
          return getCollectorStatus(env, proxyAuth.customerId, url.searchParams.get('edition') || 'edition-01');
        }

        if (request.method === 'POST' && url.pathname === '/identity/configure') {
          return configureIdentity(request, env, proxyAuth.customerId, url.searchParams.get('edition') || 'edition-01');
        }

        if (request.method === 'POST' && url.pathname === '/standby/join') {
          return joinStandbyProxy(request, env, proxyAuth.customerId, url.searchParams.get('edition') || 'edition-01');
        }

        if (request.method === 'GET' && url.pathname === '/provenance') {
          return getPublicProvenance(env, url.searchParams.get('token') || '');
        }

        return json({ ok: false, error: 'method_not_allowed' }, 405);
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, service: 'pham-campaign' });
      }

      if (request.method === 'POST' && url.pathname === '/webhooks/orders-paid') {
        return handleOrdersPaid(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/internal/state') {
        requireInternalKey(request, env);
        return getCampaign(env, url.searchParams.get('edition') || 'edition-01');
      }

      if (request.method === 'POST' && url.pathname === '/internal/state/set') {
        requireInternalKey(request, env);
        return setCampaignState(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/internal/lookbook/status') {
        requireInternalKey(request, env);
        return setLookbookStatus(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/internal/readiness') {
        requireInternalKey(request, env);
        return getReadiness(env, url.searchParams.get('edition') || 'edition-01');
      }

      if (request.method === 'GET' && url.pathname === '/internal/reviews') {
        requireInternalKey(request, env);
        return getWebhookReviews(env, url);
      }

      if (request.method === 'POST' && url.pathname === '/internal/reservation/variant') {
        requireInternalKey(request, env);
        return assignReservationVariant(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/internal/reservations/map-variants') {
        requireInternalKey(request, env);
        return mapReservationVariants(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/internal/edition/size-options') {
        requireInternalKey(request, env);
        return setEditionSizeOptions(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/internal/final-payment/open') {
        requireInternalKey(request, env);
        return openFinalPayment(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/internal/objects/finalize') {
        requireInternalKey(request, env);
        return finalizeObjectNumbers(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/internal/tokens/allocate') {
        requireInternalKey(request, env);
        return allocateFounderTokens(request, env);
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

export function canonicalizeAppProxyParams(url) {
  const grouped = new Map();

  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'signature') continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }

  return Array.from(grouped.entries())
    .map(function(entry) {
      return entry[0] + '=' + entry[1].join(',');
    })
    .sort()
    .join('');
}

export async function verifyAppProxyRequest(url, secret, expectedShop) {
  if (!secret) return { ok: false, error: 'proxy_not_configured', status: 503 };

  const provided = url.searchParams.get('signature') || '';
  if (!provided) return { ok: false, error: 'invalid_signature', status: 401 };

  const timestamp = Number(url.searchParams.get('timestamp') || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!timestamp || Math.abs(now - timestamp) > 300) {
    return { ok: false, error: 'stale_request', status: 401 };
  }

  const message = canonicalizeAppProxyParams(url);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const expected = bytesToHex(new Uint8Array(signature));

  if (!timingSafeEqual(expected, provided.toLowerCase())) {
    return { ok: false, error: 'invalid_signature', status: 401 };
  }

  const shop = url.searchParams.get('shop') || '';
  if (expectedShop && shop !== expectedShop) {
    return { ok: false, error: 'invalid_shop', status: 401 };
  }

  const rawCustomerId = url.searchParams.get('logged_in_customer_id') || '';
  return {
    ok: true,
    customerId: rawCustomerId ? toGid('Customer', rawCustomerId) : null,
    shop
  };
}

async function getCollectorStatus(env, customerId, editionId) {
  if (!customerId) return json({ ok: false, error: 'customer_login_required' }, 401);

  const reservation = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT *
     FROM reservations
     WHERE edition_id = ? AND shopify_customer_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(editionId, customerId).first();

  if (!reservation) return json({ ok: false, error: 'reservation_not_found' }, 404);

  const identity = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM identity_claims WHERE reservation_id = ?'
  ).bind(reservation.id).first();

  const collectorObject = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT object_number, token_type, provenance_status FROM objects WHERE reservation_id = ?'
  ).bind(reservation.id).first();

  const verifiedCount = await scalar(
    env,
    "SELECT COUNT(*) AS count FROM referrals WHERE referrer_reservation_id = ? AND status = 'verified'",
    reservation.id
  );

  return json({
    ok: true,
    reservation: {
      id: reservation.id,
      status: reservation.status,
      objectNumber: reservation.object_number,
      sizePreference: reservation.size_preference || null,
      balanceDueCents: reservation.balance_due_cents,
      paymentDeadline: reservation.payment_deadline,
      lookbookStatus: reservation.digital_lookbook_status,
      collectorReferralCode: reservation.referral_code,
      invoiceUrl: reservation.final_invoice_url,
      founderTokenType: collectorObject && collectorObject.token_type ? collectorObject.token_type : 'pending_allocation',
      provenanceStatus: collectorObject ? collectorObject.provenance_status : 'pending'
    },
    identity: {
      status: identity ? identity.status : 'locked',
      source: identity ? identity.source : null,
      preferredNumber: identity ? identity.preferred_number : null,
      configuredAt: identity ? identity.configured_at : null
    },
    referral: {
      verifiedCount,
      requiredCount: 1
    }
  });
}

async function configureIdentity(request, env, customerId, editionId) {
  if (!customerId) return json({ ok: false, error: 'customer_login_required' }, 401);

  const reservation = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT *
     FROM reservations
     WHERE edition_id = ? AND shopify_customer_id = ?
       AND status NOT IN ('cancelled','expired')
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(editionId, customerId).first();

  if (!reservation) return json({ ok: false, error: 'reservation_not_found' }, 404);

  const claim = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM identity_claims WHERE reservation_id = ?'
  ).bind(reservation.id).first();

  if (!claim || claim.status === 'revoked') {
    return json({ ok: false, error: 'identity_not_claimed' }, 403);
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();

  const body = await request.json();
  const preferredNumber = Number(body.preferredNumber);
  const alias = String(body.alias || '').trim().slice(0, 24);
  const inscription = String(body.inscription || '').trim().slice(0, 40);
  const publicIdentity = body.publicIdentity === true ? 1 : 0;

  if (!Number.isInteger(preferredNumber) || preferredNumber < 1 || preferredNumber > edition.edition_size) {
    return json({ ok: false, error: 'object_number_out_of_range' }, 422);
  }

  const taken = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id FROM reservations
     WHERE edition_id = ? AND object_number = ? AND id != ?`
  ).bind(editionId, preferredNumber, reservation.id).first();

  if (taken) return json({ ok: false, error: 'object_number_taken' }, 409);

  try {
    await env.PHAM_CAMPAIGN_DB.batch([
      env.PHAM_CAMPAIGN_DB.prepare(
        `UPDATE reservations
         SET object_number = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(preferredNumber, reservation.id),
      env.PHAM_CAMPAIGN_DB.prepare(
        `UPDATE identity_claims
         SET preferred_number = ?,
             engraving_name = ?,
             engraving_text = ?,
             public_identity = ?,
             configured_at = CURRENT_TIMESTAMP,
             status = 'configured'
         WHERE reservation_id = ?`
      ).bind(preferredNumber, alias, inscription, publicIdentity, reservation.id)
    ]);
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error && error.message || error))) {
      return json({ ok: false, error: 'object_number_taken' }, 409);
    }
    throw error;
  }

  await setMetafields(env, [
    metafield(customerId, 'current_object_number', 'number_integer', String(preferredNumber)),
    metafield(customerId, 'identity_status', 'single_line_text_field', 'configured')
  ]);

  return json({
    ok: true,
    identity: {
      status: 'configured',
      preferredNumber,
      alias,
      inscription,
      publicIdentity: Boolean(publicIdentity)
    }
  });
}

async function joinStandbyProxy(request, env, customerId, editionId) {
  const body = await request.json();
  const payload = await joinStandbyRecord(env, {
    editionId,
    customerId,
    email: body.email,
    name: body.name,
    country: body.country,
    size: body.size
  });

  if (!payload.ok) return json({ ok: false, error: payload.error }, payload.status || 400);

  return json({
    ok: true,
    standby: {
      id: payload.standbyId,
      sequence: payload.position,
      status: payload.queueStatus
    }
  }, payload.created ? 201 : 200);
}

async function setCampaignState(request, env) {
  const body = await request.json();
  const editionId = String(body.editionId || 'edition-01');
  const nextState = String(body.state || '').trim();

  if (body.confirm !== 'SET_CAMPAIGN_STATE') {
    return json({ ok: false, error: 'explicit_confirmation_required' }, 400);
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();

  if (!edition) return json({ ok: false, error: 'edition_not_found' }, 404);

  const allowed = {
    prelaunch: ['reservation_open'],
    reservation_open: ['prelaunch'],
    sold_out: ['archived']
  };

  const permitted = allowed[edition.state] || [];
  if (!permitted.includes(nextState)) {
    return json({
      ok: false,
      error: 'invalid_state_transition',
      currentState: edition.state,
      requestedState: nextState,
      allowed: permitted
    }, 409);
  }

  if (nextState === 'reservation_open') {
    const readiness = await collectReadiness(env, editionId);
    if (!readiness.ok) {
      return json({
        ok: false,
        error: 'campaign_not_ready',
        readiness
      }, 409);
    }
  }

  await env.PHAM_CAMPAIGN_DB.prepare(
    'UPDATE editions SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(nextState, editionId).run();

  return json({
    ok: true,
    editionId,
    previousState: edition.state,
    state: nextState
  });
}

async function setLookbookStatus(request, env) {
  const body = await request.json();
  const reservationId = String(body.reservationId || '').trim();
  const status = String(body.status || '').trim().toLowerCase();
  const allowed = ['pending', 'entitled', 'delivered', 'failed'];

  if (!reservationId) {
    return json({ ok: false, error: 'reservation_id_required' }, 422);
  }
  if (!allowed.includes(status)) {
    return json({
      ok: false,
      error: 'invalid_lookbook_status',
      allowed
    }, 422);
  }

  const reservation = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM reservations WHERE id = ?'
  ).bind(reservationId).first();

  if (!reservation) return json({ ok: false, error: 'reservation_not_found' }, 404);

  await env.PHAM_CAMPAIGN_DB.prepare(
    `UPDATE reservations
     SET digital_lookbook_status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(status, reservationId).run();

  const fields = [
    metafield(
      reservation.shopify_order_id,
      'digital_lookbook_status',
      'single_line_text_field',
      status
    )
  ];

  if (reservation.shopify_customer_id) {
    fields.push(
      metafield(
        reservation.shopify_customer_id,
        'digital_lookbook_status',
        'single_line_text_field',
        status
      )
    );
  }

  await setMetafields(env, fields);

  return json({
    ok: true,
    reservationId,
    status
  });
}

async function getWebhookReviews(env, url) {
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(100, requestedLimit))
    : 50;

  const rows = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, topic, status, detail, processed_at
     FROM webhook_events
     WHERE status = 'review_required'
     ORDER BY processed_at DESC
     LIMIT ?`
  ).bind(limit).all();

  return json({
    ok: true,
    count: (rows.results || []).length,
    reviews: (rows.results || []).map(function(row) {
      let detail = row.detail || null;
      if (detail) {
        try { detail = JSON.parse(detail); } catch (_error) {}
      }
      return {
        webhookId: row.id,
        topic: row.topic,
        status: row.status,
        detail,
        processedAt: row.processed_at
      };
    })
  });
}

async function collectReadiness(env, editionId) {
  const response = await getReadiness(env, editionId);
  const payload = await response.json().catch(function(){ return {}; });
  return payload;
}

async function setEditionSizeOptions(request, env) {
  const body = await request.json();
  const editionId = String(body.editionId || 'edition-01').trim();
  const rawSizes = Array.isArray(body.sizes)
    ? body.sizes
    : String(body.sizes || '').split(',');

  if (body.confirm !== 'SET_SIZE_OPTIONS') {
    return json({ ok: false, error: 'explicit_confirmation_required' }, 400);
  }

  const sizes = Array.from(new Set(
    rawSizes
      .map(function(size) { return String(size || '').trim(); })
      .filter(Boolean)
  ));

  if (!sizes.length || sizes.length > 20) {
    return json({ ok: false, error: 'invalid_size_options_count' }, 422);
  }
  if (sizes.some(function(size) {
    return size.length > 24 || size.includes(',');
  })) {
    return json({ ok: false, error: 'invalid_size_option' }, 422);
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT id FROM editions WHERE id = ?'
  ).bind(editionId).first();

  if (!edition) return json({ ok: false, error: 'edition_not_found' }, 404);

  await env.PHAM_CAMPAIGN_DB.prepare(
    'UPDATE editions SET size_options_csv = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(sizes.join(','), editionId).run();

  return json({
    ok: true,
    editionId,
    sizeOptions: sizes
  });
}

async function mapReservationVariants(request, env) {
  const body = await request.json();
  const editionId = String(body.editionId || 'edition-01').trim();

  if (body.confirm !== 'MAP_RESERVATION_VARIANTS') {
    return json({ ok: false, error: 'explicit_confirmation_required' }, 400);
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT id, final_product_variant_id, final_price_cents FROM editions WHERE id = ?'
  ).bind(editionId).first();

  if (!edition) return json({ ok: false, error: 'edition_not_found' }, 404);

  const rows = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, size_preference, final_variant_id, status
     FROM reservations
     WHERE edition_id = ?
       AND status IN ('active','final_payment_open')
     ORDER BY created_at ASC`
  ).bind(editionId).all();

  const reservations = rows.results || [];
  if (!reservations.length) {
    return json({
      ok: true,
      editionId,
      mapped: 0,
      reservations: []
    });
  }

  let variants;
  try {
    variants = await loadFinalProductVariants(env, edition);
  } catch (error) {
    return json({
      ok: false,
      error: error.message || 'final_product_variants_unavailable'
    }, 409);
  }

  const mappings = [];
  const failures = [];

  reservations.forEach(function(reservation) {
    try {
      const selected = selectFinalVariantBySize(
        variants,
        reservation.size_preference,
        edition.final_price_cents
      );
      mappings.push({
        reservationId: reservation.id,
        sizePreference: reservation.size_preference,
        previousVariantId: reservation.final_variant_id || null,
        variantId: selected.id,
        sku: selected.sku || '',
        title: selected.title || ''
      });
    } catch (error) {
      failures.push({
        reservationId: reservation.id,
        sizePreference: reservation.size_preference || null,
        error: error.message || String(error)
      });
    }
  });

  if (failures.length) {
    return json({
      ok: false,
      error: 'reservation_variant_mapping_incomplete',
      editionId,
      mapped: 0,
      failures
    }, 409);
  }

  if (mappings.length) {
    await env.PHAM_CAMPAIGN_DB.batch(
      mappings.map(function(mapping) {
        return env.PHAM_CAMPAIGN_DB.prepare(
          'UPDATE reservations SET final_variant_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(mapping.variantId, mapping.reservationId);
      })
    );
  }

  return json({
    ok: true,
    editionId,
    mapped: mappings.length,
    reservations: mappings
  });
}

async function assignReservationVariant(request, env) {
  const body = await request.json();
  const reservationId = String(body.reservationId || '').trim();
  const variantId = String(body.variantId || '').trim();

  if (!reservationId || !variantId) {
    return json({ ok: false, error: 'reservation_id_and_variant_id_required' }, 422);
  }

  const reservation = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT id, edition_id, size_preference, status FROM reservations WHERE id = ?'
  ).bind(reservationId).first();

  if (!reservation) return json({ ok: false, error: 'reservation_not_found' }, 404);
  if (['cancelled', 'expired', 'final_paid'].includes(reservation.status)) {
    return json({ ok: false, error: 'reservation_not_mappable', status: reservation.status }, 409);
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT id, final_price_cents FROM editions WHERE id = ?'
  ).bind(reservation.edition_id).first();

  if (!edition) return json({ ok: false, error: 'edition_not_found' }, 404);

  const result = await shopifyGraphQL(env, `query ValidateFinalVariant($id: ID!) {
    productVariant(id: $id) {
      id
      sku
      title
      price
      selectedOptions { name value }
      product { id title status }
    }
  }`, { id: variantId });

  const variant = result && result.data && result.data.productVariant;
  if (!variant) return json({ ok: false, error: 'variant_not_found' }, 404);

  if (!variant.product || variant.product.status !== 'ACTIVE') {
    return json({ ok: false, error: 'variant_product_not_active' }, 409);
  }

  if (Number(variant.price) !== Number(edition.final_price_cents) / 100) {
    return json({
      ok: false,
      error: 'variant_price_mismatch',
      expected: Number(edition.final_price_cents) / 100,
      actual: Number(variant.price)
    }, 409);
  }

  const preference = String(reservation.size_preference || '').trim().toLowerCase();
  if (preference) {
    const sizeOption = (variant.selectedOptions || []).find(function(option) {
      return String(option.name || '').trim().toLowerCase() === 'size';
    });
    const actualSize = sizeOption ? String(sizeOption.value || '').trim().toLowerCase() : '';

    if (!actualSize || actualSize !== preference) {
      return json({
        ok: false,
        error: 'variant_size_mismatch',
        expectedSize: reservation.size_preference,
        actualSize: sizeOption ? sizeOption.value : null,
        variantTitle: variant.title
      }, 409);
    }
  }

  await env.PHAM_CAMPAIGN_DB.prepare(
    'UPDATE reservations SET final_variant_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(variant.id, reservationId).run();

  return json({
    ok: true,
    reservationId,
    sizePreference: reservation.size_preference || null,
    variant: {
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      price: variant.price,
      productTitle: variant.product.title
    }
  });
}

export function parseEditionSizeOptions(value) {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map(function(size) { return size.trim(); })
      .filter(Boolean)
  ));
}

export function evaluateFinalSizeVariants(variants, expectedSizes, finalPriceCents) {
  const expected = (expectedSizes || []).map(function(size) {
    return String(size || '').trim();
  }).filter(Boolean);

  const rows = expected.map(function(size) {
    const normalized = size.toLowerCase();
    const matches = (variants || []).filter(function(variant) {
      const sizeOption = (variant && variant.selectedOptions || []).find(function(option) {
        return String(option && option.name || '').trim().toLowerCase() === 'size';
      });
      const actualSize = sizeOption
        ? String(sizeOption.value || '').trim().toLowerCase()
        : '';
      return actualSize === normalized;
    });

    const valid = matches.filter(function(variant) {
      return moneyToCents(variant && variant.price) === Number(finalPriceCents);
    });

    return {
      size,
      matches: matches.length,
      validMatches: valid.length,
      variantIds: valid.map(function(variant) { return variant.id; }),
      skus: valid.map(function(variant) { return variant.sku || ''; })
    };
  });

  return {
    ok: expected.length > 0 && rows.every(function(row) {
      return row.matches === 1 && row.validMatches === 1;
    }),
    expectedSizes: expected,
    rows
  };
}

async function getReadiness(env, editionId) {
  const checks = [];
  const requiredScopes = [
    'read_orders',
    'write_orders',
    'read_customers',
    'write_customers',
    'read_draft_orders',
    'write_draft_orders',
    'read_inventory',
    'write_inventory',
    'read_products'
  ];

  function check(name, ok, detail) {
    checks.push({ name, ok: Boolean(ok), detail: detail || null });
  }

  check('env.SHOPIFY_SHOP_DOMAIN', Boolean(env.SHOPIFY_SHOP_DOMAIN), env.SHOPIFY_SHOP_DOMAIN || null);
  check('env.SHOPIFY_ADMIN_TOKEN', Boolean(env.SHOPIFY_ADMIN_TOKEN), env.SHOPIFY_ADMIN_TOKEN ? 'configured' : 'missing');
  check('env.SHOPIFY_API_SECRET', Boolean(env.SHOPIFY_API_SECRET), env.SHOPIFY_API_SECRET ? 'configured (App Proxy + webhook HMAC)' : 'missing');
  check('env.INTERNAL_ADMIN_KEY', Boolean(env.INTERNAL_ADMIN_KEY), env.INTERNAL_ADMIN_KEY ? 'configured' : 'missing');
  check('env.STOREFRONT_ORIGIN', Boolean(env.STOREFRONT_ORIGIN), env.STOREFRONT_ORIGIN || null);

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();

  check('d1.edition', Boolean(edition), edition ? edition.id : 'missing');

  if (edition) {
    check('d1.edition_size', Number(edition.edition_size) > 0, String(edition.edition_size));
    check('d1.final_product_variant_id', Boolean(edition.final_product_variant_id), edition.final_product_variant_id || 'missing');
    check('d1.identity_inventory_item_id', Boolean(edition.identity_inventory_item_id), edition.identity_inventory_item_id || 'missing');
    check('d1.identity_location_id', Boolean(edition.identity_location_id), edition.identity_location_id || 'missing');
    const sizeOptions = parseEditionSizeOptions(edition.size_options_csv);
    check('d1.size_options', sizeOptions.length > 0, sizeOptions);
    check('d1.pricing', Number(edition.final_price_cents) > Number(edition.reservation_price_cents), {
      reservationPriceCents: Number(edition.reservation_price_cents),
      finalPriceCents: Number(edition.final_price_cents)
    });
  }

  let scopes = [];
  try {
    const scopeResult = await shopifyGraphQL(env, `query PhamAccessScopes {
      currentAppInstallation {
        id
        accessScopes { handle }
      }
    }`, {});

    scopes = (
      scopeResult &&
      scopeResult.data &&
      scopeResult.data.currentAppInstallation &&
      scopeResult.data.currentAppInstallation.accessScopes || []
    ).map(function(scope) { return scope.handle; });

    check('shopify.admin_api', true, 'connected');
  } catch (error) {
    check('shopify.admin_api', false, error.message || String(error));
  }

  const missingScopes = requiredScopes.filter(function(scope) {
    return !scopes.includes(scope);
  });

  check('shopify.runtime_scopes', missingScopes.length === 0, {
    required: requiredScopes,
    missing: missingScopes
  });

  if (edition && env.SHOPIFY_ADMIN_TOKEN && missingScopes.length === 0) {
    try {
      const resourceResult = await shopifyGraphQL(env, `query PhamBackendReadiness(
        $variantId: ID!,
        $inventoryItemId: ID!,
        $locationId: ID!,
        $campaignSkus: String!
      ) {
        productVariant(id: $variantId) {
          id
          sku
          price
          inventoryQuantity
          inventoryPolicy
          inventoryItem {
            id
            tracked
            requiresShipping
          }
          product {
            id
            status
            variants(first: 100) {
              nodes {
                id
                sku
                title
                price
                selectedOptions { name value }
              }
            }
          }
        }
        campaignVariants: productVariants(first: 20, query: $campaignSkus) {
          nodes {
            id
            sku
            price
            inventoryQuantity
            inventoryPolicy
            inventoryItem {
              id
              tracked
              requiresShipping
            }
            product {
              id
              title
              handle
              status
            }
          }
        }
        draftOrders(first: 1) {
          nodes { id status }
        }
        inventoryItem(id: $inventoryItemId) {
          id
          tracked
          inventoryLevel(locationId: $locationId) {
            id
            quantities(names: ["available"]) { name quantity }
          }
        }
      }`, {
        variantId: edition.final_product_variant_id,
        inventoryItemId: edition.identity_inventory_item_id,
        locationId: edition.identity_location_id,
        campaignSkus: 'sku:PHAM-001-RES-E01 OR sku:PHAM-ID-E01 OR sku:PHAM-LOOKBOOK-E01 OR sku:PHAM-001-E01'
      });

      const variant = resourceResult && resourceResult.data && resourceResult.data.productVariant;
      const inventoryItem = resourceResult && resourceResult.data && resourceResult.data.inventoryItem;
      const level = inventoryItem && inventoryItem.inventoryLevel;
      const available = level && (level.quantities || []).find(function(quantity) {
        return quantity && quantity.name === 'available';
      });
      const finalProductVariants = variant && variant.product &&
        variant.product.variants && variant.product.variants.nodes || [];
      const sizeCoverage = evaluateFinalSizeVariants(
        finalProductVariants,
        parseEditionSizeOptions(edition.size_options_csv),
        edition.final_price_cents
      );
      const campaignVariants = resourceResult && resourceResult.data &&
        resourceResult.data.campaignVariants && resourceResult.data.campaignVariants.nodes || [];
      const bySku = {};
      campaignVariants.forEach(function(item) {
        if (item && item.sku) bySku[item.sku] = item;
      });

      const reservationVariant = bySku['PHAM-001-RES-E01'];
      const identityVariant = bySku['PHAM-ID-E01'];
      const lookbookVariant = bySku['PHAM-LOOKBOOK-E01'];

      const activeReservations = await scalar(env,
        "SELECT COUNT(*) AS count FROM reservations WHERE edition_id = ? AND status NOT IN ('cancelled','expired')",
        editionId
      );
      const identityClaimed = await scalar(env,
        "SELECT COUNT(*) AS count FROM identity_claims WHERE edition_id = ? AND status != 'revoked'",
        editionId
      );
      const reservationRemaining = Math.max(0, Number(edition.edition_size) - activeReservations);
      const identityRemaining = Math.max(0, Number(edition.identity_limit) - identityClaimed);

      check('shopify.final_variant', Boolean(
        variant &&
        variant.id === edition.final_product_variant_id &&
        Number(variant.price) === Number(edition.final_price_cents) / 100 &&
        variant.product && variant.product.status === 'ACTIVE'
      ), variant ? {
        id: variant.id,
        sku: variant.sku,
        price: variant.price,
        inventoryQuantity: variant.inventoryQuantity,
        productStatus: variant.product && variant.product.status
      } : 'not_found');

      check('shopify.final_size_variants', sizeCoverage.ok, sizeCoverage);

      check('shopify.reservation_variant', Boolean(
        reservationVariant &&
        Number(reservationVariant.price) === Number(edition.reservation_price_cents) / 100 &&
        reservationVariant.product && reservationVariant.product.status === 'ACTIVE' &&
        reservationVariant.inventoryPolicy === 'DENY' &&
        reservationVariant.inventoryItem && reservationVariant.inventoryItem.tracked === true &&
        reservationVariant.inventoryItem.requiresShipping === false &&
        Number(reservationVariant.inventoryQuantity) >= reservationRemaining
      ), reservationVariant ? {
        id: reservationVariant.id,
        sku: reservationVariant.sku,
        price: reservationVariant.price,
        inventoryQuantity: reservationVariant.inventoryQuantity,
        expectedRemaining: reservationRemaining,
        inventoryPolicy: reservationVariant.inventoryPolicy,
        tracked: reservationVariant.inventoryItem && reservationVariant.inventoryItem.tracked,
        requiresShipping: reservationVariant.inventoryItem && reservationVariant.inventoryItem.requiresShipping,
        productStatus: reservationVariant.product && reservationVariant.product.status
      } : 'not_found');

      check('shopify.identity_variant', Boolean(
        identityVariant &&
        Number(identityVariant.price) === 5 &&
        identityVariant.product && identityVariant.product.status === 'ACTIVE' &&
        identityVariant.inventoryPolicy === 'DENY' &&
        identityVariant.inventoryItem && identityVariant.inventoryItem.tracked === true &&
        identityVariant.inventoryItem.requiresShipping === false &&
        Number(identityVariant.inventoryQuantity) === identityRemaining
      ), identityVariant ? {
        id: identityVariant.id,
        sku: identityVariant.sku,
        price: identityVariant.price,
        inventoryQuantity: identityVariant.inventoryQuantity,
        expectedRemaining: identityRemaining,
        inventoryPolicy: identityVariant.inventoryPolicy,
        tracked: identityVariant.inventoryItem && identityVariant.inventoryItem.tracked,
        requiresShipping: identityVariant.inventoryItem && identityVariant.inventoryItem.requiresShipping,
        productStatus: identityVariant.product && identityVariant.product.status
      } : 'not_found');

      check('shopify.lookbook_variant', Boolean(
        lookbookVariant &&
        Number(lookbookVariant.price) === 0 &&
        lookbookVariant.product && lookbookVariant.product.status === 'ACTIVE' &&
        lookbookVariant.inventoryItem &&
        lookbookVariant.inventoryItem.requiresShipping === false
      ), lookbookVariant ? {
        id: lookbookVariant.id,
        sku: lookbookVariant.sku,
        price: lookbookVariant.price,
        tracked: lookbookVariant.inventoryItem && lookbookVariant.inventoryItem.tracked,
        requiresShipping: lookbookVariant.inventoryItem && lookbookVariant.inventoryItem.requiresShipping,
        productStatus: lookbookVariant.product && lookbookVariant.product.status
      } : 'not_found');

      check('shopify.identity_inventory', Boolean(inventoryItem && inventoryItem.tracked && level), inventoryItem ? {
        id: inventoryItem.id,
        tracked: inventoryItem.tracked,
        available: available ? available.quantity : null,
        expectedRemaining: identityRemaining
      } : 'not_found');

      check('shopify.draft_orders_read', true, 'accessible');
    } catch (error) {
      check('shopify.resource_probe', false, error.message || String(error));
    }
  }

  const failed = checks.filter(function(item) { return !item.ok; });

  return json({
    ok: failed.length === 0,
    editionId,
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length
    }
  }, failed.length === 0 ? 200 : 503);
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
      sizeOptions: parseEditionSizeOptions(edition.size_options_csv),
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

async function joinStandbyRecord(env, input) {
  const editionId = String(input.editionId || 'edition-01');
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim().slice(0, 120);
  const country = String(input.country || '').trim().slice(0, 120);
  const size = String(input.size || '').trim().slice(0, 24);

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: 'invalid_email', status: 422 };
  }
  if (!size) {
    return { ok: false, error: 'size_preference_required', status: 422 };
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();

  if (!edition) return { ok: false, error: 'edition_not_found', status: 404 };
  if (edition.state !== 'reservation_full') {
    return { ok: false, error: 'standby_not_open', status: 409 };
  }

  const customerId = input.customerId || null;
  const existing = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, position, status
     FROM standby
     WHERE edition_id = ?
       AND status IN ('waiting','promoting','promoted')
       AND (
         email = ?
         OR (? IS NOT NULL AND customer_id = ?)
       )
     ORDER BY position ASC
     LIMIT 1`
  ).bind(editionId, email, customerId, customerId).first();

  if (existing) {
    return {
      ok: true,
      created: false,
      standbyId: existing.id,
      position: existing.position,
      queueStatus: existing.status
    };
  }

  let insertedId = '';
  let result = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidateId = crypto.randomUUID();

    try {
      result = await env.PHAM_CAMPAIGN_DB.prepare(
        `INSERT INTO standby (
           id, edition_id, email, customer_id, name, country, size_preference,
           position, status
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, COALESCE(MAX(position), 0) + 1, 'waiting'
         FROM standby
         WHERE edition_id = ?`
      ).bind(
        candidateId,
        editionId,
        email,
        customerId,
        name || null,
        country || null,
        size,
        editionId
      ).run();

      if (result.meta && result.meta.changes) {
        insertedId = candidateId;
        break;
      }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      const raced = await env.PHAM_CAMPAIGN_DB.prepare(
        `SELECT id, position, status
         FROM standby
         WHERE edition_id = ?
           AND status IN ('waiting','promoting','promoted')
           AND (
             email = ?
             OR (? IS NOT NULL AND customer_id = ?)
           )
         ORDER BY position ASC
         LIMIT 1`
      ).bind(editionId, email, customerId, customerId).first();

      if (raced) {
        return {
          ok: true,
          created: false,
          standbyId: raced.id,
          position: raced.position,
          queueStatus: raced.status
        };
      }

      // Another collector can win the same MAX(position)+1 between read/write.
      // Retry so this collector receives the next free FIFO position instead
      // of surfacing a transient uniqueness error.
      continue;
    }
  }

  if (!insertedId) {
    return { ok: false, error: 'standby_queue_contention', status: 503 };
  }

  const row = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT id, position, status FROM standby WHERE id = ?'
  ).bind(insertedId).first();

  if (!row) {
    return { ok: false, error: 'standby_join_persistence_failed', status: 500 };
  }

  console.log('Standby joined', {
    editionId,
    email,
    name,
    country,
    size,
    customerId: input.customerId || null,
    position: row.position
  });

  return {
    ok: true,
    created: true,
    standbyId: row.id,
    position: row.position,
    queueStatus: row.status
  };
}

async function handleOrdersPaid(request, env) {
  const raw = await request.arrayBuffer();
  const verified = await verifyShopifyWebhook(raw, request.headers.get('x-shopify-hmac-sha256'), env.SHOPIFY_API_SECRET);
  if (!verified) return json({ error: 'Invalid webhook signature' }, 401);

  const webhookShop = request.headers.get('x-shopify-shop-domain') || '';
  if (env.SHOPIFY_SHOP_DOMAIN && webhookShop !== env.SHOPIFY_SHOP_DOMAIN) {
    return json({ error: 'Invalid webhook shop' }, 401);
  }

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
  const finalReservationId = orderAttribute(order, 'PHAM Reservation ID');
  const finalStandbyId = orderAttribute(order, 'PHAM Standby ID');

  if (!reservationLine && (finalReservationId || finalStandbyId || finalLine)) {
    const finalResult = await handleFinalAcquisitionPaid(env, order);
    if (webhookId) {
      await recordWebhook(
        env,
        webhookId,
        topic,
        finalResult && finalResult.ok === false ? 'review_required' : 'processed',
        finalResult && finalResult.ok === false ? JSON.stringify(finalResult) : ''
      );
    }
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

  let reservationValidation;
  try {
    reservationValidation = validatePriorityReservationOrder({ order, edition });
  } catch (error) {
    const review = {
      ok: false,
      review: true,
      reason: error && error.message ? error.message : 'reservation_payment_validation_failed',
      shopifyOrderId: order && order.id ? toGid('Order', order.id) : null
    };
    console.error('Priority Reservation payment requires review', review);
    if (webhookId) {
      await recordWebhook(env, webhookId, topic, 'review_required', JSON.stringify(review));
    }
    return json(review);
  }

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

  let existingCollector = null;
  if (shopifyCustomerId) {
    existingCollector = await env.PHAM_CAMPAIGN_DB.prepare(
      `SELECT id, shopify_order_id
       FROM reservations
       WHERE edition_id = ?
         AND shopify_customer_id = ?
         AND status NOT IN ('cancelled','expired')
       LIMIT 1`
    ).bind(edition.id, shopifyCustomerId).first();
  }
  if (!existingCollector && email) {
    existingCollector = await env.PHAM_CAMPAIGN_DB.prepare(
      `SELECT id, shopify_order_id
       FROM reservations
       WHERE edition_id = ?
         AND lower(email) = ?
         AND status NOT IN ('cancelled','expired')
       LIMIT 1`
    ).bind(edition.id, email).first();
  }

  if (existingCollector) {
    const review = {
      ok: false,
      review: true,
      reason: 'collector_already_reserved',
      existingReservationId: existingCollector.id,
      shopifyOrderId
    };
    console.error('Duplicate collector reservation requires review', review);
    if (webhookId) {
      await recordWebhook(env, webhookId, topic, 'review_required', JSON.stringify(review));
    }
    return json(review);
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
  const reservationLineValidated = reservationValidation.reservationLine;
  const identityLine = reservationValidation.identityLine;
  const referredByCode = safeCode(propertyValue(reservationLineValidated, '_PHAM Referral Code'));
  const sizePreference = reservationValidation.sizePreference;
  const reservationPaidCents = reservationValidation.reservationPaidCents;
  const balanceDueCents = Math.max(0, edition.final_price_cents - edition.reservation_price_cents);

  let reservationInsert;
  try {
    reservationInsert = await env.PHAM_CAMPAIGN_DB.prepare(
      `INSERT INTO reservations (
        id, edition_id, shopify_order_id, shopify_customer_id, email, status,
        reservation_paid_cents, balance_due_cents, referral_code, referred_by_code,
        size_preference, digital_lookbook_status
      )
      SELECT ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 'entitled'
      WHERE (
        SELECT COUNT(*)
        FROM reservations
        WHERE edition_id = ?
          AND status NOT IN ('cancelled','expired')
      ) < ?`
    ).bind(
      reservationId,
      edition.id,
      shopifyOrderId,
      shopifyCustomerId,
      email,
      reservationPaidCents,
      balanceDueCents,
      referralCode,
      referredByCode || null,
      sizePreference || null,
      edition.id,
      Number(edition.edition_size)
    ).run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicateOrder = await env.PHAM_CAMPAIGN_DB.prepare(
        'SELECT id FROM reservations WHERE shopify_order_id = ?'
      ).bind(shopifyOrderId).first();

      if (duplicateOrder) {
        if (webhookId) await recordWebhook(env, webhookId, topic);
        return json({
          ok: true,
          reservationId: duplicateOrder.id,
          duplicateOrder: true
        });
      }

      const raceReview = {
        ok: false,
        review: true,
        reason: 'collector_already_reserved_race',
        shopifyOrderId
      };
      if (webhookId) {
        await recordWebhook(
          env,
          webhookId,
          topic,
          'review_required',
          JSON.stringify(raceReview)
        );
      }
      return json(raceReview);
    }
    throw error;
  }

  if (!(reservationInsert && reservationInsert.meta && reservationInsert.meta.changes)) {
    await env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE editions SET state = 'reservation_full', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(edition.id).run();

    const capacityReview = {
      ok: false,
      review: true,
      reason: 'reservation_capacity_race',
      shopifyOrderId
    };
    if (webhookId) {
      await recordWebhook(
        env,
        webhookId,
        topic,
        'review_required',
        JSON.stringify(capacityReview)
      );
    }
    return json(capacityReview);
  }

  let identityResult = { claimed: false };

  if (identityLine) {
    identityResult = await claimIdentity(env, {
      editionId: edition.id,
      reservationId,
      source: 'paid'
    });
  }

  if (identityLine && !identityResult.claimed) {
    console.error('Paid Identity requires manual review', {
      reservationId,
      shopifyOrderId,
      reason: 'shared_pool_claim_failed_after_payment'
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
    sizePreference,
    identitySelected: Boolean(identityLine),
    identityClaimed: identityResult.claimed,
    identitySource: identityLine ? 'paid' : '',
    lookbookStatus: 'entitled',
    balanceDueCents
  });

  const afterCount = await scalar(
    env,
    "SELECT COUNT(*) AS count FROM reservations WHERE edition_id = ? AND status NOT IN ('cancelled','expired')",
    edition.id
  );
  if (afterCount >= Number(edition.edition_size)) {
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
  const standbyId = orderAttribute(order, 'PHAM Standby ID');
  if (standbyId) {
    return handleStandbyAcquisitionPaid(env, order, standbyId);
  }

  const reservationId = orderAttribute(order, 'PHAM Reservation ID');
  if (!reservationId) {
    return { ok: true, ignored: true, reason: 'final_order_without_campaign_id' };
  }

  const reservation = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM reservations WHERE id = ?'
  ).bind(reservationId).first();

  if (!reservation) {
    return { ok: false, reason: 'unknown_reservation_id', reservationId };
  }

  const finalOrderId = toGid('Order', order.id);

  if (reservation.status === 'final_paid') {
    if (!reservation.final_shopify_order_id || reservation.final_shopify_order_id === finalOrderId) {
      return {
        ok: true,
        duplicate: true,
        type: 'final_acquisition_paid',
        reservationId,
        finalOrderId: reservation.final_shopify_order_id || finalOrderId
      };
    }
    return {
      ok: false,
      reason: 'final_payment_already_recorded',
      reservationId,
      finalOrderId: reservation.final_shopify_order_id
    };
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(reservation.edition_id).first();

  if (!edition) {
    return { ok: false, reason: 'edition_not_found', reservationId };
  }

  let validation;
  try {
    validation = validateFinalAcquisitionOrder({ order, reservation, edition });
  } catch (error) {
    return {
      ok: false,
      reason: error && error.message ? error.message : 'final_payment_validation_failed',
      reservationId,
      finalOrderId
    };
  }

  await env.PHAM_CAMPAIGN_DB.prepare(
    `UPDATE reservations
     SET status = 'final_paid',
         final_payment_status = 'paid',
         final_shopify_order_id = ?,
         payment_deadline = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(finalOrderId, reservationId).run();

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
    finalOrderId,
    variantId: validation.variantId
  };
}

async function handleStandbyAcquisitionPaid(env, order, standbyId) {
  const standby = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM standby WHERE id = ?'
  ).bind(standbyId).first();

  if (!standby) {
    return { ok: false, reason: 'unknown_standby_id', standbyId };
  }

  if (standby.converted_reservation_id) {
    return {
      ok: true,
      duplicate: true,
      type: 'standby_acquisition_paid',
      reservationId: standby.converted_reservation_id,
      standbyId
    };
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(standby.edition_id).first();
  if (!edition) return { ok: false, reason: 'edition_not_found', standbyId };

  let validation;
  try {
    validation = validateStandbyAcquisitionOrder({ order, standby, edition });
  } catch (error) {
    return {
      ok: false,
      reason: error && error.message ? error.message : 'standby_payment_validation_failed',
      standbyId,
      finalOrderId: order && order.id ? toGid('Order', order.id) : null
    };
  }

  const shopifyOrderId = toGid('Order', order.id);
  const shopifyCustomerId = order.customer && order.customer.id
    ? toGid('Customer', order.customer.id)
    : standby.customer_id;
  const email = String(order.email || (order.customer && order.customer.email) || standby.email || '').toLowerCase();
  const reservationId = await uniqueReservationId(env);
  const referralCode = await uniqueReferralCode(env);

  await env.PHAM_CAMPAIGN_DB.prepare(
    `INSERT INTO reservations (
      id, edition_id, shopify_order_id, shopify_customer_id, email, status,
      reservation_paid_cents, balance_due_cents, referral_code, standby_id,
      size_preference, final_variant_id, final_shopify_order_id,
      final_payment_status, digital_lookbook_status
    ) VALUES (?, ?, ?, ?, ?, 'final_paid', 0, 0, ?, ?, ?, ?, ?, 'paid', 'not_included')`
  ).bind(
    reservationId,
    edition.id,
    shopifyOrderId,
    shopifyCustomerId || null,
    email,
    referralCode,
    standbyId,
    standby.size_preference || null,
    validation.variantId,
    shopifyOrderId
  ).run();

  await env.PHAM_CAMPAIGN_DB.prepare(
    `UPDATE standby
     SET status = 'converted',
         converted_reservation_id = ?
     WHERE id = ?`
  ).bind(reservationId, standbyId).run();

  await setMetafields(env, [
    metafield(shopifyOrderId, 'edition_label', 'single_line_text_field', edition.label),
    metafield(shopifyOrderId, 'reservation_id', 'single_line_text_field', reservationId),
    metafield(shopifyOrderId, 'size_preference', 'single_line_text_field', standby.size_preference || ''),
    metafield(shopifyOrderId, 'final_payment_status', 'single_line_text_field', 'paid')
  ]);

  if (shopifyCustomerId) {
    await setMetafields(env, [
      metafield(shopifyCustomerId, 'referral_code', 'single_line_text_field', referralCode),
      metafield(shopifyCustomerId, 'successful_referrals', 'number_integer', '0'),
      metafield(shopifyCustomerId, 'current_reservation_status', 'single_line_text_field', 'final_paid'),
      metafield(shopifyCustomerId, 'identity_status', 'single_line_text_field', 'locked'),
      metafield(shopifyCustomerId, 'reservation_id', 'single_line_text_field', reservationId),
      metafield(shopifyCustomerId, 'size_preference', 'single_line_text_field', standby.size_preference || ''),
      metafield(shopifyCustomerId, 'digital_lookbook_status', 'single_line_text_field', 'not_included')
    ]);
  }

  return {
    ok: true,
    type: 'standby_acquisition_paid',
    reservationId,
    standbyId,
    finalOrderId: shopifyOrderId
  };
}

async function getPublicProvenance(env, token) {
  const normalized = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,96}$/.test(normalized)) {
    return json({ ok: false, error: 'invalid_provenance_token' }, 422);
  }

  const tokenHash = await sha256Hex(normalized);

  const row = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT
       o.object_number,
       o.token_type,
       o.provenance_status,
       e.label AS edition_label,
       e.product_code,
       e.edition_size,
       e.design_origin,
       e.production_origin,
       i.public_identity,
       i.engraving_name
     FROM objects o
     JOIN editions e ON e.id = o.edition_id
     LEFT JOIN identity_claims i ON i.reservation_id = o.reservation_id
     WHERE o.auth_token_hash = ?
     LIMIT 1`
  ).bind(tokenHash).first();

  if (!row) {
    return json({ ok: false, error: 'provenance_not_found' }, 404);
  }

  return json({
    ok: true,
    authenticated: true,
    object: {
      productCode: row.product_code,
      editionLabel: row.edition_label,
      editionSize: row.edition_size,
      objectNumber: row.object_number,
      designOrigin: row.design_origin,
      productionOrigin: row.production_origin,
      provenanceStatus: row.provenance_status,
      tokenType: row.token_type || 'pending_allocation',
      publicIdentity: row.public_identity ? String(row.engraving_name || '') : null
    }
  });
}

async function finalizeObjectNumbers(request, env) {
  const body = await request.json();
  const editionId = String(body.editionId || 'edition-01');

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();
  if (!edition) return json({ ok: false, error: 'edition_not_found' }, 404);

  const finalPaidCount = await scalar(
    env,
    "SELECT COUNT(*) AS count FROM reservations WHERE edition_id = ? AND status = 'final_paid'",
    editionId
  );

  if (finalPaidCount !== Number(edition.edition_size)) {
    return json({
      ok: false,
      error: 'edition_not_fully_acquired',
      finalPaidCount,
      editionSize: Number(edition.edition_size)
    }, 409);
  }

  const unconfigured = await scalar(
    env,
    `SELECT COUNT(*) AS count
     FROM identity_claims i
     JOIN reservations r ON r.id = i.reservation_id
     WHERE i.edition_id = ?
       AND r.status = 'final_paid'
       AND i.status NOT IN ('configured','revoked')`,
    editionId
  );

  if (unconfigured > 0) {
    return json({
      ok: false,
      error: 'identity_configuration_incomplete',
      unconfigured
    }, 409);
  }

  const usedRows = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT object_number
     FROM reservations
     WHERE edition_id = ?
       AND status = 'final_paid'
       AND object_number IS NOT NULL
     ORDER BY object_number ASC`
  ).bind(editionId).all();

  const used = new Set((usedRows.results || []).map(function(row) {
    return Number(row.object_number);
  }));

  const available = [];
  for (let i = 1; i <= Number(edition.edition_size); i++) {
    if (!used.has(i)) available.push(i);
  }

  const unnumbered = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, shopify_customer_id
     FROM reservations
     WHERE edition_id = ?
       AND status = 'final_paid'
       AND object_number IS NULL
     ORDER BY created_at ASC, id ASC`
  ).bind(editionId).all();

  if ((unnumbered.results || []).length !== available.length) {
    return json({
      ok: false,
      error: 'object_number_allocation_mismatch',
      available: available.length,
      unnumbered: (unnumbered.results || []).length
    }, 409);
  }

  const assignments = [];

  for (let index = 0; index < (unnumbered.results || []).length; index++) {
    const reservation = unnumbered.results[index];
    const number = available[index];

    await env.PHAM_CAMPAIGN_DB.prepare(
      `UPDATE reservations
       SET object_number = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND object_number IS NULL`
    ).bind(number, reservation.id).run();

    if (reservation.shopify_customer_id) {
      await setMetafields(env, [
        metafield(reservation.shopify_customer_id, 'current_object_number', 'number_integer', String(number))
      ]);
    }

    assignments.push({
      reservationId: reservation.id,
      objectNumber: number
    });
  }

  const finalRows = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, object_number
     FROM reservations
     WHERE edition_id = ? AND status = 'final_paid'
     ORDER BY object_number ASC`
  ).bind(editionId).all();

  const objects = [];

  for (const reservation of finalRows.results || []) {
    let object = await env.PHAM_CAMPAIGN_DB.prepare(
      'SELECT id, object_number, qr_token FROM objects WHERE reservation_id = ?'
    ).bind(reservation.id).first();

    if (!object) {
      const qrToken = randomToken(40);
      const authHash = await sha256Hex(qrToken);
      const objectId = editionId + '-object-' + String(reservation.object_number).padStart(3, '0');

      await env.PHAM_CAMPAIGN_DB.prepare(
        `INSERT INTO objects (
          id, edition_id, object_number, reservation_id,
          auth_token_hash, qr_token, provenance_status, token_type
        ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', NULL)`
      ).bind(
        objectId,
        editionId,
        reservation.object_number,
        reservation.id,
        authHash,
        qrToken
      ).run();

      object = {
        id: objectId,
        object_number: reservation.object_number,
        qr_token: qrToken
      };
    }

    const storefront = String(env.STOREFRONT_ORIGIN || 'https://phamofficial.com').replace(/\/$/, '');
    objects.push({
      objectId: object.id,
      objectNumber: Number(object.object_number),
      qrUrl: storefront + '/pages/provenance?token=' + encodeURIComponent(object.qr_token)
    });
  }

  await env.PHAM_CAMPAIGN_DB.prepare(
    "UPDATE editions SET state = 'sold_out', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(editionId).run();

  return json({
    ok: true,
    editionId,
    state: 'sold_out',
    assignedCount: assignments.length,
    objects
  });
}

async function allocateFounderTokens(request, env) {
  const body = await request.json();
  const editionId = String(body.editionId || 'edition-01');
  const goldObjectNumber = Number(body.goldObjectNumber);

  if (body.confirm !== 'ALLOCATE_FOUNDER_TOKENS') {
    return json({ ok: false, error: 'explicit_confirmation_required' }, 400);
  }

  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();

  if (!edition) return json({ ok: false, error: 'edition_not_found' }, 404);
  if (edition.state !== 'sold_out') {
    return json({ ok: false, error: 'edition_not_finalized' }, 409);
  }

  if (!Number.isInteger(goldObjectNumber) ||
      goldObjectNumber < 1 ||
      goldObjectNumber > Number(edition.edition_size)) {
    return json({ ok: false, error: 'invalid_gold_object_number' }, 422);
  }

  const objectCount = await scalar(
    env,
    'SELECT COUNT(*) AS count FROM objects WHERE edition_id = ?',
    editionId
  );

  if (objectCount !== Number(edition.edition_size)) {
    return json({
      ok: false,
      error: 'object_set_incomplete',
      objectCount,
      editionSize: Number(edition.edition_size)
    }, 409);
  }

  const goldObject = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT id FROM objects WHERE edition_id = ? AND object_number = ?'
  ).bind(editionId, goldObjectNumber).first();

  if (!goldObject) {
    return json({ ok: false, error: 'gold_object_not_found' }, 404);
  }

  await env.PHAM_CAMPAIGN_DB.batch([
    env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE objects SET token_type = 'silver', updated_at = CURRENT_TIMESTAMP WHERE edition_id = ?"
    ).bind(editionId),
    env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE objects SET token_type = 'gold', updated_at = CURRENT_TIMESTAMP WHERE edition_id = ? AND object_number = ?"
    ).bind(editionId, goldObjectNumber)
  ]);

  const goldCount = await scalar(
    env,
    "SELECT COUNT(*) AS count FROM objects WHERE edition_id = ? AND token_type = 'gold'",
    editionId
  );
  const silverCount = await scalar(
    env,
    "SELECT COUNT(*) AS count FROM objects WHERE edition_id = ? AND token_type = 'silver'",
    editionId
  );

  if (goldCount !== 1 || silverCount !== Number(edition.edition_size) - 1) {
    return json({
      ok: false,
      error: 'token_allocation_integrity_failure',
      goldCount,
      silverCount
    }, 500);
  }

  return json({
    ok: true,
    editionId,
    goldObjectNumber,
    goldCount,
    silverCount,
    note: 'Allocation was explicitly selected by an authorized operator; no random draw was performed by the system.'
  });
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value))
  );
  return bytesToHex(new Uint8Array(digest));
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

  const claimed = (result.meta && result.meta.changes || 0) > 0;

  if (claimed && source === 'referral') {
    try {
      await adjustIdentityInventory(env, editionId, reservationId, -1);
    } catch (error) {
      await env.PHAM_CAMPAIGN_DB.prepare(
        'DELETE FROM identity_claims WHERE reservation_id = ? AND source = ?'
      ).bind(reservationId, source).run();
      throw error;
    }
  }

  return {
    claimed,
    source
  };
}

async function adjustIdentityInventory(env, editionId, reservationId, delta) {
  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT identity_inventory_item_id, identity_location_id FROM editions WHERE id = ?'
  ).bind(editionId).first();

  if (!edition || !edition.identity_inventory_item_id || !edition.identity_location_id) {
    throw new Error('Identity inventory configuration missing');
  }

  const mutation = `mutation AdjustIdentityInventory(
    $input: InventoryAdjustQuantitiesInput!,
    $idempotencyKey: String!
  ) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      userErrors { field message }
      inventoryAdjustmentGroup {
        createdAt
        reason
        referenceDocumentUri
        changes { name delta }
      }
    }
  }`;

  const input = {
    reason: 'correction',
    name: 'available',
    referenceDocumentUri: 'pham://identity/referral/' + reservationId,
    changes: [{
      delta,
      inventoryItemId: edition.identity_inventory_item_id,
      locationId: edition.identity_location_id
    }]
  };

  const result = await shopifyGraphQL(env, mutation, {
    input,
    idempotencyKey: 'pham-identity-referral-' + reservationId
  });

  const payload = result && result.data && result.data.inventoryAdjustQuantities;
  const errors = payload && payload.userErrors || [];
  if (errors.length) {
    throw new Error('Identity inventory adjustment failed: ' + JSON.stringify(errors));
  }

  return payload && payload.inventoryAdjustmentGroup;
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
    metafield(data.orderId, 'size_preference', 'single_line_text_field', data.sizePreference || ''),
    metafield(data.orderId, 'identity_selected', 'boolean', data.identitySelected ? 'true' : 'false'),
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
      metafield(data.customerId, 'size_preference', 'single_line_text_field', data.sizePreference || ''),
      metafield(
        data.customerId,
        'identity_status',
        'single_line_text_field',
        data.identityClaimed ? 'claimed' : (data.identitySelected ? 'manual_review_required' : 'locked')
      ),
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

  if (!['reservation_full', 'final_payment'].includes(edition.state)) {
    return json({
      ok: false,
      error: 'edition_not_ready_for_final_payment',
      state: edition.state
    }, 409);
  }

  const allocatedReservationCount = await scalar(
    env,
    `SELECT COUNT(*) AS count
     FROM reservations
     WHERE edition_id = ?
       AND status IN ('active','final_payment_open','final_paid')`,
    editionId
  );

  if (allocatedReservationCount !== Number(edition.edition_size)) {
    return json({
      ok: false,
      error: 'reservation_allocation_incomplete',
      allocatedReservationCount,
      editionSize: Number(edition.edition_size)
    }, 409);
  }

  if (!edition.final_product_variant_id) {
    return json({ error: 'Final product variant is not configured for this edition' }, 409);
  }

  const allRows = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, email, shopify_customer_id, shopify_order_id, status,
            size_preference, final_variant_id, payment_deadline,
            final_draft_order_id, final_invoice_url
     FROM reservations
     WHERE edition_id = ?
       AND status IN ('active','final_payment_open','final_paid')
     ORDER BY created_at ASC`
  ).bind(editionId).all();

  const reservationRows = allRows.results || [];
  const activeRows = reservationRows.filter(function(row) {
    return row.status === 'active';
  });

  const missingVariantMappings = activeRows
    .filter(function(row) {
      return Boolean(row.size_preference) && !row.final_variant_id;
    })
    .map(function(row) {
      return {
        reservationId: row.id,
        sizePreference: row.size_preference
      };
    });

  if (missingVariantMappings.length) {
    return json({
      ok: false,
      error: 'final_variant_mapping_incomplete',
      missing: missingVariantMappings
    }, 409);
  }

  const existingDeadlineRow = reservationRows.find(function(row) {
    return row.status === 'final_payment_open' && row.payment_deadline;
  });
  const now = new Date();
  const deadline = existingDeadlineRow
    ? new Date(existingDeadlineRow.payment_deadline).toISOString()
    : new Date(now.getTime() + edition.payment_window_hours * 3600000).toISOString();

  const results = [];

  for (const row of activeRows) {
    try {
      const finalVariantId = row.final_variant_id || edition.final_product_variant_id;
      let draftOrderId = row.final_draft_order_id;
      let invoiceUrl = row.final_invoice_url;

      if (!draftOrderId) {
        const draft = await createFinalAcquisitionDraft(env, {
          edition,
          reservation: row,
          deadline,
          variantId: finalVariantId
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

  if (failed === 0) {
    await env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE editions SET state = 'final_payment', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(editionId).run();
  }

  return json({
    ok: failed === 0,
    editionId,
    opened,
    alreadyOpenOrPaid: reservationRows.length - activeRows.length,
    failed,
    deadline,
    results
  });
}

export function buildFinalAcquisitionDraftInput({ edition, reservation, deadline, variantId }) {
  if (!variantId) throw new Error('missing_final_variant_id');

  const currencyCode = edition.currency_code || 'USD';
  const reservationCredit = centsToMoney(edition.reservation_price_cents);

  const input = {
    email: reservation.email || undefined,
    lineItems: [{
      variantId,
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
    reserveInventoryUntil: deadline,
    customAttributes: [
      { key: 'PHAM Reservation ID', value: reservation.id },
      { key: 'PHAM Edition', value: edition.label },
      { key: 'PHAM Product', value: edition.product_code },
      { key: 'PHAM Size Preference', value: reservation.size_preference || '' },
      { key: 'PHAM Payment Deadline', value: deadline }
    ],
    note: `${edition.label} final acquisition. Reservation credit applied: ${reservationCredit} ${currencyCode}.`,
    tags: ['PHAM', edition.label, 'Final Acquisition', reservation.id]
  };

  if (reservation.shopify_customer_id) {
    input.purchasingEntity = {
      customerId: reservation.shopify_customer_id
    };
  }

  return input;
}

async function createFinalAcquisitionDraft(env, { edition, reservation, deadline, variantId }) {
  const mutation = `mutation CreateFinalAcquisitionDraft($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        totalLineItemsPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }`;

  const input = buildFinalAcquisitionDraftInput({
    edition,
    reservation,
    deadline,
    variantId
  });

  const result = await shopifyGraphQL(env, mutation, { input });
  const payload = result && result.data && result.data.draftOrderCreate;
  const errors = payload && payload.userErrors || [];

  if (errors.length) {
    throw new Error('Draft order creation failed: ' + JSON.stringify(errors));
  }
  if (!payload || !payload.draftOrder) {
    throw new Error('Draft order creation returned no draft order');
  }

  assertDraftOrderPricing(payload.draftOrder, {
    expectedLineItemsCents: Number(edition.final_price_cents),
    expectedDiscountCents: Number(edition.reservation_price_cents),
    currencyCode: edition.currency_code || 'USD'
  });

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
  const nowIso = new Date().toISOString();

  const expiredReservations = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, edition_id, shopify_customer_id, shopify_order_id, final_draft_order_id
     FROM reservations
     WHERE status = 'final_payment_open'
       AND payment_deadline IS NOT NULL
       AND payment_deadline <= ?`
  ).bind(nowIso).all();

  const releaseCounts = new Map();

  function recordReleasedSlot(editionId){
    releaseCounts.set(editionId, (releaseCounts.get(editionId) || 0) + 1);
  }

  for (const row of expiredReservations.results || []) {
    if (row.final_draft_order_id) {
      const closed = await deleteDraftOrder(env, row.final_draft_order_id);
      if (!closed.ok) {
        console.error('Reservation expiry deferred because draft order could not be closed', row.id, closed.error);
        continue;
      }
    }

    await releaseIdentityOnExpiry(env, row.edition_id, row.id);

    await env.PHAM_CAMPAIGN_DB.prepare(
      `UPDATE reservations
       SET status = 'expired',
           final_payment_status = 'expired',
           object_number = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(row.id).run();

    const fields = [
      metafield(row.shopify_order_id, 'final_payment_status', 'single_line_text_field', 'expired')
    ];
    if (row.shopify_customer_id) {
      fields.push(
        metafield(row.shopify_customer_id, 'current_reservation_status', 'single_line_text_field', 'expired'),
        metafield(row.shopify_customer_id, 'identity_status', 'single_line_text_field', 'released_on_expiry')
      );
    }
    await setMetafields(env, fields);
    recordReleasedSlot(row.edition_id);
  }

  const expiredStandby = await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id, edition_id, draft_order_id
     FROM standby
     WHERE status = 'promoted'
       AND offer_deadline IS NOT NULL
       AND offer_deadline <= ?`
  ).bind(nowIso).all();

  for (const row of expiredStandby.results || []) {
    if (row.draft_order_id) {
      const closed = await deleteDraftOrder(env, row.draft_order_id);
      if (!closed.ok) {
        console.error('Standby expiry deferred because draft order could not be closed', row.id, closed.error);
        continue;
      }
    }

    await env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE standby SET status = 'expired' WHERE id = ? AND status = 'promoted'"
    ).bind(row.id).run();

    recordReleasedSlot(row.edition_id);
  }

  for (const [editionId, count] of releaseCounts.entries()) {
    for (let i = 0; i < count; i++) {
      const promotion = await promoteNextStandby(env, editionId);
      if (!promotion || promotion.promoted === false) break;
    }
  }
}

async function releaseIdentityOnExpiry(env, editionId, reservationId) {
  const claim = await env.PHAM_CAMPAIGN_DB.prepare(
    "SELECT source, status FROM identity_claims WHERE reservation_id = ? AND status != 'revoked'"
  ).bind(reservationId).first();

  if (!claim) return { released: false };

  await adjustIdentityInventory(env, editionId, reservationId + '-release', 1);

  await env.PHAM_CAMPAIGN_DB.prepare(
    `UPDATE identity_claims
     SET status = 'revoked'
     WHERE reservation_id = ?`
  ).bind(reservationId).run();

  if (claim.source === 'paid') {
    console.warn('Paid Identity released after reservation expiry; financial review may be required', reservationId);
  }

  return { released: true, source: claim.source };
}

async function promoteNextStandby(env, editionId) {
  const edition = await env.PHAM_CAMPAIGN_DB.prepare(
    'SELECT * FROM editions WHERE id = ?'
  ).bind(editionId).first();
  if (!edition) return { ok: false, promoted: false, reason: 'edition_not_found' };

  const next = await env.PHAM_CAMPAIGN_DB.prepare(
    "SELECT * FROM standby WHERE edition_id = ? AND status = 'waiting' ORDER BY position ASC LIMIT 1"
  ).bind(editionId).first();

  if (!next) return { ok: true, promoted: false, reason: 'queue_empty' };

  const claim = await env.PHAM_CAMPAIGN_DB.prepare(
    "UPDATE standby SET status = 'promoting' WHERE id = ? AND status = 'waiting'"
  ).bind(next.id).run();

  if (!(claim.meta && claim.meta.changes)) {
    return { ok: false, promoted: false, reason: 'standby_state_changed' };
  }

  const promotedAt = new Date();
  const deadline = new Date(promotedAt.getTime() + edition.standby_window_hours * 3600000).toISOString();

  try {
    let draftOrderId = next.draft_order_id;
    let invoiceUrl = next.invoice_url;
    let finalVariantId = next.final_variant_id || '';

    if (!finalVariantId) {
      finalVariantId = await resolveFinalVariantBySize(
        env,
        edition,
        next.size_preference
      );

      await env.PHAM_CAMPAIGN_DB.prepare(
        'UPDATE standby SET final_variant_id = ? WHERE id = ? AND status = \'promoting\''
      ).bind(finalVariantId, next.id).run();
    }

    if (!draftOrderId) {
      const draft = await createStandbyAcquisitionDraft(env, {
        edition,
        standby: next,
        deadline,
        variantId: finalVariantId
      });
      draftOrderId = draft.id;
      invoiceUrl = draft.invoiceUrl;

      await env.PHAM_CAMPAIGN_DB.prepare(
        `UPDATE standby
         SET draft_order_id = ?, invoice_url = ?
         WHERE id = ? AND status = 'promoting'`
      ).bind(draftOrderId, invoiceUrl || null, next.id).run();
    }

    await sendStandbyAcquisitionInvoice(env, {
      draftOrderId,
      email: next.email,
      edition,
      standbyId: next.id,
      deadline
    });

    const update = await env.PHAM_CAMPAIGN_DB.prepare(
      `UPDATE standby
       SET status = 'promoted', promoted_at = ?, offer_deadline = ?
       WHERE id = ? AND status = 'promoting'`
    ).bind(promotedAt.toISOString(), deadline, next.id).run();

    if (!(update.meta && update.meta.changes)) {
      throw new Error('Standby state changed during promotion');
    }

    return {
      ok: true,
      promoted: true,
      standbyId: next.id,
      email: next.email,
      offerDeadline: deadline,
      priceCents: edition.final_price_cents,
      variantId: finalVariantId,
      draftOrderId,
      invoiceUrl
    };
  } catch (error) {
    await env.PHAM_CAMPAIGN_DB.prepare(
      "UPDATE standby SET status = 'waiting' WHERE id = ? AND status = 'promoting'"
    ).bind(next.id).run();

    console.error('Standby promotion failed', next.id, error);
    return {
      ok: false,
      promoted: false,
      reason: 'standby_promotion_failed',
      error: error.message || String(error)
    };
  }
}

export function selectFinalVariantBySize(variants, sizePreference, finalPriceCents) {
  const expectedSize = String(sizePreference || '').trim().toLowerCase();
  if (!expectedSize) throw new Error('size_preference_required');

  const matches = (variants || []).filter(function(variant) {
    const sizeOption = (variant && variant.selectedOptions || []).find(function(option) {
      return String(option && option.name || '').trim().toLowerCase() === 'size';
    });
    const actualSize = sizeOption
      ? String(sizeOption.value || '').trim().toLowerCase()
      : '';

    return (
      actualSize === expectedSize &&
      moneyToCents(variant && variant.price) === Number(finalPriceCents)
    );
  });

  if (!matches.length) throw new Error('final_variant_not_found_for_size');
  if (matches.length > 1) throw new Error('final_variant_ambiguous_for_size');
  return matches[0];
}

async function loadFinalProductVariants(env, edition) {
  if (!edition.final_product_variant_id) throw new Error('missing_final_variant_id');

  const result = await shopifyGraphQL(env, `query ResolveFinalProductVariants($id: ID!) {
    productVariant(id: $id) {
      id
      product {
        id
        status
        variants(first: 100) {
          nodes {
            id
            sku
            title
            price
            selectedOptions { name value }
          }
        }
      }
    }
  }`, { id: edition.final_product_variant_id });

  const rootVariant = result && result.data && result.data.productVariant;
  const product = rootVariant && rootVariant.product;
  if (!product || product.status !== 'ACTIVE') {
    throw new Error('final_product_not_active');
  }

  return product.variants && product.variants.nodes || [];
}

async function resolveFinalVariantBySize(env, edition, sizePreference) {
  const variants = await loadFinalProductVariants(env, edition);
  const selected = selectFinalVariantBySize(
    variants,
    sizePreference,
    edition.final_price_cents
  );
  return selected.id;
}

export function buildStandbyAcquisitionDraftInput({ edition, standby, deadline, variantId }) {
  if (!variantId) throw new Error('missing_final_variant_id');
  if (!standby || !standby.id) throw new Error('missing_standby_id');

  const input = {
    email: standby.email,
    lineItems: [{
      variantId,
      quantity: 1
    }],
    acceptAutomaticDiscounts: false,
    allowDiscountCodesInCheckout: false,
    reserveInventoryUntil: deadline,
    customAttributes: [
      { key: 'PHAM Standby ID', value: standby.id },
      { key: 'PHAM Edition', value: edition.label },
      { key: 'PHAM Product', value: edition.product_code },
      { key: 'PHAM Size Preference', value: standby.size_preference || '' },
      { key: 'PHAM Standby Deadline', value: deadline }
    ],
    note: `${edition.label} standby acquisition at the full object price. No Priority Reservation credit applies.`,
    tags: ['PHAM', edition.label, 'Standby Acquisition', standby.id]
  };

  if (standby.customer_id) {
    input.purchasingEntity = {
      customerId: standby.customer_id
    };
  }

  return input;
}

async function createStandbyAcquisitionDraft(env, { edition, standby, deadline, variantId }) {
  const mutation = `mutation CreateStandbyAcquisitionDraft($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        totalLineItemsPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }`;

  const input = buildStandbyAcquisitionDraftInput({
    edition,
    standby,
    deadline,
    variantId
  });

  const result = await shopifyGraphQL(env, mutation, { input });
  const payload = result && result.data && result.data.draftOrderCreate;
  const errors = payload && payload.userErrors || [];

  if (errors.length) throw new Error('Standby draft order creation failed: ' + JSON.stringify(errors));
  if (!payload || !payload.draftOrder) throw new Error('Standby draft order creation returned no draft order');

  assertDraftOrderPricing(payload.draftOrder, {
    expectedLineItemsCents: Number(edition.final_price_cents),
    expectedDiscountCents: 0,
    currencyCode: edition.currency_code || 'USD'
  });

  return payload.draftOrder;
}

async function sendStandbyAcquisitionInvoice(env, { draftOrderId, email, edition, standbyId, deadline }) {
  const mutation = `mutation SendStandbyAcquisitionInvoice($id: ID!, $email: EmailInput) {
    draftOrderInvoiceSend(id: $id, email: $email) {
      draftOrder { id name invoiceUrl email status }
      userErrors { field message }
    }
  }`;

  const result = await shopifyGraphQL(env, mutation, {
    id: draftOrderId,
    email: {
      to: email,
      subject: `${edition.product_code} · A standby object is available`,
      customMessage: [
        `A ${edition.label} allocation has become available.`,
        '',
        `Standby reference: ${standbyId}`,
        `Object price: ${centsToMoney(edition.final_price_cents)} ${edition.currency_code || 'USD'}`,
        `Payment deadline: ${deadline}`,
        '',
        'This standby offer does not include a Priority Reservation credit because no reservation amount was previously paid.'
      ].join('\n')
    }
  });

  const payload = result && result.data && result.data.draftOrderInvoiceSend;
  const errors = payload && payload.userErrors || [];
  if (errors.length) throw new Error('Standby invoice send failed: ' + JSON.stringify(errors));
  return payload && payload.draftOrder;
}

async function deleteDraftOrder(env, draftOrderId) {
  const mutation = `mutation DeleteExpiredDraftOrder($input: DraftOrderDeleteInput!) {
    draftOrderDelete(input: $input) {
      deletedId
      userErrors { field message }
    }
  }`;

  try {
    const result = await shopifyGraphQL(env, mutation, {
      input: { id: draftOrderId }
    });
    const payload = result && result.data && result.data.draftOrderDelete;
    const errors = payload && payload.userErrors || [];
    if (errors.length) return { ok: false, error: JSON.stringify(errors) };
    return { ok: Boolean(payload && payload.deletedId) };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

export function assertDraftOrderPricing(draftOrder, {
  expectedLineItemsCents,
  expectedDiscountCents,
  currencyCode = 'USD'
}) {
  const lineMoney = draftOrder && draftOrder.totalLineItemsPriceSet &&
    draftOrder.totalLineItemsPriceSet.shopMoney;
  const discountMoney = draftOrder && draftOrder.totalDiscountsSet &&
    draftOrder.totalDiscountsSet.shopMoney;

  if (!lineMoney) throw new Error('draft_order_line_total_missing');
  if (!discountMoney) throw new Error('draft_order_discount_total_missing');

  if (
    lineMoney.currencyCode !== currencyCode ||
    discountMoney.currencyCode !== currencyCode
  ) {
    throw new Error('draft_order_currency_mismatch');
  }

  const lineCents = moneyToCents(lineMoney.amount);
  const discountCents = moneyToCents(discountMoney.amount);

  if (lineCents !== Number(expectedLineItemsCents)) {
    throw new Error(
      'draft_order_line_total_mismatch:' + lineCents + ':' + expectedLineItemsCents
    );
  }
  if (discountCents !== Number(expectedDiscountCents)) {
    throw new Error(
      'draft_order_discount_mismatch:' + discountCents + ':' + expectedDiscountCents
    );
  }

  return true;
}

export function validatePriorityReservationOrder({ order, edition }) {
  if (!order || !edition) throw new Error('reservation_payment_validation_missing_input');
  if (String(order.financial_status || '').toLowerCase() !== 'paid') {
    throw new Error('reservation_order_not_paid');
  }

  const currencyCode = String(edition.currency_code || 'USD');
  if (String(order.currency || '') !== currencyCode) {
    throw new Error('reservation_currency_mismatch');
  }

  const collectorEmail = String(
    order.email || (order.customer && order.customer.email) || ''
  ).trim().toLowerCase();
  if (!collectorEmail) {
    throw new Error('reservation_email_missing');
  }

  const activeLines = (order.line_items || []).filter(function(line) {
    return Number(line && line.quantity || 0) > 0;
  });
  const allowedSkus = new Set([
    'PHAM-001-RES-E01',
    'PHAM-ID-E01',
    'PHAM-LOOKBOOK-E01'
  ]);

  if (!activeLines.length || activeLines.some(function(line) {
    return !allowedSkus.has(String(line && line.sku || ''));
  })) {
    throw new Error('unexpected_reservation_line_item');
  }

  const reservationLines = activeLines.filter(function(line) {
    return line.sku === 'PHAM-001-RES-E01';
  });
  const identityLines = activeLines.filter(function(line) {
    return line.sku === 'PHAM-ID-E01';
  });
  const lookbookLines = activeLines.filter(function(line) {
    return line.sku === 'PHAM-LOOKBOOK-E01';
  });

  if (reservationLines.length !== 1) throw new Error('invalid_reservation_line_count');
  if (lookbookLines.length !== 1) throw new Error('invalid_lookbook_line_count');
  if (identityLines.length > 1) throw new Error('invalid_identity_line_count');

  const reservationLine = reservationLines[0];
  const lookbookLine = lookbookLines[0];
  const identityLine = identityLines[0] || null;

  if (Number(reservationLine.quantity) !== 1) throw new Error('invalid_reservation_quantity');
  if (Number(lookbookLine.quantity) !== 1) throw new Error('invalid_lookbook_quantity');
  if (identityLine && Number(identityLine.quantity) !== 1) {
    throw new Error('invalid_identity_quantity');
  }

  if (moneyToCents(reservationLine.price) !== Number(edition.reservation_price_cents)) {
    throw new Error('reservation_price_mismatch');
  }
  if (moneyToCents(lookbookLine.price) !== 0) {
    throw new Error('lookbook_price_mismatch');
  }
  if (identityLine && moneyToCents(identityLine.price) !== 500) {
    throw new Error('identity_price_mismatch');
  }

  const totalDiscountCents = moneyToCents(
    order.current_total_discounts !== undefined
      ? order.current_total_discounts
      : order.total_discounts
  );
  if (totalDiscountCents !== 0) {
    throw new Error('reservation_discount_not_allowed');
  }

  const expectedSubtotalCents =
    Number(edition.reservation_price_cents) + (identityLine ? 500 : 0);
  if (
    order.current_subtotal_price !== undefined &&
    moneyToCents(order.current_subtotal_price) !== expectedSubtotalCents
  ) {
    throw new Error('reservation_subtotal_mismatch');
  }

  const editionLabel = propertyValue(reservationLine, '_PHAM Edition');
  const productCode = propertyValue(reservationLine, '_PHAM Product');
  const sizePreference = String(
    propertyValue(reservationLine, '_PHAM Size Preference') || ''
  ).trim().slice(0, 24);

  if (editionLabel !== String(edition.label || '')) {
    throw new Error('reservation_edition_mismatch');
  }
  if (productCode !== String(edition.product_code || '')) {
    throw new Error('reservation_product_mismatch');
  }
  if (!sizePreference) throw new Error('missing_size_preference');
  if (propertyValue(reservationLine, 'Reservation terms') !== 'Accepted') {
    throw new Error('reservation_terms_missing');
  }
  if (propertyValue(reservationLine, 'Digital lookbook delivery') !== 'Included') {
    throw new Error('lookbook_consent_missing');
  }

  return {
    ok: true,
    reservationLine,
    identityLine,
    lookbookLine,
    sizePreference,
    reservationPaidCents: Number(edition.reservation_price_cents),
    expectedSubtotalCents
  };
}

export function validateStandbyAcquisitionOrder({ order, standby, edition }) {
  if (!order || !standby || !edition) throw new Error('standby_payment_validation_missing_input');
  if (String(order.financial_status || '').toLowerCase() !== 'paid') {
    throw new Error('standby_order_not_paid');
  }
  if (standby.status !== 'promoted') throw new Error('standby_offer_not_active');

  const paidAtValue = order.processed_at || order.created_at || '';
  const paidAt = new Date(paidAtValue);
  if (!paidAtValue || Number.isNaN(paidAt.getTime())) {
    throw new Error('standby_payment_timestamp_missing');
  }
  if (
    standby.offer_deadline &&
    paidAt.getTime() > new Date(standby.offer_deadline).getTime()
  ) {
    throw new Error('standby_offer_expired');
  }

  const currencyCode = String(edition.currency_code || 'USD');
  if (String(order.currency || '') !== currencyCode) {
    throw new Error('standby_payment_currency_mismatch');
  }

  const expectedVariantId = standby.final_variant_id || edition.final_product_variant_id;
  if (!expectedVariantId) throw new Error('missing_final_variant_id');

  const activeLines = (order.line_items || []).filter(function(line) {
    return Number(line && line.quantity || 0) > 0;
  });
  if (activeLines.length !== 1) throw new Error('unexpected_standby_line_item_count');

  const line = activeLines[0];
  if (Number(line.quantity) !== 1) throw new Error('invalid_standby_quantity');

  const actualVariantId = line.variant_id ? toGid('ProductVariant', line.variant_id) : '';
  if (!actualVariantId || actualVariantId !== expectedVariantId) {
    throw new Error('standby_variant_mismatch');
  }

  if (moneyToCents(line.price) !== Number(edition.final_price_cents)) {
    throw new Error('standby_product_price_mismatch');
  }

  const totalDiscountCents = moneyToCents(
    order.current_total_discounts !== undefined
      ? order.current_total_discounts
      : order.total_discounts
  );
  if (totalDiscountCents !== 0) {
    throw new Error('standby_discount_not_allowed');
  }

  if (
    order.current_subtotal_price !== undefined &&
    moneyToCents(order.current_subtotal_price) !== Number(edition.final_price_cents)
  ) {
    throw new Error('standby_subtotal_mismatch');
  }

  const actualCustomerId = order.customer && order.customer.id
    ? toGid('Customer', order.customer.id)
    : '';
  if (standby.customer_id && actualCustomerId !== standby.customer_id) {
    throw new Error('standby_payment_customer_mismatch');
  }

  if (!standby.customer_id) {
    const orderEmail = String(
      order.email || (order.customer && order.customer.email) || ''
    ).trim().toLowerCase();
    if (!orderEmail || orderEmail !== String(standby.email || '').trim().toLowerCase()) {
      throw new Error('standby_payment_email_mismatch');
    }
  }

  return {
    ok: true,
    variantId: actualVariantId,
    paidAt: paidAt.toISOString()
  };
}

export function validateFinalAcquisitionOrder({ order, reservation, edition }) {
  if (!order || !reservation || !edition) throw new Error('final_payment_validation_missing_input');
  if (String(order.financial_status || '').toLowerCase() !== 'paid') {
    throw new Error('final_order_not_paid');
  }
  if (reservation.status !== 'final_payment_open') throw new Error('final_payment_not_open');

  const paidAtValue = order.processed_at || order.created_at || '';
  const paidAt = new Date(paidAtValue);
  if (!paidAtValue || Number.isNaN(paidAt.getTime())) throw new Error('final_payment_timestamp_missing');

  if (
    reservation.payment_deadline &&
    paidAt.getTime() > new Date(reservation.payment_deadline).getTime()
  ) {
    throw new Error('payment_window_expired');
  }

  const currencyCode = String(edition.currency_code || 'USD');
  if (String(order.currency || '') !== currencyCode) {
    throw new Error('final_payment_currency_mismatch');
  }

  const expectedVariantId = reservation.final_variant_id || edition.final_product_variant_id;
  if (!expectedVariantId) throw new Error('missing_final_variant_id');

  const activeLines = (order.line_items || []).filter(function(line) {
    return Number(line && line.quantity || 0) > 0;
  });
  if (activeLines.length !== 1) throw new Error('unexpected_final_line_item_count');

  const line = activeLines[0];
  if (Number(line.quantity) !== 1) throw new Error('invalid_final_quantity');

  const actualVariantId = line.variant_id ? toGid('ProductVariant', line.variant_id) : '';
  if (!actualVariantId || actualVariantId !== expectedVariantId) {
    throw new Error('final_variant_mismatch');
  }

  if (moneyToCents(line.price) !== Number(edition.final_price_cents)) {
    throw new Error('final_product_price_mismatch');
  }

  const totalDiscountCents = moneyToCents(
    order.current_total_discounts !== undefined
      ? order.current_total_discounts
      : order.total_discounts
  );
  if (totalDiscountCents !== Number(edition.reservation_price_cents)) {
    throw new Error('reservation_credit_mismatch');
  }

  const expectedCustomerId = reservation.shopify_customer_id || '';
  const actualCustomerId = order.customer && order.customer.id
    ? toGid('Customer', order.customer.id)
    : '';
  if (expectedCustomerId && actualCustomerId !== expectedCustomerId) {
    throw new Error('final_payment_customer_mismatch');
  }

  return {
    ok: true,
    variantId: actualVariantId,
    paidAt: paidAt.toISOString(),
    discountCents: totalDiscountCents
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

function isUniqueConstraintError(error) {
  const message = String(error && error.message || error || '');
  return message.includes('UNIQUE constraint failed') ||
    message.includes('SQLITE_CONSTRAINT_UNIQUE');
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

async function recordWebhook(env, id, topic, status = 'processed', detail = '') {
  await env.PHAM_CAMPAIGN_DB.prepare(
    'INSERT OR IGNORE INTO webhook_events (id, topic, status, detail) VALUES (?, ?, ?, ?)'
  ).bind(id, topic, status, detail || null).run();
}

export async function verifyShopifyWebhook(rawBody, provided, secret) {
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

function bytesToHex(bytes) {
  return Array.from(bytes, function(byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
