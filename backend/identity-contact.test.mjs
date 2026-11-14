import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync('assets/pham-campaign.js','utf8');
const liquid = fs.readFileSync('sections/pham-identity-configurator.liquid','utf8');
const start = js.indexOf('function mountIdentity(root){');
const end = js.indexOf('function mountReferral(root){',start);
assert.ok(start > -1 && end > start);
const identitySource = js.slice(start,end);
// The browser script is intentionally isolated for UI unit tests without a network or Shopify.
const identityMount = new Function('qsa', identitySource + '\nreturn mountIdentity;')(
  (selector, root) => selector === '[data-pham-object-number]' ? root.numberButtons : []
);

function element(overrides = {}){
  const listeners = {};
  const attributes = {};
  const classes = new Set();
  return {
    value:'',checked:false,textContent:'',hidden:false,href:'#',tabIndex:0,disabled:false,
    dataset:{},listeners,attributes,
    classList:{
      add:(x)=>classes.add(x),
      remove:(x)=>classes.delete(x),
      toggle:(x,yes)=>{if(yes)classes.add(x);else classes.delete(x)},
      contains:(x)=>classes.has(x),
    },
    setAttribute(k,v){attributes[k]=v;},
    addEventListener(name,fn){listeners[name]=fn;},
    ...overrides
  };
}
function setup({eligible=true,whatsapp='84912345678'} = {}){
  const map = new Map();
  const input = (selector, props={})=>{const e=element(props);map.set(selector,e);return e;};
  const emailLink=input('[data-pham-identity-email-link]');
  const whatsappLink=input('[data-pham-identity-whatsapp-link]');
  const name=input('[data-pham-id-name]',{value:'Collector Name'});
  const inscription=input('[data-pham-id-inscription]',{value:'YOUR OWN LINE'});
  const notes=input('[data-pham-id-production-notes]',{value:'Space the letters evenly'});
  const review=input('[data-pham-identity-review]',{checked:true});
  input('input[data-pham-public-identity]',{checked:false});
  input('[data-pham-preview-name]');
  input('[data-pham-preview-inscription]');
  input('[data-pham-preview-number]');
  input('[data-pham-number-status]');
  input('[data-pham-inscription-count]');
  input('[data-pham-name-count]');
  input('[data-pham-notes-count]');
  input('[data-pham-id-number-input]');
  input('[data-pham-identity-result]');
  const buttons=[element({dataset:{phamObjectNumber:'7'}}),element({dataset:{phamObjectNumber:'8'}})];
  const root={
    dataset:{
      phamMounted:'false',submitEnabled:String(eligible),
      identityEmail:'contact@phamofficial.com',
      identityWhatsapp:whatsapp,
      identityReservation:'PHAM-R-EXAMPLE',
      identityEdition:'EDITION 01',
      editionSize:'50'
    },
    numberButtons:buttons,
    querySelector:(selector)=>map.get(selector)||null
  };
  identityMount(root);
  buttons[0].listeners.click();
  return {root, emailLink, whatsappLink, name, inscription, notes, review};
}
test('eligible collector gets prefilled email and official-number WhatsApp drafts, never automatic submission',()=>{
  const x=setup();
  x.emailLink.listeners.click({preventDefault(){throw new Error('should not block valid draft')}});
  assert.ok(x.emailLink.href.startsWith('mailto:contact@phamofficial.com?'));
  const query=x.emailLink.href.split('?')[1];
  const params=new URLSearchParams(query);
  const body=params.get('body');
  assert.match(body,/Preferred jacket number: 07 \/ 50/);
  assert.match(body,/Name to print: Collector Name/);
  assert.match(body,/Inscription: YOUR OWN LINE/);
  assert.match(body,/Special production request: Space the letters evenly/);
  assert.match(body,/Please confirm availability/);
  x.whatsappLink.listeners.click({preventDefault(){throw new Error('should not block valid chat')}});
  assert.ok(x.whatsappLink.href.startsWith('https://wa.me/84912345678?text='));
  assert.match(decodeURIComponent(x.whatsappLink.href.split('?text=')[1]), /Collector Name/);
  assert.ok(!identitySource.includes('proxyRequest('));
  assert.ok(!liquid.includes("{%- form 'contact'"));
});
test('ineligible collector cannot use contact handoff, and invalid WhatsApp number is hidden',()=>{
  const x=setup({eligible:false,whatsapp:'not-verified'});
  assert.equal(x.emailLink.attributes['aria-disabled'],'true');
  assert.equal(x.whatsappLink.hidden,true);
  let blocked=false;
  x.emailLink.listeners.click({preventDefault(){blocked=true;}});
  assert.equal(blocked,true);
});
