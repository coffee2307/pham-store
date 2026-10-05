import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function canonicalizeAppProxyParams(searchParams) {
  const grouped = new Map();

  for (const [key, value] of searchParams.entries()) {
    if (key === 'signature') continue;
    const values = grouped.get(key) || [];
    values.push(value);
    grouped.set(key, values);
  }

  return Array.from(grouped.entries())
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .sort()
    .join('');
}

export function verifyAppProxyRequest(urlLike, secret, {
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 300,
} = {}) {
  if (!secret) return { ok: false, reason: 'missing_secret' };

  const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike), 'https://placeholder.invalid');
  const protectedKeys = ['signature', 'shop', 'logged_in_customer_id', 'path_prefix', 'timestamp'];

  for (const key of protectedKeys) {
    if (url.searchParams.getAll(key).length > 1) {
      return { ok: false, reason: 'duplicate_security_parameter' };
    }
  }

  const signature = url.searchParams.get('signature') || '';
  if (!signature) return { ok: false, reason: 'missing_signature' };

  const canonical = canonicalizeAppProxyParams(url.searchParams);
  const calculated = createHmac('sha256', secret)
    .update(canonical)
    .digest('hex');

  if (!safeEqualHex(calculated, signature)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const timestampRaw = url.searchParams.get('timestamp');
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }

  if (Math.abs(nowSeconds - timestamp) > maxAgeSeconds) {
    return { ok: false, reason: 'stale_request' };
  }

  return {
    ok: true,
    shop: url.searchParams.get('shop') || '',
    customerId: url.searchParams.get('logged_in_customer_id') || '',
    pathPrefix: url.searchParams.get('path_prefix') || '',
    timestamp,
  };
}
