const shop = process.env.SHOPIFY_SHOP_DOMAIN;
const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
const backend = (process.env.CAMPAIGN_BACKEND_URL || '').replace(/\/$/, '');

if (!shop || !clientId || !clientSecret || !backend) {
  console.error('Missing SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET or CAMPAIGN_BACKEND_URL.');
  process.exit(1);
}

const api = '2026-10';

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'accept': 'application/json'
    },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(
      'Shopify client credentials exchange failed: ' +
      JSON.stringify(payload.errors || payload.error || payload)
    );
  }

  return payload.access_token;
}

const token = await getAccessToken();

const subscriptions = [
  {
    topic: 'ORDERS_PAID',
    uri: backend + '/webhooks/orders-paid'
  },
  {
    topic: 'FULFILLMENTS_CREATE',
    uri: backend + '/webhooks/fulfillments'
  },
  {
    topic: 'FULFILLMENTS_UPDATE',
    uri: backend + '/webhooks/fulfillments'
  }
];

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

const existingQuery = `query ExistingPhamWebhooks(
  $topics: [WebhookSubscriptionTopic!]!,
  $uri: String!
) {
  webhookSubscriptions(first: 20, topics: $topics, uri: $uri) {
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

for (const subscription of subscriptions) {
  const existing = await graphql(existingQuery, {
    topics: [subscription.topic],
    uri: subscription.uri
  });
  const nodes = existing.webhookSubscriptions.nodes || [];

  if (nodes.length) {
    console.log(
      'PHAM webhook already registered:',
      subscription.topic,
      nodes[0].id,
      subscription.uri
    );
    continue;
  }

  const created = await graphql(createMutation, {
    topic: subscription.topic,
    webhook: {
      uri: subscription.uri,
      format: 'JSON'
    }
  });

  const result = created.webhookSubscriptionCreate;
  if (result.userErrors && result.userErrors.length) {
    console.error(
      'Unable to register PHAM webhook',
      subscription.topic,
      result.userErrors
    );
    process.exit(1);
  }

  console.log(
    'Registered PHAM webhook:',
    result.webhookSubscription.topic,
    result.webhookSubscription.id,
    subscription.uri
  );
}
