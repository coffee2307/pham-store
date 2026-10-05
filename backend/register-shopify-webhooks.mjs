const shop = process.env.SHOPIFY_SHOP_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_TOKEN;
const backend = (process.env.CAMPAIGN_BACKEND_URL || '').replace(/\/$/, '');

if (!shop || !token || !backend) {
  console.error('Missing SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN or CAMPAIGN_BACKEND_URL.');
  process.exit(1);
}

const endpoint = backend + '/webhooks/orders-paid';
const api = '2026-10';

async function graphql(query, variables) {
  const response = await fetch(`https://${shop}/admin/api/${api}/graphql.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-access-token': token
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(JSON.stringify(payload.errors || payload));
  }
  return payload.data;
}

const existingQuery = `query ExistingPhamWebhooks($uri: String!) {
  webhookSubscriptions(first: 20, topics: [ORDERS_PAID], uri: $uri) {
    nodes { id topic uri }
  }
}`;

const createMutation = `mutation CreatePhamWebhook(
  $topic: WebhookSubscriptionTopic!,
  $webhook: WebhookSubscriptionInput!
) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhook) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;

const existing = await graphql(existingQuery, { uri: endpoint });
const nodes = existing.webhookSubscriptions.nodes || [];

if (nodes.length) {
  console.log('PHAM ORDERS_PAID webhook already registered:', nodes[0].id, endpoint);
  process.exit(0);
}

const created = await graphql(createMutation, {
  topic: 'ORDERS_PAID',
  webhook: {
    uri: endpoint,
    format: 'JSON'
  }
});

const result = created.webhookSubscriptionCreate;
if (result.userErrors && result.userErrors.length) {
  console.error(result.userErrors);
  process.exit(1);
}

console.log('Registered PHAM ORDERS_PAID webhook:', result.webhookSubscription.id, endpoint);
