from playwright.sync_api import sync_playwright
from pathlib import Path
import re,json
root=Path(__file__).resolve().parents[1]
out=root/'test-artifacts'
out.mkdir(exist_ok=True)
html=(root/'public/index.html').read_text().replace('<link rel="stylesheet" href="/style.css">','<style>'+(root/'public/style.css').read_text()+'</style>')
html=re.sub(r'<script type="module" src="/app.js"></script>','',html)
core=(root/'core.mjs').read_text().replace('export ','')
world=(root/'public/world.js').read_text().replace('export class World','class World')
app=(root/'public/app.js').read_text().replace("import { World } from './world.js';",'').replace("import { parseRecovery } from './recovery.js';",'')
recovery=(root/'public/recovery.js').read_text().replace('export ', '')
mock=r'''
if(!crypto.randomUUID)crypto.randomUUID=()=>`mock-${Math.random().toString(36).slice(2)}`;
const model=new Town();
const demoPlaces=[{id:'atelier',tenantId:'studio',title:'アトリエの家',goal:'途中の仕事も、今日のひとことも。',role:'owner'},{id:'garden',tenantId:'commons',title:'みんなの広場',goal:'用事がなくても、ここに。',role:'owner'},{id:'cafe',tenantId:'commons',title:'喫茶 こもれび',goal:'ひと息ついて、話のつづき。',role:'editor'},{id:'library',tenantId:'studio',title:'静かな書斎',goal:'集中の場所',role:'owner'}];
const who=(key='aoi')=>({actor:{id:key,expiresAt:Date.now()+3600000,guest:key==='guest'},places:demoPlaces});
let seq=0;
const seed=(op,extra={},key='aoi')=>model.execute(who(key),{op,requestId:`seed-${++seq}`,roomId:'garden',revision:model.room(extra.roomId||'garden').revision,...extra});
seed('profile',{name:'あおい',avatar:'rabbit',color:'sage'});seed('profile',{name:'そら',avatar:'cat',color:'coral'},'sora');seed('profile',{name:'ゆう',avatar:'bird',color:'gold'},'guest');
seed('task',{roomId:'atelier',title:'ラフスケッチを、みんなに見せる',project:'朝の風景',mine:true});seed('task',{roomId:'cafe',title:'次の読書会の日を決める',project:'まちの時間',mine:true});seed('task',{title:'好きな一曲を持ち寄る',project:'場づくり',mine:false});seed('object',{kind:'plant',label:'みんなのオリーブ'});seed('object',{kind:'note',label:'途中のものを、途中のままで。'});seed('post',{text:'ここは仕事の前に「おはよう」がある場所。用事がなくても、立ち寄ってください。'});
for(const key of ['aoi','sora','guest'])model.live(who(key),{op:'join',roomId:'garden'});
model.live(who('aoi'),{op:'move',roomId:'garden',x:-1.4,z:2.8});model.live(who('sora'),{op:'move',roomId:'garden',x:1.5,z:1.3});model.live(who('guest'),{op:'move',roomId:'garden',x:4,z:2});
model.whisper(who('sora'),{roomId:'garden',text:'この音楽を聴きながら、少しだけ休憩しよう。'});
window.fetch=async(url,options={})=>{try{const u=new URL(url,'https://engawa.invalid'),ctx=who();if(options.method==='POST'){const input=JSON.parse(options.body);let result;if(['join','leave','move','mode','gesture','heartbeat'].includes(input.op)){model.live(ctx,input);result={ok:true};}else if(input.op==='whisper')result=model.whisper(ctx,input);else result=model.execute(ctx,input);return Response.json(result);}return Response.json({...model.read(ctx,u.searchParams.get('room')||'',u.searchParams.get('q')||''),localDemo:true});}catch(e){return Response.json({error:e.code,message:e.message},{status:e.status||500});}};
window.EventSource=class{constructor(url){this.url=url;this.listeners={};this.timer=setInterval(()=>{try{const u=new URL(this.url,'https://engawa.invalid');this.onmessage?.({data:JSON.stringify({...model.read(who(),u.searchParams.get('room')||''),localDemo:true})});}catch{}},500);}close(){clearInterval(this.timer);}addEventListener(type,fn){this.listeners[type]=fn;}};
'''
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':1500,'height':1000},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(6000)
 page.set_content(html,wait_until='domcontentloaded')
 page.add_script_tag(content=core+'\n'+world+'\n'+recovery+'\n'+mock+'\n'+app)
 page.wait_for_timeout(500);print('initial errors',errors);print('overlay',page.locator('#session-overlay').inner_text());page.wait_for_selector('#places button');page.wait_for_timeout(900)
 page.screenshot(path=str(out/'desktop.png'))
 page.locator('#rewind').click();page.wait_for_selector('.rewind-record');page.locator('.rewind-record button').click();page.wait_for_timeout(600);page.locator('#modal-close').click();page.locator('[data-tab="memory"]').click();page.wait_for_selector('#panel-body .record')
 page.locator('[data-tab="desk"]').click();page.locator('#panel-add').click();page.locator('[name="title"]').fill('ブラウザから作ったタスク');page.locator('#modal [type="submit"]').click();page.wait_for_timeout(500)
 page.locator('#panel-add').click();page.locator('[name="title"]').fill('送信した本文A')
 page.evaluate('''window.originalFetch=window.fetch;window.holdOnce=true;window.fetch=(url,options={})=>{if(holdOnce&&options.method==='POST'&&JSON.parse(options.body).op==='task'){holdOnce=false;return new Promise(resolve=>window.releaseSave=async()=>resolve(await originalFetch(url,options)));}return originalFetch(url,options);};''')
 page.locator('#modal [type="submit"]').click();page.wait_for_timeout(50);page.locator('[name="title"]').fill('送信中に書いた本文B');page.evaluate('releaseSave()');page.wait_for_timeout(500)
 preserved=page.locator('#modal').evaluate('(el)=>el.open') and page.locator('[name="title"]').input_value()=='送信中に書いた本文B';assert preserved;page.locator('#modal-close').click()
 page.locator('#profile').click();page.locator('[name="name"]').fill('あおい');page.locator('[name="avatar"]').select_option('rabbit');page.locator('#modal [type="submit"]').click();page.wait_for_timeout(300)
 page.locator('[data-tab="space"]').click();page.screenshot(path=str(out/'space.png'))
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(500);page.screenshot(path=str(out/'mobile.png'),full_page=True)
 result={'mode':'offline Chromium DOM + software 3D; actual app/core, mocked fetch/SSE; not browser-network or cloud E2E','newer_form_input_preserved_after_ack':preserved,'page_errors':errors,'mobile_overflow':page.evaluate('document.body.scrollWidth > innerWidth'),'dom_tasks':page.evaluate('model.room("garden").tasks.length'),'private_memories':page.evaluate('model.read(who(),"garden").memories.length'),'webgl':page.locator('#world').evaluate('(el)=>!!el.getContext("webgl")')}
 page.locator('#rewind').click();page.wait_for_timeout(50);page.evaluate("lock('test revocation')");result['revocation_closes_dialog']=page.locator('#modal').evaluate('(el)=>!el.open && el.querySelector(\"#modal-body\").childElementCount===0');result['revocation_clears_work']=page.locator('#panel-body').inner_text()=='';assert result['revocation_closes_dialog'];assert result['revocation_clears_work'];assert not errors;assert not result['mobile_overflow'];print(json.dumps(result,ensure_ascii=False));(out/'browser-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
 b.close()
