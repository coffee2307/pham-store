import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

test('private launch console fails closed without HTTPS worker credentials',()=>{
  const target=path.join(process.cwd(),'PRIVATE-OPERATOR-REPORT-TEST.html');
  const env={...process.env,CAMPAIGN_BACKEND_URL:'',INTERNAL_ADMIN_KEY:''};
  const r=spawnSync(process.execPath,['backend/operator-console.mjs','--output='+target],{
    cwd:process.cwd(),env,encoding:'utf8',timeout:4000
  });
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/CAMPAIGN_BACKEND_URL must be HTTPS/);
  assert.equal(fs.existsSync(target),false);
});
test('private launch console rejects output paths inside repository',()=>{
  const target=path.join(process.cwd(),'PRIVATE-OPERATOR-REPORT-TEST.html');
  const env={...process.env,CAMPAIGN_BACKEND_URL:'https://example.invalid',INTERNAL_ADMIN_KEY:'dummy'};
  const r=spawnSync(process.execPath,['backend/operator-console.mjs','--output='+target],{
    cwd:process.cwd(),env,encoding:'utf8',timeout:4000
  });
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/must be saved outside the source repository/);
  assert.equal(fs.existsSync(target),false);
});
