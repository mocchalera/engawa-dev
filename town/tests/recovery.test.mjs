import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecovery} from '../public/recovery.js';
const packet=()=>({format:'engawa-town-own-input/v1',origin:'https://town.example',actor:'alice',drafts:[['alice:room','my draft']],pending:[['alice:room',{owner:'alice',input:{op:'post',requestId:'same-request',roomId:'room',revision:2,text:'original body'}}]],form:null});
const parse=p=>parseRecovery(JSON.stringify(p),'https://town.example','alice');
test('recovery restores only own input and exact pending intent without any request',()=>{const p=packet(),data=parse(p);assert.equal(data.drafts.get('alice:room'),'my draft');assert.deepEqual(data.pending.get('alice:room').input,p.pending[0][1].input);});
test('recovery rejects other sites, authors, oversized files and fetched snapshots',()=>{for(const extra of [{origin:'https://other.example'},{actor:'bob'},{current:{secret:1}},{pending:[['alice:room',{owner:'bob',input:{op:'post',requestId:'r'}}]]}])assert.throws(()=>parse({...packet(),...extra}));assert.throws(()=>parseRecovery('x'.repeat(1048577),'https://town.example','alice'));});
test('recovery never overwrites newer draft or different pending request',()=>{assert.throws(()=>parseRecovery(JSON.stringify(packet()),'https://town.example','alice',new Map([['alice:room','newer']])));assert.throws(()=>parseRecovery(JSON.stringify(packet()),'https://town.example','alice',new Map(),new Map([['alice:room',{owner:'alice',input:{op:'post',requestId:'different'}}]])));});
test('recovery rejects unknown commands and non-text form data',()=>{const p=packet();p.pending[0][1].input.op='policy';assert.throws(()=>parse(p));assert.throws(()=>parse({...packet(),form:{kind:'post',roomId:'room',values:{text:{html:'unsafe'}}}}));});
