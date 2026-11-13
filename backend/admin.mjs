import fs from 'node:fs';

const base = String(process.env.CAMPAIGN_BACKEND_URL || '').replace(/\/$/, '');
const key = process.env.INTERNAL_ADMIN_KEY || '';
const command = process.argv[2] || 'help';
const args = process.argv.slice(3);

function fail(message){
  console.error(message);
  process.exit(1);
}

function editionArg(){
  const value = args.find(x => x.startsWith('--edition='));
  return value ? value.slice('--edition='.length) : 'edition-01';
}

function hasFlag(name){
  return args.includes(name);
}

function valueArg(name){
  const prefix = name + '=';
  const found = args.find(x => x.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

if(command !== 'help' && !base){
  fail('CAMPAIGN_BACKEND_URL is required.');
}

async function request(path, options = {}){
  const headers = Object.assign(
    {'Accept':'application/json'},
    options.body ? {'Content-Type':'application/json'} : {},
    options.auth === false ? {} : {'Authorization':'Bearer ' + key}
  );

  if(options.auth !== false && !key){
    fail('INTERNAL_ADMIN_KEY is required.');
  }

  const response = await fetch(base + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if(!response.ok || payload.ok === false){
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(payload, null, 2));
}

switch(command){
  case 'health':
    await request('/health', {auth:false});
    break;

  case 'state':
    await request('/internal/state?edition=' + encodeURIComponent(editionArg()));
    break;

  case 'readiness':
    await request('/internal/readiness?edition=' + encodeURIComponent(editionArg()));
    break;

  case 'confirm-identity': {
    if(!hasFlag('--confirm')) fail('Refusing to allocate a card number without --confirm.');
    const file = valueArg('--file');
    if(!file) fail('Provide --file=<private JSON request from verified email/WhatsApp correspondence>.');
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if(!payload || !['email','whatsapp'].includes(payload.channel) || !payload.contactReference)
      fail('Verified channel and conversation reference required.');
    await request('/internal/identity/confirm', {
      method:'POST',
      body:{...payload,confirm:'CONFIRM_MANUAL_IDENTITY'}
    });
    break;
  }

  case 'operations':
    await request('/internal/operations?edition=' + encodeURIComponent(editionArg()));
    break;

  case 'refund-reviews':
    await request('/internal/refund-reviews?edition=' + encodeURIComponent(editionArg()));
    break;

  case 'notifications':
    await request('/internal/notifications');
    break;

  case 'dispatch-notifications':
    if(!hasFlag('--confirm'))fail('Notification dispatch needs --confirm and a verified email transport.');
    await request('/internal/notifications/dispatch',{
      method:'POST',body:{confirm:'DISPATCH_TRANSACTIONAL_NOTICES'}
    });
    break;

  case 'close-underfilled': {
    if(!hasFlag('--confirm'))fail('Explicit --confirm required before recording the edition decision.');
    const decision=valueArg('--decision');
    const approvalReference=valueArg('--reference');
    if(!['proceed_partial','refund_review'].includes(decision)||!approvalReference)
      fail('Provide --decision=proceed_partial|refund_review and --reference=<verified external approval record>.');
    await request('/internal/window/resolve',{
      method:'POST',body:{
        editionId:editionArg(),decision,approvalReference,
        productionApproved:hasFlag('--production-approved'),
        legalApproved:hasFlag('--legal-approved'),
        customerNoticeApproved:hasFlag('--customer-notice-approved'),
        confirm:'RESOLVE_UNDERFILLED_EDITION'
      }
    });
    break;
  }

  case 'attest-refund': {
    if(!hasFlag('--confirm')||!hasFlag('--refunded-in-shopify'))
      fail('Verify the completed Shopify refund and use --confirm --refunded-in-shopify.');
    const reservationId=valueArg('--reservation');
    const shopifyRefundReference=valueArg('--refund-reference');
    if(!reservationId||!shopifyRefundReference)
      fail('Provide --reservation=<PHAM reservation> --refund-reference=<actual Shopify refund ID>.');
    await request('/internal/refund-reviews/settle',{
      method:'POST',body:{
        reservationId,shopifyRefundReference,refundedInShopify:true,
        confirm:'ATTEST_SHOPIFY_REFUND_COMPLETED'
      }
    });
    break;
  }

  case 'personalizations':
    await request('/internal/personalizations?edition=' + encodeURIComponent(editionArg()));
    break;

  case 'reviews': {
    const rawLimit = Number(valueArg('--limit') || 50);
    const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
    await request('/internal/reviews?limit=' + encodeURIComponent(String(limit)));
    break;
  }

  case 'set-state': {
    if(!hasFlag('--confirm')){
      fail('Refusing to change campaign state without --confirm.');
    }
    const state = valueArg('--state');
    if(!state){
      fail('Provide --state=<state>.');
    }
    await request('/internal/state/set', {
      method:'POST',
      body:{
        editionId:editionArg(),
        state,
        confirm:'SET_CAMPAIGN_STATE'
      }
    });
    break;
  }

  case 'set-lifecycle': {
    if(!hasFlag('--confirm')){
      fail('Refusing to change object lifecycle without --confirm.');
    }
    const reservationId = valueArg('--reservation');
    const stage = valueArg('--stage');
    if(!reservationId) fail('Provide --reservation=<PHAM reservation ID>.');
    if(!stage) fail('Provide --stage=in_production|quality_control|packed|dispatched|delivered.');
    await request('/internal/lifecycle/set', {
      method:'POST',
      body:{
        reservationId,
        stage,
        carrier:valueArg('--carrier'),
        trackingNumber:valueArg('--tracking'),
        trackingUrl:valueArg('--tracking-url'),
        note:valueArg('--note'),
        confirm:'SET_OBJECT_LIFECYCLE'
      }
    });
    break;
  }

  case 'mark-lookbook': {
    const reservationId = valueArg('--reservation');
    const status = valueArg('--status');
    if(!reservationId){
      fail('Provide --reservation=<PHAM reservation ID>.');
    }
    if(!status){
      fail('Provide --status=pending|entitled|delivered|failed.');
    }
    await request('/internal/lookbook/status', {
      method:'POST',
      body:{
        reservationId,
        status,
        deliveryVerified:hasFlag('--delivery-verified'),
        deliveryReference:valueArg('--delivery-reference')
      }
    });
    break;
  }

  case 'assign-variant': {
    const reservationId = valueArg('--reservation');
    const variantId = valueArg('--variant');
    if(!reservationId){
      fail('Provide --reservation=<PHAM reservation ID>.');
    }
    if(!variantId){
      fail('Provide --variant=<Shopify ProductVariant GID>.');
    }
    await request('/internal/reservation/variant', {
      method:'POST',
      body:{
        reservationId,
        variantId
      }
    });
    break;
  }

  case 'map-variants':
    if(!hasFlag('--confirm')){
      fail('Refusing to remap reservation variants without --confirm.');
    }
    await request('/internal/reservations/map-variants', {
      method:'POST',
      body:{
        editionId:editionArg(),
        confirm:'MAP_RESERVATION_VARIANTS'
      }
    });
    break;

  case 'set-size-options': {
    if(!hasFlag('--confirm')){
      fail('Refusing to change edition size options without --confirm.');
    }
    const raw = valueArg('--sizes');
    if(!raw){
      fail('Provide --sizes=M,L,XL,XXL.');
    }
    const sizes = raw.split(',').map(value => value.trim()).filter(Boolean);
    await request('/internal/edition/size-options', {
      method:'POST',
      body:{
        editionId:editionArg(),
        sizes,
        confirm:'SET_SIZE_OPTIONS'
      }
    });
    break;
  }

  case 'open-final-payment':
    if(!hasFlag('--confirm'))fail('Final payment invites require --confirm and signoff checks.');
    await request('/internal/final-payment/open', {
      method:'POST',
      body:{editionId:editionArg(),confirm:'OPEN_FINAL_ACQUISITION'}
    });
    break;

  case 'promote-standby':
    await request('/internal/standby/promote', {
      method:'POST',
      body:{editionId:editionArg()}
    });
    break;

  case 'finalize-objects':
    if(!hasFlag('--confirm')){
      fail('Refusing to finalize object numbers without --confirm.');
    }
    await request('/internal/objects/finalize', {
      method:'POST',
      body:{editionId:editionArg()}
    });
    break;

  case 'allocate-tokens': {
    if(!hasFlag('--confirm')){
      fail('Refusing to allocate Founder’s Tokens without --confirm.');
    }
    await request('/internal/tokens/allocate', {
      method:'POST',
      body:{
        editionId:editionArg(),
        confirm:'ALLOCATE_FOUNDER_TOKENS'
      }
    });
    break;
  }

  case 'help':
  default:
    console.log(`
PHAM Campaign Operator CLI

Environment:
  CAMPAIGN_BACKEND_URL=https://<worker>
  INTERNAL_ADMIN_KEY=<secret>

Commands:
  node admin.mjs health
  node admin.mjs state [--edition=edition-01]
  node admin.mjs readiness [--edition=edition-01]
  node admin.mjs reviews [--limit=50]
  node admin.mjs operations [--edition=edition-01]   # private production ledger; never publish
  node admin.mjs notifications
  node admin.mjs dispatch-notifications --confirm
  node admin.mjs refund-reviews [--edition=edition-01]
  node admin.mjs close-underfilled --decision=proceed_partial --reference=... --production-approved --legal-approved --customer-notice-approved --confirm
  node admin.mjs close-underfilled --decision=refund_review --reference=... --confirm
  node admin.mjs attest-refund --reservation=... --refund-reference=<actual Shopify refund> --refunded-in-shopify --confirm
  node operator-console.mjs --output=<private/report.html>  # offline visual launch board
  node admin.mjs personalizations [--edition=edition-01]  # sensitive; operator only
  node admin.mjs confirm-identity --file=private-confirmed-request.json --confirm
  # Confirmation requires prior verified email/WhatsApp correspondence and eligible reservation
  node admin.mjs set-state --state=reservation_open --confirm [--edition=edition-01]
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=in_production --confirm
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=quality_control --confirm
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=packed --confirm
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=dispatched --carrier=DHL --tracking=... --tracking-url=https://... --confirm
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=delivered --confirm
  node admin.mjs mark-lookbook --reservation=PHAM-R-... --status=delivered --delivery-verified --delivery-reference=<actual delivery evidence>
  node admin.mjs assign-variant --reservation=PHAM-R-... --variant=gid://shopify/ProductVariant/...
  node admin.mjs map-variants --confirm [--edition=edition-01]
  node admin.mjs set-size-options --sizes=M,L,XL,XXL --confirm [--edition=edition-01]
  node admin.mjs open-final-payment --confirm [--edition=edition-01]
  node admin.mjs promote-standby [--edition=edition-01]
  node admin.mjs finalize-objects --confirm [--edition=edition-01]
  node admin.mjs allocate-tokens --confirm [--edition=edition-01]
`);
}
