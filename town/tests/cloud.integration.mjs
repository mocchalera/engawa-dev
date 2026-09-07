/** Real local workerd/SQLite, fake signed users/JWKS. Never a real-provider/cloud acceptance claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Response as MFResponse} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
const origin='https://town.example',issuer='https://town-test.cloudflareaccess.com',audience='town-test';
test('Town cloud adapter: actual JWT verification, SQLite, grants, rewind, revocation and restart',{timeout:60000},async t=>{
 const dir=await mkdtemp(`${tmpdir()}/engawa-town-`);let runtime;
 const keys=await generateKeyPair('RS256',{extractable:true}),jwk={...await exportJWK(keys.publicKey),kid:'town-test',alg:'RS256',use:'sig'};
 const tokens=Object.fromEntries(await Promise.all(['owner','writer','viewer','guest','member-only','outsider'].map(async subject=>[subject,await new SignJWT({type:'app',email:`${subject}@example.invalid`}).setProtectedHeader({alg:'RS256',kid:'town-test'}).setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime('10m').sign(keys.privateKey)])));
 await build({entryPoints:['town/worker.ts'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:`${dir}/worker.mjs`});
 const options={...convertV4MiniflareOptions({name:'engawa-town-test',modules:true,script:await readFile(`${dir}/worker.mjs`,'utf8'),compatibilityDate:'2026-09-05',durableObjects:{DIRECTORY:{className:'Directory',useSQLite:true},WORKBENCHES:{className:'Workbench',useSQLite:true},TOWN:{className:'TownRuntime',useSQLite:true}},bindings:{ACCESS_ISSUER:issuer,ACCESS_AUD:audience,ADMIN_SUBJECTS:'owner',GUEST_SUBJECTS:'guest'},serviceBindings:{ASSETS:async()=>new MFResponse('test asset')},outboundService:async request=>{assert.equal(request.url,`${issuer}/cdn-cgi/access/certs`);return MFResponse.json({keys:[jwk]});}}),resourcePersistencePath:`${dir}/state`};
 runtime=new Miniflare(options);
 const req=(path,who='owner',method='GET',input,extra={})=>runtime.dispatchFetch(origin+path,{method,headers:{'Cf-Access-Jwt-Assertion':tokens[who]??who,Origin:origin,'Content-Type':'application/json','X-Engawa-Client':'town-ui','X-Engawa-Actor':who,...extra},...(input===undefined?{}:{body:JSON.stringify(input)})});
 const policy={revision:0,members:{team:['owner','writer','viewer','member-only'],commons:['owner','guest'],other:['outsider']},benches:[{id:'home',tenantId:'team',title:'Fictional house',goal:'',grants:{owner:'owner',writer:'editor',viewer:'viewer'}},{id:'cafe',tenantId:'commons',title:'Fictional cafe',goal:'',grants:{owner:'owner',guest:'editor'}},{id:'other',tenantId:'other',title:'Other scope',goal:'',grants:{outsider:'owner'}}]};
 try{
  await t.test('assets/API require authentic identity; spoofing, foreign-origin writes and fixture routes fail',async()=>{
   assert.equal((await runtime.dispatchFetch(origin+'/')).status,401);
   assert.equal((await req('/api/town','not-a-token')).status,401);
   assert.equal((await req('/api/town','writer','GET',undefined,{'X-Engawa-Actor':'owner'})).status,401);
   assert.equal((await req('/api/policy','owner','PUT',policy,{Origin:'https://evil.example'})).status,403);
   assert.equal((await req('/local/session')).status,404);
   assert.equal((await req('/api/policy','writer')).status,403);
  });
  assert.equal((await req('/api/policy','owner','PUT',policy)).status,200);
  await t.test('explicit object grants, guest metadata and caller-supplied identity isolation',async()=>{
   assert.equal((await req('/api/town?room=home','member-only')).status,404);
   assert.equal((await req('/api/town?room=home','guest')).status,404);
   assert.equal((await req('/api/town?room=other')).status,404);
   const guest=await(await req('/api/town?room=cafe','guest','GET',undefined,{'X-Engawa-Town-Identity':JSON.stringify({id:'owner',expiresAt:Date.now()+99999})})).json();
   assert.equal(guest.actor.id,'guest');assert.equal(guest.actor.guest,true);assert.deepEqual(guest.places.map(p=>p.id),['cafe']);
  });
  const command={op:'post',roomId:'home',revision:0,requestId:'same-intent',text:'actual workerd durable post'};
  await t.test('revision/idempotency and actual SQLite persistence',async()=>{
   assert.equal((await req('/api/town','viewer','POST',command)).status,403);
   assert.equal((await req('/api/town','owner','POST',command)).status,200);
   assert.equal((await req('/api/town','owner','POST',command)).status,200);
   assert.equal((await req('/api/town','owner','POST',{...command,text:'collision'})).status,409);
   assert.equal((await req('/api/town','writer','POST',{...command,requestId:'stale'})).status,409);
   assert.equal((await(await req('/api/town?room=home')).json()).current.posts.length,1);
   assert.equal((await req('/api/town','owner','POST',null)).status,400);
  });
  await t.test('recipient-only rewind and private capture',async()=>{
   for(const who of ['owner','writer']){assert.equal((await req('/api/town',who,'POST',{op:'join',roomId:'home'})).status,200);await req('/api/town',who,'POST',{op:'move',roomId:'home',x:0,z:0});}
   const m=await(await req('/api/town','owner','POST',{op:'whisper',roomId:'home',text:'only people here'})).json();
   assert.equal((await req('/api/town','viewer','POST',{op:'capture',roomId:'home',requestId:'late-capture',id:m.id})).status,404);
   assert.equal((await req('/api/town','writer','POST',{op:'capture',roomId:'home',requestId:'private-capture',id:m.id})).status,200);
   assert.equal((await(await req('/api/town?room=home','writer')).json()).memories.length,1);
   assert.equal((await(await req('/api/town?room=home')).json()).memories.length,0);
  });
  await t.test('SSE reauthorizes and policy revocation disconnects before reporting success',async()=>{
   const stream=await req('/api/town/events?room=home&actor=writer','writer');assert.equal(stream.status,200);const reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/"actor"/);
   const next=structuredClone(policy);next.revision=1;delete next.benches[0].grants.writer;
   assert.equal((await req('/api/policy','owner','PUT',next)).status,200);
   assert.match(new TextDecoder().decode((await reader.read()).value),/revoked/);await reader.cancel();
   assert.equal((await req('/api/town?room=home','writer')).status,404);
   assert.equal((await(await req('/api/town','writer')).json()).memories.length,0);
  });
  await runtime.dispose();runtime=new Miniflare(options);
  await t.test('local workerd restart retains selected work but no presence/whisper history',async()=>{const snap=await(await req('/api/town?room=home')).json();assert.equal(snap.current.posts[0].text,command.text);assert.equal(snap.people.length,0);assert.equal(snap.buffer.length,0);});
 }finally{await runtime?.dispose();await rm(dir,{recursive:true,force:true});}
});
