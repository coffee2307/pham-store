import { verifyAppProxyRequest } from '../shopify/app-proxy.js';

function jsonBody(body) {
  if (body == null || body === '') return {};
  if (typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  try {
    return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
  } catch {
    throw new Error('invalid_json');
  }
}

function requireCustomer(auth) {
  if (!auth.customerId) throw new Error('customer_login_required');
  return auth.customerId;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('invalid_email');
  }
  return email;
}

export async function handleCollectorProxyRequest({
  url,
  method,
  route,
  body,
  secret,
  engine,
  store,
  edition,
  nowSeconds,
}) {
  const auth = verifyAppProxyRequest(url, secret, { nowSeconds });
  if (!auth.ok) {
    return { status: 401, body: { ok: false, error: auth.reason } };
  }

  try {
    if (method === 'GET' && route === '/status') {
      const customerId = requireCustomer(auth);
      const reservation = await store.findReservationByCustomer(edition.id, customerId);
      if (!reservation) {
        return { status: 404, body: { ok: false, error: 'reservation_not_found' } };
      }

      const identity = await store.getIdentityPrivilege(reservation.id);
      const referralConversionCount = Array.from(store.referralConversions?.values?.() || [])
        .filter((item) => item.referrerReservationId === reservation.id && item.status !== 'revoked')
        .length;

      return {
        status: 200,
        body: {
          ok: true,
          edition: {
            id: edition.id,
            label: edition.label,
            productCode: edition.productCode,
          },
          reservation: {
            id: reservation.id,
            status: reservation.status,
            collectorReferralCode: reservation.collectorReferralCode,
            paymentDeadline: reservation.paymentDeadline || null,
            balanceDueCents: reservation.balanceDueCents ?? null,
          },
          identity: identity
            ? {
                status: identity.status,
                source: identity.source,
                preferredNumber: identity.preferredNumber ?? null,
              }
            : { status: 'locked', source: null, preferredNumber: null },
          referral: {
            verifiedCount: referralConversionCount,
            requiredCount: 1,
          },
        },
      };
    }

    if (method === 'POST' && route === '/identity/configure') {
      const customerId = requireCustomer(auth);
      const reservation = await store.findReservationByCustomer(edition.id, customerId);
      if (!reservation) throw new Error('reservation_not_found');

      const input = jsonBody(body);
      const configured = await engine.configureIdentity({
        editionId: edition.id,
        reservationId: reservation.id,
        alias: input.alias || '',
        inscription: input.inscription || '',
        preferredNumber: Number(input.preferredNumber),
        publicIdentity: Boolean(input.publicIdentity),
      });

      return {
        status: 200,
        body: {
          ok: true,
          identity: {
            status: configured.status,
            source: configured.source,
            alias: configured.alias || '',
            inscription: configured.inscription || '',
            preferredNumber: configured.preferredNumber,
            publicIdentity: Boolean(configured.publicIdentity),
          },
        },
      };
    }

    if (method === 'POST' && route === '/standby/join') {
      const input = jsonBody(body);
      const email = normalizeEmail(input.email);
      const customerKey = auth.customerId || `email:${email}`;

      const entry = await engine.joinStandby({
        editionId: edition.id,
        customerId: customerKey,
        email,
        country: String(input.country || '').trim().slice(0, 80),
        size: String(input.size || '').trim().slice(0, 20),
      });

      return {
        status: 200,
        body: {
          ok: true,
          standby: {
            status: entry.status,
            sequence: entry.sequence,
            joinedAt: entry.joinedAt,
          },
        },
      };
    }

    return { status: 404, body: { ok: false, error: 'route_not_found' } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'request_failed';
    const status = reason === 'customer_login_required' ? 401 :
      reason === 'reservation_not_found' ? 404 :
      ['identity_not_claimed','object_number_taken','object_number_out_of_range','standby_not_open','standby_already_joined'].includes(reason) ? 409 :
      ['invalid_json','invalid_email'].includes(reason) ? 400 :
      500;

    return { status, body: { ok: false, error: reason } };
  }
}
