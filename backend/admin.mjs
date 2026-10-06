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
        status
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
      fail('Provide --sizes=XS,S,M,L,XL.');
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
    await request('/internal/final-payment/open', {
      method:'POST',
      body:{editionId:editionArg()}
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
  node admin.mjs set-state --state=reservation_open --confirm [--edition=edition-01]
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=in_production --confirm
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=quality_control --confirm
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=packed --confirm
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=dispatched --carrier=DHL --tracking=... --tracking-url=https://... --confirm
  node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=delivered --confirm
  node admin.mjs mark-lookbook --reservation=PHAM-R-... --status=delivered
  node admin.mjs assign-variant --reservation=PHAM-R-... --variant=gid://shopify/ProductVariant/...
  node admin.mjs map-variants --confirm [--edition=edition-01]
  node admin.mjs set-size-options --sizes=XS,S,M,L,XL --confirm [--edition=edition-01]
  node admin.mjs open-final-payment [--edition=edition-01]
  node admin.mjs promote-standby [--edition=edition-01]
  node admin.mjs finalize-objects --confirm [--edition=edition-01]
  node admin.mjs allocate-tokens --confirm [--edition=edition-01]
`);
}
