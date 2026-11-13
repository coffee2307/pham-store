/**
 * PHAM private, read-only launch control + 50-object production board.
 * The generated HTML contains private collector personalization metadata;
 * keep it on the authorized computer only and never upload to public hosting.
 *
 * CAMPAIGN_BACKEND_URL=https://worker.example INTERNAL_ADMIN_KEY=...
 * node backend/operator-console.mjs --output=F:/private/PHAM-Edition-01-Board.html
 */
import fs from 'node:fs';
import path from 'node:path';

const base=String(process.env.CAMPAIGN_BACKEND_URL||'').replace(/\/$/,'');
const key=process.env.INTERNAL_ADMIN_KEY||'';
const arg=process.argv.find(x=>x.startsWith('--output='))||'';
const output=arg.slice('--output='.length);
if(!base.startsWith('https://')||!key){
  console.error('CAMPAIGN_BACKEND_URL must be HTTPS and INTERNAL_ADMIN_KEY is required.');
  process.exit(1);
}
if(!output.endsWith('.html') && !output.endsWith('.htm')){
  console.error('Provide --output=<private path ending in .html>. Never write this report into public theme files.');
  process.exit(1);
}
const full=path.resolve(output);
if(fs.existsSync(full))throw new Error('Refusing to overwrite existing private report. Choose a new filename.');

async function read(endpoint){
  const response=await fetch(base+endpoint,{
    headers:{'Authorization':'Bearer '+key,'Accept':'application/json'},
    signal:AbortSignal.timeout(18000),
  });
  const payload=await response.json().catch(()=>null);
  // Readiness uses HTTP 503 to signal blockers; keep details visible without bypassing them.
  if(!payload||response.status===401||response.status===403||
     (response.status!==503&&!response.ok)){
    throw new Error('Operator request failed: '+endpoint+' (HTTP '+response.status+')');
  }
  return payload;
}
const [state,readiness,ops]=await Promise.all([
  read('/internal/state?edition=edition-01'),
  read('/internal/readiness?edition=edition-01'),
  read('/internal/operations?edition=edition-01')
]);
if(!state.edition||!ops.ok||ops.privateOperatorData!==true||
   !Array.isArray(ops.slots)||ops.slots.length!==50||!Array.isArray(ops.reservations)){
  throw new Error('Edition report failed integrity verification. Nothing exported.');
}
const esc=(x)=>String(x==null?'—':x).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtNum=n=>String(n).padStart(2,'0');
const cell=(x)=>'<td>'+esc(x)+'</td>';
const readinessChecks=Array.isArray(readiness.checks)?readiness.checks:[];
const readyChecks=readinessChecks.filter(x=>x.ok===true);
const blockedChecks=readinessChecks.filter(x=>!x.ok);
const stateMatches=state.edition.state===ops.state;
const isSafeClosed=!['reservation_open','final_payment_open'].includes(state.edition.state);
const issues=[
  ...(!stateMatches?['Campaign state mismatch between internal state and production ledger']:[]),
  ...(!isSafeClosed?['Campaign is not in PRELAUNCH. Check authorization and revenue exposure immediately.']:[]),
  ...blockedChecks.map(x=>x.name+' failed'),
  ...(ops.counts.reserved>50?['Overcapacity detected']:[])
];
const stageNames=['not_started','production_queued','in_production','quality_control','packed','dispatched','delivered','archived'];
const columns=['No.','Assignment','Reservation','Size','Progress','Card'];
const slotRows=ops.slots.map(row=>'<tr>'+
  [fmtNum(row.number),row.state,row.reservationId,row.size,row.lifecycleStage,row.cardStatus].map(cell).join('')+
  '</tr>').join('\n');
const privateRows=ops.reservations.map(r=>'<tr>'+
  [r.reservationId,r.objectNumber?fmtNum(r.objectNumber):'Pending',r.size,
   r.reservationStatus,r.lifecycleStage,r.cardStatus,r.printedName,r.inscription,
   r.specialInstructions,r.trackingNumber].map(cell).join('')+
  '</tr>').join('\n');
const badge=(value)=>'<span class="status">'+esc(value)+'</span>';
const cards=[
  ['Active reservations',ops.counts.reserved+'/50'],
  ['Acquired',ops.counts.acquired+'/50'],
  ['Delivered',ops.counts.delivered+'/50'],
  ['Numbers awaiting assignment',ops.counts.awaitingObjectNumber],
  ['Card instructions confirmed',ops.counts.identityConfigured],
  ['Missing size',ops.concerns.missingSize],
  ['Identity needs manual review',ops.concerns.unverifiedIdentity],
  ['Pending final payment',ops.concerns.finalPaymentPending]
];
const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>PHAM · Edition 01 Operator Console (PRIVATE)</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#ededeb;line-height:1.45}
main{width:min(1440px,calc(100% - 40px));margin:52px auto 90px}
header{border-bottom:1px solid #353535;padding-bottom:32px;margin-bottom:26px}
h1{font-weight:550;font-size:clamp(34px,6vw,64px);letter-spacing:-.05em;margin:12px 0}
h2{font-weight:550;font-size:21px;letter-spacing:-.01em;margin:36px 0 12px}
small,.dim{color:#aaa}p{max-width:85ch}
.meta{font:500 12px/1.6 ui-monospace,monospace;color:#bdbdbb;letter-spacing:.08em}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.metric{border:1px solid #3b3b3b;padding:18px;min-height:110px}
.metric label{display:block;font-size:12px;color:#aaa}.metric strong{display:block;margin-top:16px;font-size:26px;font-weight:600}
section{margin:32px 0}.warning{padding:18px 22px;border:1px solid #555;background:#171717}
.warning ul{margin:8px 0 0;padding-left:20px}
.table-wrap{max-width:100%;overflow:auto;border:1px solid #414141}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:#aaa;font-weight:550;white-space:nowrap}
td,th{padding:12px 14px;border-bottom:1px solid #303030;vertical-align:top}
tr:last-child td{border-bottom:0}tr:nth-child(even){background:#151515}
td{overflow-wrap:anywhere;min-width:80px}thead{background:#1c1c1c}
.status{font-size:11px;color:#ddd;border:1px solid #555;padding:4px 9px}
footer{margin-top:48px;border-top:1px solid #444;padding-top:22px;color:#aaa;font-size:12px}
@media(max-width:820px){main{width:calc(100% - 24px);margin-top:26px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media print{body{background:#fff;color:#111}.dim,.meta,.metric label{color:#333}.warning,.metric,.table-wrap{border-color:#666}}
</style></head><body><main>
<header><div class="meta">PHAM / INTERNAL ONLY / EDITION 01 / NO PUBLIC DISTRIBUTION</div>
<h1>Launch control. Production ledger.</h1>
<p>Read-only snapshot generated at ${esc(new Date().toISOString())}. This is a private operational report, not a payment gateway or authorization to sell. Backend: ${esc(base.replace(/^https:\/\//,'').split('/')[0])}.</p>
<p><b>Edition state:</b> ${badge(state.edition.state)} &nbsp; <b>Worker checks:</b> ${badge(readyChecks.length+' passed / '+blockedChecks.length+' blocked')} &nbsp; <b>Release:</b> ${badge(issues.length?'BLOCKED / REVIEW':'AWAITING EXTERNAL APPROVALS')}</p>
</header>
<div class="metrics">${cards.map(([label,n])=>'<div class="metric"><label>'+esc(label)+'</label><strong>'+esc(n)+'</strong></div>').join('')}</div>
<section class="warning"><h2>Release safety</h2>
<p>Even when all automated checks pass, real payment, approved product sample, legal seller, lookbook delivery and fulfilment must be independently signed off. Do not mark these completed without evidence.</p>
${issues.length?'<ul>'+issues.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<p>No failed runtime readiness checks were returned. External commercial signoffs remain mandatory.</p>'}
</section>
<section><h2>50 numbered objects</h2><p class="dim">Unassigned means not yet mapped to a specific object, not necessarily available for purchase.</p>
<div class="table-wrap"><table><thead><tr>${columns.map(x=>'<th>'+esc(x)+'</th>').join('')}</tr></thead>
<tbody>${slotRows}</tbody></table></div></section>
<section><h2>Active reservations — private production handoff</h2>
<p class="dim">Sensitive: names and inscriptions appear only after manual correspondence has been verified.</p>
<div class="table-wrap"><table><thead><tr>
${['Reservation','No.','Size','Payment','Lifecycle','Card status','Print name','Inscription','Print notes','Tracking'].map(x=>'<th>'+esc(x)+'</th>').join('')}
</tr></thead><tbody>${privateRows}</tbody></table></div></section>
<section><h2>Lifecycle summary</h2><div class="table-wrap"><table><thead><tr><th>Stage</th><th>Objects</th></tr></thead><tbody>
${stageNames.map(stage=>'<tr><td>'+esc(stage)+'</td><td>'+esc(ops.stageCounts[stage]||0)+'</td></tr>').join('')}
</tbody></table></div></section>
<footer>No dynamic scripts, remote images or network fetches are embedded. Generated with operator credentials on an authorized device. Never send this file to customers, public web hosting or GitHub.</footer>
</main></body></html>`;
fs.writeFileSync(full,html,{encoding:'utf8',flag:'wx',mode:0o600});
console.log('PRIVATE PHAM CONTROL BOARD: '+full);
console.log('Edition '+state.edition.state+' / '+ops.counts.reserved+' active reservations / '+ops.counts.acquired+' acquired / '+blockedChecks.length+' backend blockers.');
if(issues.length)console.log('RELEASE BLOCKERS: '+issues.join('; '));
