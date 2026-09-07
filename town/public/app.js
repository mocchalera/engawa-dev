import { World } from './world.js';
import { parseRecovery } from './recovery.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=ms=>new Date(ms).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
const id=()=>crypto.randomUUID();
let snap=null, actor=null, selected='', tab='desk', source=null, generation=0, sessionTimer, toastTimer, world, listMode=false, connected=false, query='', searchResults=[], searchEpoch=0, panelSig='', placeSig='', audio=null, sound=false, toneTimer=null, lastBeat=-1, offlineTimer, modalOwn=null,ownModalBackup=null;
const drafts=new Map(),pending=new Map(),heard=new Set();
function toast(message){if($('#modal').open){let m=$('#modal-status');if(!m){m=document.createElement('p');m.id='modal-status';m.setAttribute('role','status');m.className='modal-hint';$('#modal-body').append(m);}m.textContent=message;}$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function reqHeaders(owner=actor){return {'Content-Type':'application/json','X-Engawa-Client':'town-ui',...(owner?{'X-Engawa-Actor':owner}:{})};}
async function request(method,path,input,owner=actor){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(path,{method,headers:reqHeaders(owner),body:input?JSON.stringify(input):undefined,signal:controller.signal,cache:'no-store'});let result;try{result=await response.json();}catch{throw Object.assign(new Error('ログインまたは接続を確認してください。'),{status:response.status});}
    if(!response.ok)throw Object.assign(new Error(result.message||result.error||'操作できませんでした。'),{status:response.status,code:result.error});return result;
  }finally{clearTimeout(timer);}
}
function path(room=selected,q=''){return `/api/town?room=${encodeURIComponent(room)}${q?`&q=${encodeURIComponent(q)}`:''}`;}
async function refresh(){const g=generation,owner=actor;const data=await request('GET',path());if(g===generation&&(!owner||owner===data.actor.id))apply(data);}
function apply(data){
  if(data.kind==='presence'){if(!snap||data.selected!==(selected||null))return;const all=new Map([...snap.buffer,...data.buffer].map(m=>[m.id,m]));data={...snap,...data,kind:undefined,buffer:[...all.values()].filter(m=>m.at+300000>data.now&&data.places.some(p=>p.id===m.roomId))};data.tasks=data.tasks.filter(t=>data.places.some(p=>p.id===t.roomId));data.memories=data.memories.filter(m=>data.places.some(p=>p.id===m.roomId));}
  if(actor&&data.actor.id!==actor){lock('ログインした人が変わりました。');return;}
  actor=data.actor.id;snap=data;searchResults=searchResults.filter(r=>data.places.some(p=>p.id===r.roomId));connected=true;clearTimeout(offlineTimer);$('#connection').textContent='つながっています';$('#demo-notice').hidden=!data.localDemo;
  clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>lock('ログインの有効期限が切れました。'),Math.max(0,Math.min(2147483647,data.expiresAt-Date.now())));
  world?.update(data);render();
  for(const m of data.buffer)if(!heard.has(m.id)){heard.add(m.id);if(sound&&m.note&&data.now-m.at<2500)note(m.note);}
  if(heard.size>3000){const alive=new Set(data.buffer.map(m=>m.id));for(const key of heard)if(!alive.has(key))heard.delete(key);}
}
function subscribe(){
  source?.close();const g=generation,expected=actor;source=new EventSource(`/api/town/events?room=${encodeURIComponent(selected)}&actor=${encodeURIComponent(actor)}`);
  source.onmessage=e=>{if(g!==generation)return;try{const data=JSON.parse(e.data);if(data.actor.id!==expected)return lock('本人確認が変わりました。');apply(data);}catch{lock('受信内容を確認できません。');}};
  source.addEventListener('revoked',()=>{if(g===generation)lock('参加権限を再確認してください。');});
  source.onerror=()=>{if(g!==generation)return;connected=false;$('#connection').textContent='再接続中';renderControls();clearTimeout(offlineTimer);offlineTimer=setTimeout(()=>{if(g===generation&&!connected)lock('接続を確認してください。');},6000);};
}
async function selectRoom(roomId,focus=true){
  if(!snap?.places.some(p=>p.id===roomId))return;
  drafts.set(`${actor}:${selected}`,$('#whisper').value);selected=roomId;generation++;source?.close();snap={...snap,selected:roomId,current:null,buffer:[],people:[]};world?.update(snap);panelSig='';render();
  $('#whisper').value=drafts.get(`${actor}:${selected}`)||'';
  try{await refresh();subscribe();if(focus)world?.focus(roomId);}catch(e){toast(e.message);if(e.status===401||e.status===404)lock(e.message);}
}
async function live(op,extra={}){if(!connected||!snap)throw new Error('接続を確認してください。');const result=await request('POST','/api/town',{op,roomId:selected,...extra});return result;}
function pendingView(){$('#pending-bar').hidden=!pending.size;}
async function save(op,extra={},roomId=selected){
  if(!connected||!snap)throw new Error('接続を確認してください。');const owner=actor;const scoped=['profile','forget'].includes(op)?'':roomId;
  const key=`${owner}:${scoped}`;if(pending.has(key))throw new Error('この場所の前の保存結果を先に確認してください。');
  let revision=snap.selected===scoped?snap.current?.revision:undefined;
  if(scoped&&revision===undefined){const data=await request('GET',path(scoped));if(actor!==owner)throw new Error('本人が変わりました。');revision=data.current.revision;}
  const input={op,requestId:id(),...(scoped?{roomId:scoped,revision}:{}),...extra};
  const record={owner,input};pending.set(key,record);pendingView();
  try{const result=await request('POST','/api/town',input,owner);if(pending.get(key)===record)pending.delete(key);pendingView();await refresh().catch(()=>{});return result;}
  catch(e){if(e.status&&e.status<500){if(pending.get(key)===record)pending.delete(key);pendingView();}if(e.status===401)lock(e.message);throw e;}
}
async function retryPending(){for(const [key,record]of [...pending]){try{if(record.owner!==actor)throw new Error('元の本人でログインしてください。');await request('POST','/api/town',record.input,record.owner);if(pending.get(key)===record)pending.delete(key);}catch(e){toast(`保存結果を確認できません: ${e.message}`);}}pendingView();await refresh().catch(()=>{});}
function formValues(){return Object.fromEntries([...new FormData($('#modal-body form'))].filter(([,v])=>typeof v==='string'));}
function exportOwn(){
  drafts.set(`${actor}:${selected}`,$('#whisper').value);const packet={format:'engawa-town-own-input/v1',origin:location.origin,actor,drafts:[...drafts].filter(([k])=>k.startsWith(actor+':')),pending:[...pending].filter(([,v])=>v.owner===actor),form:modalOwn?{kind:modalOwn.kind,roomId:modalOwn.roomId,values:formValues()}:ownModalBackup};
  const blob=new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='engawa-own-input.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('自分の入力を退避しました。暗号化されていないため、安全な場所で保管してください。');
}
async function importOwn(file){
  if(!file)return;try{if(!connected||!actor)throw new Error('先に元の本人でログインしてください。');if(file.size>1048576)throw new Error('退避ファイルが大きすぎます。');const data=parseRecovery(await file.text(),location.origin,actor,drafts,pending);if(!confirm(`自分の入力を復元します。未確認の保存 ${data.pending.size}件も追跡に戻しますが、送信・共有・確定はしません。元の操作を確認してから別途再送してください。`))return;drafts.clear();for(const e of data.drafts)drafts.set(...e);pending.clear();for(const e of data.pending)pending.set(...e);ownModalBackup=data.form;$('#whisper').value=drafts.get(`${actor}:${selected}`)||'';pendingView();toast('入力を復元しました。まだ送信していません。');if(data.form)modal(`<h2>退避していた入力</h2><p>元の場所: ${escape(data.form.roomId||'プロフィール')}。写真は選び直してください。必要な内容をコピーして、新しいフォームで確認してください。</p><pre class="record-text">${escape(JSON.stringify(data.form.values,null,2))}</pre>`);}catch(e){toast(e.message);}
}
function lock(message){
  generation++;source?.close();connected=false;clearTimeout(sessionTimer);clearTimeout(offlineTimer);$('#whisper').value&&(drafts.set(`${actor}:${selected}`,$('#whisper').value));
  if(modalOwn&&$('#modal-body form'))ownModalBackup={kind:modalOwn.kind,roomId:modalOwn.roomId,values:formValues()};closeModal();snap=null;searchResults=[];panelSig='';$('#place-caption').textContent='接続を再確認してください。';$('#panel-body').replaceChildren();$('#places').replaceChildren();$('#people-list').replaceChildren();world?.update({places:[],people:[],buffer:[],actor:{id:actor}});stopSound();$('#session-overlay').hidden=false;$('#session-overlay h2').textContent=message;$('#login-link').href=$('#demo-notice').hidden?'/':'/local/login';
}
function me(){return snap?.people.find(p=>p.id===actor);}
function currentPlace(){return snap?.places.find(p=>p.id===selected);}
function renderControls(){const here=me()?.roomId===selected;$('#join').textContent=here?'いったん離れる':me()?'ここへ移動':'この場所に入る';$('#join').disabled=!connected||!selected;$('#mode').disabled=!here||!connected;$('#mode').value=me()?.mode||'available';for(const b of $$('[data-gesture]'))b.disabled=!here||!connected;$('#whisper').disabled=!here||!connected||currentPlace()?.role==='viewer';$('#whisper-form button').disabled=$('#whisper').disabled;$('#board-shortcut').disabled=!connected||!selected||currentPlace()?.role==='viewer';}
function render(){
  if(!snap)return;$('#profile').textContent=`${snap.actor.name}${snap.actor.guest?' · GUEST':''}`;$('#place-caption').textContent=currentPlace()?.title||'場所を選んでください';renderControls();
  const signature=JSON.stringify([snap.places,snap.people.map(p=>[p.id,p.roomId]),selected]);
  if(signature!==placeSig){placeSig=signature;$('#places').innerHTML=snap.places.map(p=>`<button class="place-button${p.id===selected?' active':''}" data-place="${escape(p.id)}"><span>${escape(p.title)}</span><small>${snap.people.filter(q=>q.roomId===p.id).length}人</small></button>`).join('');}
  $('#people-list').innerHTML=snap.people.length?snap.people.map(p=>`<div class="person-row"><span class="person-token">${escape(p.name.slice(0,1))}</span><div>${escape(p.name)}${p.guest?' <small>GUEST</small>':''}<br><small>${escape(snap.places.find(r=>r.id===p.roomId)?.title)} · ${escape({available:'会話歓迎',knock:'ひと声どうぞ',focus:'集中中',away:'離席中'}[p.mode])}</small></div></div>`).join(''):'<p>まだ誰もいません。最初の「おはよう」をどうぞ。</p>';
  renderPanel();
}
function renderPanel(){
  if(!snap)return;const signature=JSON.stringify([tab,selected,snap.current,snap.tasks,snap.memories,searchResults,actor]);if(signature===panelSig)return;panelSig=signature;
  const info={desk:['YOUR DESK','今日のつづき'],board:['SHARED BOARD',currentPlace()?.title||'掲示板'],memory:['YOUR MEMORY','あとで、の引き出し'],space:['BRING A LITTLE','みんなでつくる場所'],search:['FIND YOUR CONTEXT','話のつづきを探す']}[tab];
  $('#panel-eyebrow').textContent=info[0];$('#panel-title').textContent=info[1];$('#panel-add').hidden=!['desk','board','space'].includes(tab)||!currentPlace()||currentPlace().role==='viewer';
  const tools=$('#panel-tools');if(tab==='search'){if(!$('#search-input')){tools.innerHTML='<input id="search-input" type="search" maxlength="100" placeholder="プロジェクト・言葉・タスク" aria-label="許可された場所の記録を検索">';$('#search-input').value=query;$('#search-input').oninput=e=>search(e.target.value);}}else tools.replaceChildren();
  const target=$('#panel-body');
  if(tab==='desk'){
    const mine=snap.tasks.filter(t=>t.assignee===actor),shared=snap.tasks.filter(t=>!t.assignee&&!t.done);
    const row=t=>`<div class="task${t.done?' done':''}"><button class="task-toggle" data-action="done" data-id="${escape(t.id)}" data-room="${escape(t.roomId)}" data-done="${!t.done}" aria-label="${escape(t.title)}を${t.done?'未完了':'完了'}にする">${t.done?'✓':''}</button><div class="task-main"><div class="task-title">${escape(t.title)}</div><div class="task-meta">${escape(t.roomTitle)}${t.project?` / ${escape(t.project)}`:''}${t.due?` · ${escape(t.due)}`:''}</div>${!t.assignee?`<button class="task-claim" data-action="claim" data-id="${escape(t.id)}" data-room="${escape(t.roomId)}">自分がやる</button>`:''}</div></div>`;
    target.innerHTML='<p class="hint">家もプロジェクトも越えて、自分の仕事をここに。移動しなくても大丈夫。</p><h3 class="section-title">自分のやること</h3>'+ (mine.filter(t=>!t.done).map(row).join('')||'<p class="empty">いま、持っているタスクはありません。</p>')+(shared.length?'<h3 class="section-title">誰かの手を待っていること</h3>'+shared.map(row).join(''):'')+(mine.some(t=>t.done)?'<h3 class="section-title">できたこと</h3>'+mine.filter(t=>t.done).map(row).join(''):'');
  }else if(tab==='board'){
    const posts=snap.current?.posts??[];const roots=posts.filter(p=>!p.parentId).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.at-a.at||(b.order||0)-(a.order||0));
    const row=(p,reply=false)=>`<article class="record${reply?' reply':''}">${p.pinned?'<div class="pin-label">大切な記録 · ピン留め</div>':''}<div class="record-meta"><span>${escape(p.name)}${p.source?` · ${escape(p.source.name)}の言葉を共有`:''}</span><time>${fmt(p.at)}</time></div><div class="record-text">${escape(p.text)}</div><div class="record-actions">${!p.deleted?`<button data-action="reply" data-id="${escape(p.id)}">返信</button>`:''}${p.author===actor||currentPlace()?.role==='owner'?`<button data-action="pin" data-id="${escape(p.id)}">${p.pinned?'ピンを外す':'ピン留め'}</button><button data-action="delete-post" data-id="${escape(p.id)}">削除</button>`:''}</div></article>`;
    target.innerHTML='<p class="hint">ここへの投稿は残ります。大切な話はピン留めして、流れない場所へ。</p>'+(roots.length?roots.map(p=>row(p)+posts.filter(r=>r.parentId===p.id).map(r=>row(r,true)).join('')).join(''):'<p class="empty">最初のメモを、掲示板に。</p>')+(snap.current?.totalPosts>150?'<p class="hint">直近の投稿とピン留め・関連スレッドを表示しています。それ以前の記録も削除されず、検索できます。</p>':'');
  }else if(tab==='memory'){
    target.innerHTML='<p class="hint">自分だけの記録です。共有するときは、元の場所の掲示板へ。録音はしていません。</p>'+(snap.memories.length?[...snap.memories].reverse().map(m=>`<article class="record"><span class="scope-label">自分だけ</span><div class="record-meta"><span>${escape(m.name)} · ${escape(snap.places.find(p=>p.id===m.roomId)?.title)}</span><time>${fmt(m.at)}</time></div><div class="record-text">${escape(m.text)}</div><div class="record-actions"><button data-action="share" data-id="${escape(m.id)}" data-room="${escape(m.roomId)}">元の場所に共有する</button><button data-action="forget" data-id="${escape(m.id)}">削除</button></div></article>`).join(''):'<p class="empty">「5分だけ巻き戻す」から、届いた言葉を自分用に残せます。</p>');
  }else if(tab==='space'){
    target.innerHTML='<p class="hint">写真を飾る。植物に水をやる。用事のない時間も、一緒に。</p><div class="ambience"><label for="ambience">この場所で共有する音</label><select id="ambience">'+[['auto','時間帯におまかせ'],['piano','小さな鍵盤'],['rain','雨の気配'],['quiet','静けさ']].map(([v,l])=>`<option value="${v}"${snap.current?.ambience===v?' selected':''}>${l}</option>`).join('')+'</select><small>音は各自がオンにしたときだけ再生されます。</small></div><h3 class="section-title">小さな楽器 · 近くの人へ</h3><div class="greetings">'+['C4','D4','E4','G4','A4'].map((n,i)=>`<button data-action="note" data-note="${n}">${['ド','レ','ミ','ソ','ラ'][i]}</button>`).join('')+'</div>'+(snap.current?.objects??[]).map(o=>`<article class="space-object">${o.image?`<img src="${escape(o.image)}" alt="${escape(o.label)}" loading="lazy">`:''}<h3>${o.kind==='plant'?'植物 · ':o.kind==='note'?'壁のメモ · ':''}${escape(o.label)}</h3><p>${escape(o.name)}が持ち寄りました${o.kind==='plant'?` · 育ち ${o.growth}/5`:''}</p>${o.kind==='plant'?`<button data-action="water" data-id="${escape(o.id)}">水をやる</button>`:''}${o.author===actor||currentPlace()?.role==='owner'?` <button data-action="delete-object" data-id="${escape(o.id)}">片づける</button>`:''}</article>`).join('')+'<h3 class="section-title">休憩の一局 · まるばつ</h3><p class="game-status">'+escape(snap.current?.game.winner?(snap.current.game.winner==='draw'?'引き分け。また一局。':`${snap.current.game.winner}の勝ち`):`${snap.current?.game.turn||'○'}の番 · 二人で遊べます`)+'</p><div class="game">'+(snap.current?.game.cells??Array(9).fill(null)).map((v,i)=>`<button data-action="play" data-cell="${i}" aria-label="${i+1}番のマス">${v||''}</button>`).join('')+'</div><button class="game-reset" data-action="reset-game">新しいゲーム</button>';
    $('#ambience').onchange=e=>save('ambience',{value:e.target.value}).catch(e=>toast(e.message));
  }else{
    target.innerHTML='<p class="hint">自分が入れる場所だけを横断します。つぶやきの一時バッファは検索に含みません。</p>'+(searchResults.length?searchResults.map(r=>`<article class="record"><span class="scope-label">${escape(r.roomTitle)} · ${r.kind==='task'?'タスク':'投稿'}</span><div class="record-text">${escape(r.text)}</div><div class="record-actions"><button data-action="open-result" data-room="${escape(r.roomId)}">この場所を開く</button></div></article>`).join(''):`<p class="empty">${query?'該当する記録はありません。':'覚えている言葉から、探してみましょう。'}</p>`);
  }
}
async function search(q){query=q;const e=++searchEpoch,g=generation;if(!q.trim()){searchResults=[];panelSig='';renderPanel();return;}await new Promise(r=>setTimeout(r,180));if(e!==searchEpoch)return;try{const data=await request('GET',path(selected,q));if(e===searchEpoch&&g===generation){searchResults=data.search;panelSig='';renderPanel();}}catch(err){toast(err.message);}}
function setTab(next){tab=next;for(const b of $$('[data-tab]'))b.classList.toggle('active',b.dataset.tab===tab);panelSig='';renderPanel();}
function modal(content,kind='',roomId=selected){$('#modal-body').innerHTML=content;modalOwn=kind?{kind,roomId}:null;$('#modal').showModal();}
function closeModal(){modalOwn=null;$('#modal').close();$('#modal-body').replaceChildren();}
function formModal(kind,parentId=null){
  if(!snap)return;const roomId=selected,title=escape(currentPlace()?.title),owner=actor;
  if(kind==='profile')modal(`<form class="modal-form"><h2>ここにいる、自分の姿。</h2><p>在席は勤怠ではありません。表示名と姿は、自分で選べます。</p><label>表示名<input name="name" maxlength="40" required value="${escape(snap.actor.name)}"></label><div class="form-row"><label>かたち<select name="avatar">${[['person','ちいさな人'],['cat','ねこ'],['rabbit','うさぎ'],['bird','とり']].map(([v,l])=>`<option value="${v}"${snap.actor.avatar===v?' selected':''}>${l}</option>`).join('')}</select></label><label>色<select name="color">${[['sage','セージ'],['coral','コーラル'],['blue','ブルー'],['gold','ゴールド'],['plum','プラム']].map(([v,l])=>`<option value="${v}"${snap.actor.color===v?' selected':''}>${l}</option>`).join('')}</select></label></div><div class="modal-actions"><button class="primary" type="submit">この姿にする</button></div></form>`,kind,'');
  else if(kind==='post')modal(`<form class="modal-form"><span class="scope-label">${title}に共有 · 記録に残ります</span><h2>${parentId?'話のつづき':'掲示板に残す'}</h2><label>本文<textarea name="text" maxlength="8000" required placeholder="途中のアイデアでも、ひとつの決定でも。"></textarea></label><div class="modal-actions"><button class="primary" type="submit">${parentId?'返信を残す':'投稿する'}</button></div></form>`,kind,roomId);
  else if(kind==='task')modal(`<form class="modal-form"><span class="scope-label">${title}のタスク</span><h2>つづきを、ひとつ。</h2><label>やること<input name="title" maxlength="200" required placeholder="何をしたら、一歩進む？"></label><label>プロジェクト<input name="project" maxlength="100" placeholder="任意"></label><label>期限<input name="due" type="date"></label><label class="check-label"><input name="mine" type="checkbox" checked>自分がやる</label><p>チェックを外すと、誰かの手を待つ共有タスクになります。</p><div class="modal-actions"><button class="primary" type="submit">机に置く</button></div></form>`,kind,roomId);
  else modal(`<form class="modal-form"><span class="scope-label">${title}へ持ち寄る</span><h2>この場所に、小さなものを。</h2><label>持ってくるもの<select name="kind"><option value="note">壁のメモ</option><option value="plant">育てる植物</option><option value="photo">写真</option></select></label><label>名前・ひとこと<input name="label" maxlength="120" required></label><label id="photo-label" hidden>写真<input type="file" name="image" accept="image/jpeg,image/png,image/webp"></label><p>写真は小さく縮小して保存します。位置情報などの元画像の付加情報は引き継ぎません。</p><div class="modal-actions"><button class="primary" type="submit">ここに置く</button></div></form>`,kind,roomId);
  const form=$('#modal-body form');let formVersion=0;form.addEventListener('input',()=>formVersion++);form.addEventListener('change',()=>formVersion++);if(kind==='object')form.elements.kind.onchange=()=>$('#photo-label').hidden=form.elements.kind.value!=='photo';
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;const sentVersion=formVersion;const values=Object.fromEntries(new FormData(form));try{
    if(actor!==owner)throw new Error('元の本人でログインしてください。');
    if(kind==='profile')await save('profile',values,'');
    else if(kind==='post')await save('post',{text:values.text,parentId},roomId);
    else if(kind==='task')await save('task',{title:values.title,project:values.project,due:values.due,mine:form.elements.mine.checked},roomId);
    else{let image;if(values.kind==='photo'){const file=form.elements.image.files[0];if(!file)throw new Error('写真を選んでください。');image=await resizePhoto(file);}await save('object',{kind:values.kind,label:values.label,...(image?{image}:{})},roomId);}
    if($('#modal-body form')===form&&formVersion===sentVersion){closeModal();toast(kind==='profile'?'自分の姿を変えました。':'保存しました。');}else{button.disabled=false;toast('送信した内容は保存しました。その後の入力は残しています。');}
  }catch(err){toast(err.message);button.disabled=false;}};
  form.querySelector('input,textarea,select')?.focus();
}
async function resizePhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12_000_000)throw new Error('12MB以下のJPEG・PNG・WebPを選んでください。');
  const bitmap=await createImageBitmap(file);const ratio=Math.min(1,480/Math.max(bitmap.width,bitmap.height)),c=document.createElement('canvas');c.width=Math.max(1,bitmap.width*ratio);c.height=Math.max(1,bitmap.height*ratio);c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();let quality=.8,result;do{result=c.toDataURL('image/jpeg',quality);quality-=.1;}while(result.length>48000&&quality>.2);if(result.length>48000)throw new Error('写真を小さくしてから、もう一度選んでください。');return result;
}
function rewind(){if(!snap)return;const messages=snap.buffer.filter(m=>m.roomId===selected);modal('<h2>さっきの言葉を、もう一度。</h2><p class="modal-hint">自分に届いた直近5分のテキストだけ。入室前の会話や、遠くで交わされた言葉は見えません。必要な言葉は自分用に保存できます。</p>'+(messages.length?[...messages].reverse().map(m=>`<article class="rewind-record"><small>${escape(m.name)} · ${fmt(m.at)}</small><p>${escape(m.text)}</p><button data-action="capture" data-id="${escape(m.id)}" data-room="${escape(m.roomId)}">自分用に残す</button></article>`).join(''):'<p class="empty">まだ届いたつぶやきはありません。</p>'));}
const notes={C4:261.63,D4:293.66,E4:329.63,G4:392,A4:440};
function tone(freq,duration=1.2,volume=.045){if(!audio||!sound)return;const t=audio.currentTime,osc=audio.createOscillator(),gain=audio.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(volume,t+.035);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);osc.connect(gain);gain.connect(audio.destination);osc.start(t);osc.stop(t+duration+.02);}
function note(key){tone(notes[key]||329.63,.9,.06);}
async function startSound(){audio??=new(window.AudioContext||window.webkitAudioContext)();await audio.resume();sound=true;$('#sound').textContent='音を切る';$('#sound').setAttribute('aria-pressed','true');lastBeat=-1;toneTimer=setInterval(()=>{if(!snap||me()?.roomId!==selected||document.hidden)return;const track=snap.current?.ambience??'auto';if(track==='quiet')return;const beat=Math.floor(Date.now()/1400);if(beat===lastBeat)return;lastBeat=beat;if(track==='rain'){const length=Math.floor(audio.sampleRate*.7),buffer=audio.createBuffer(1,length,audio.sampleRate),a=buffer.getChannelData(0);for(let i=0;i<length;i++)a[i]=(Math.random()*2-1)*.018;const src=audio.createBufferSource(),filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1100;src.buffer=buffer;src.connect(filter);filter.connect(audio.destination);src.start();}else{const melody=[261.63,329.63,392,493.88,440,392,329.63,293.66];tone(melody[((beat%8)+8)%8],1.6,.023);if(beat%4===0)tone(130.81,3,.019);}},160);}
function stopSound(){sound=false;clearInterval(toneTimer);audio?.suspend();$('#sound').textContent='音を入れる';$('#sound').setAttribute('aria-pressed','false');}
async function action(button){
  const a=button.dataset.action,key=button.dataset.id,roomId=button.dataset.room||selected;
  try{
    if(a==='done')await save('taskUpdate',{id:key,done:button.dataset.done==='true'},roomId);
    else if(a==='claim')await save('taskUpdate',{id:key,claim:true},roomId);
    else if(a==='reply')formModal('post',key);
    else if(a==='pin')await save('pin',{id:key});
    else if(a==='delete-post'){if(confirm('この投稿の本文を削除しますか？返信は残ります。'))await save('deletePost',{id:key});}
    else if(a==='capture'){await save('capture',{id:key},roomId);button.disabled=true;button.textContent='自分用に保存済み';toast('自分の「記憶」に残しました。まだ共有されていません。');}
    else if(a==='share'){const p=snap.places.find(p=>p.id===roomId);if(confirm(`「${p?.title}」に入れる人への共有記録になります。自分用の記憶を、この掲示板へ共有しますか？`)){await save('share',{id:key},roomId);toast('元の場所の掲示板へ共有しました。');}}
    else if(a==='forget'){if(confirm('自分用の記憶を削除しますか？既に共有した投稿は削除されません。'))await save('forget',{id:key},'');}
    else if(a==='water'){await save('water',{id:key});toast('水をあげました。ゆっくり育ちます。');}
    else if(a==='delete-object'){if(confirm('この持ち寄りを片づけますか？'))await save('deleteObject',{id:key});}
    else if(a==='play')await save('play',{cell:Number(button.dataset.cell)});
    else if(a==='reset-game'){if(confirm('新しい一局を始めますか？'))await save('resetGame');}
    else if(a==='open-result'){await selectRoom(roomId);setTab('board');}
    else if(a==='note'){await live('whisper',{text:`♪ ${button.textContent}`,note:button.dataset.note});}
  }catch(e){toast(e.message);}
}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.action)action(b);else if(b.dataset.place)selectRoom(b.dataset.place);else if(b.dataset.tab)setTab(b.dataset.tab);else if(b.dataset.gesture)live('gesture',{gesture:b.dataset.gesture}).catch(e=>toast(e.message));});
$('#join').onclick=async()=>{try{await live(me()?.roomId===selected?'leave':'join');await refresh();}catch(e){toast(e.message);}};
$('#mode').onchange=e=>live('mode',{mode:e.target.value}).catch(e=>toast(e.message));
$('#profile').onclick=()=>formModal('profile');$('#panel-add').onclick=()=>formModal(tab==='desk'?'task':tab==='board'?'post':'object');$('#board-shortcut').onclick=()=>formModal('post');
$('#rewind').onclick=rewind;$('#modal-close').onclick=closeModal;$('#modal').addEventListener('cancel',()=>{modalOwn=null;$('#modal-body').replaceChildren();});
$('#whisper').oninput=e=>drafts.set(`${actor}:${selected}`,e.target.value);
$('#whisper-form').onsubmit=async e=>{e.preventDefault();const input=$('#whisper'),content=input.value,roomId=selected,owner=actor;try{await live('whisper',{text:content,roomId});if(owner===actor&&selected===roomId&&input.value===content){input.value='';drafts.delete(`${owner}:${roomId}`);}}catch(err){toast(err.message);}};
$('#view-all').onclick=()=>world?.home();$('#list-toggle').onclick=()=>{listMode=!listMode;$('#list-view').hidden=!listMode;$('#world-wrap').hidden=listMode;$('#list-toggle').textContent=listMode?'3Dに戻る':'リスト表示';};
$('#sound').onclick=()=>sound?stopSound():startSound().catch(()=>toast('このブラウザでは音を開始できません。'));
$('#import-own').onclick=()=>$('#own-file').click();$('#own-file').onchange=e=>{importOwn(e.target.files[0]);e.target.value='';};
$('#retry-pending').onclick=retryPending;$('#export-own').onclick=exportOwn;$('#session-export').onclick=exportOwn;
$('#discard-pending').onclick=()=>{if(confirm('追跡だけを破棄します。サーバー側の保存が取り消されるわけではありません。記録を確認済みですか？')){pending.clear();pendingView();}};
$('#session-resume').onclick=async()=>{try{const data=await request('GET','/api/town');if(data.actor.id!==actor)throw new Error('入力を退避したうえで、元の本人でログインしてください。');$('#session-overlay').hidden=true;apply(data);selected=data.places.some(p=>p.id===selected)?selected:(data.places[0]?.id||'');await selectRoom(selected);}catch(e){toast(e.message);}};
window.addEventListener('beforeunload',e=>{if(pending.size||[...drafts.values()].some(Boolean)||modalOwn){e.preventDefault();e.returnValue='';}});
let lastMove=0;
window.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.target.tagName)||$('#modal').open||!me()||me().roomId!==selected)return;e.preventDefault();if(Date.now()-lastMove<120)return;lastMove=Date.now();const p=me(),dx={ArrowLeft:-.8,ArrowRight:.8}[e.key]||0,dz={ArrowUp:-.8,ArrowDown:.8}[e.key]||0;live('move',{x:Math.max(-8,Math.min(8,p.x+dx)),z:Math.max(-7,Math.min(7,p.z+dz))}).catch(e=>toast(e.message));});
setInterval(()=>{if(connected&&me())live('heartbeat',{roomId:me().roomId}).catch(()=>{});},10000);
function updateClock(){const d=new Date();$('#date').textContent=d.toLocaleDateString('ja-JP',{month:'long',day:'numeric',weekday:'short'});$('#clock').textContent=d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}updateClock();setInterval(updateClock,10000);
async function boot(){
  try{world=new World($('#world'),$('#world-labels'),async(roomId,x,z)=>{try{if(roomId!==selected)await selectRoom(roomId,false);if(me()?.roomId!==roomId)await live('join',{roomId});await live('move',{roomId,x,z});}catch(e){toast(e.message);}});$('#world').addEventListener('world-unavailable',()=>{listMode=true;$('#list-view').hidden=false;$('#world-wrap').hidden=true;toast('3Dを表示できないため、すべての機能を使えるリスト表示に切り替えました。');});}
  catch{listMode=true;$('#list-view').hidden=false;$('#world-wrap').hidden=true;}
  try{const data=await request('GET','/api/town',undefined,null);apply(data);selected=data.places.find(p=>/garden|commons|square/.test(p.id))?.id||data.places[0]?.id||'';if(selected)await selectRoom(selected,true);else{$('#panel-body').innerHTML='<p class="empty">まだ参加できる場所がありません。管理者による登録が必要です。</p>';toast('場所への参加権限を管理者に設定してもらってください。');}}
  catch(e){lock(e.message);}
}
boot();
