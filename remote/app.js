const $ = (id) => document.getElementById(id);
const labels = { hypothesis: '仮説', decision: '決定', constraint: '制約', question: '未解決の問い', task: '次の作業' };
const modes = { available: '会話歓迎', knock: 'ノックしてね', focus: '集中中', away: '離席中' };
let actor, board, socket, selection = 0, pendingSave = null;
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const notify = (message) => { $('toast').textContent = message; $('toast').hidden = false; };

async function api(path, method = 'GET', data, requestId) {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Engawa-Client': 'remote-ui', ...(requestId ? { 'Idempotency-Key': requestId } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  let value;
  try { value = await response.json(); } catch { throw new Error('認証または通信を確認できません。再読み込みしてください。'); }
  if (!response.ok) { const error = new Error(value.message ?? '操作できません。'); error.status = response.status; throw error; }
  return value;
}
function people(participants) {
  $('presence-count').textContent = `${participants.length}人がここにいます`;
  $('people').innerHTML = participants.map((person) => `<div class="person">${esc(person.name)} · ${esc(modes[person.mode] ?? '')}${person.actorId !== actor?.id ? ` <button data-knock="${esc(person.actorId)}" ${['focus', 'away'].includes(person.mode) ? 'disabled' : ''}>ノック</button>` : ''}</div>`).join('');
  const avatars = participants.slice(0, 8).map((person, index) => `<g transform="translate(${210 + (index % 4) * 160} ${190 + Math.floor(index / 4) * 100})"><title>${esc(person.name)}</title><ellipse cy="8" rx="16" ry="7" fill="#44503f" opacity=".14"/><rect x="-9" y="-27" width="18" height="26" fill="${index % 2 ? '#b76750' : '#758a7f'}"/><circle cy="-37" r="9" fill="#d8ad88"/><rect x="-72" y="-65" width="144" height="19" rx="10" fill="#fffdf5"/><text y="-52" text-anchor="middle" font-size="9" fill="#52604d">${esc(person.name.length > 22 ? person.name.slice(0, 21) + '…' : person.name)}</text></g>`).join('');
  $('scene').innerHTML = `<svg viewBox="0 0 900 470" role="img" aria-label="共同アトリエ。参加者の詳細は下の一覧。"><rect width="900" height="470" fill="#edf0e6"/><path d="M450 80 780 230 450 390 120 230Z" fill="#e4d9c1" stroke="#d2c6ae"/><path d="M250 175 370 230 270 280 150 225Z" fill="#d1b18d"/><path d="M500 145 620 200 520 250 400 195Z" fill="#d5b792"/><path d="M485 255 645 330 520 390 360 315Z" fill="#c7a57f"/><rect x="145" y="100" width="130" height="55" rx="4" fill="#aabb9f"/><text x="450" y="440" text-anchor="middle" font-size="10" letter-spacing="3" fill="#8e9482">PICK UP WHERE WE LEFT OFF</text>${avatars}</svg>`;
}
function leave() {
  const previous = socket; socket = null; previous?.close();
  $('mode').disabled = true; $('join').textContent = '作業台に参加する'; people([]);
}
function render() {
  $('welcome').hidden = true; $('workspace').hidden = false;
  $('active-title').textContent = board.title; $('crumb').textContent = board.title;
  $('goal').textContent = board.goal; $('revision').textContent = `rev. ${board.revision}`;
  $('role').textContent = { owner: 'オーナー：候補を確定できます。', editor: '編集メンバー：確定はオーナーが行います。', viewer: '閲覧招待：この作業台だけ見えます。' }[board.role];
  $('notes').innerHTML = [...board.notes].reverse().map((note) => `<article class="note ${note.status === 'confirmed' ? 'confirmed' : ''}"><small>${labels[note.kind]} · ${note.status === 'confirmed' ? '確定済み' : '未確定'}</small><p>${esc(note.text)}</p>${board.role === 'owner' && note.status === 'draft' && !['question', 'hypothesis'].includes(note.kind) ? `<button data-confirm="${esc(note.id)}">内容を確認して確定</button>` : ''}</article>`).join('');
  $('note-form').hidden = board.role === 'viewer'; $('read-only').hidden = board.role !== 'viewer';
}
async function refresh(id, generation) {
  const next = await api(`/api/benches/${id}`);
  if (generation === selection && board?.id === id && next.revision >= board.revision) { board = next; render(); }
}
async function select(id) {
  leave(); const generation = ++selection; board = null; pendingSave = null;
  $('workspace').hidden = true; $('note-text').value = '';
  const next = await api(`/api/benches/${id}`);
  if (generation !== selection) return;
  board = next; render();
}
async function load() {
  leave(); ++selection; board = null; $('workspace').hidden = true;
  const bootstrap = await api('/api/bootstrap'); actor = bootstrap.actor;
  $('identity').textContent = actor.name;
  $('bench-list').innerHTML = bootstrap.benches.map((bench) => `<button class="bench" data-bench="${esc(bench.id)}">${esc(bench.title)}</button>`).join('');
  if (bootstrap.benches.length) await select(bootstrap.benches[0].id);
  else { $('welcome').hidden = false; $('welcome').textContent = '参加を許可された作業台がありません。管理者に確認してください。'; }
}
$('reload').onclick = () => load().catch((error) => notify(error.message));
$('bench-list').onclick = (event) => { const button = event.target.closest('[data-bench]'); if (button) select(button.dataset.bench).catch((error) => notify(error.message)); };
$('join').onclick = () => {
  if (socket) return leave();
  if (!board) return;
  const id = board.id, generation = selection;
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/benches/${id}/events`);
  socket = connection; $('join').textContent = '接続中（クリックで中止）';
  connection.onopen = () => { if (socket !== connection) return; $('join').textContent = '作業台から離れる'; $('mode').disabled = false; $('mode').value = 'knock'; };
  connection.onmessage = (event) => {
    if (socket !== connection || generation !== selection) return;
    const message = JSON.parse(event.data);
    if (message.kind === 'presence') people(message.data);
    if (message.kind === 'changed') refresh(id, generation).catch((error) => notify(error.message));
    if (message.kind === 'knock') notify(`${message.data.from}さんがノックしました。応答は必須ではありません。`);
    if (message.kind === 'error') notify(message.data.message);
  };
  connection.onclose = () => { if (socket !== connection) return; leave(); notify('同期が切れました。権限・ログインを確認し、参加し直してください。'); refresh(id, generation).catch(() => { $('workspace').hidden = true; }); };
};
$('mode').onchange = () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'presence', mode: $('mode').value, x: 50, y: 55 })); };
$('people').onclick = (event) => { const button = event.target.closest('[data-knock]'); if (button && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'knock', targetActorId: button.dataset.knock })); };
$('note-form').onsubmit = async (event) => {
  event.preventDefault(); if (!board) return;
  const id = board.id, generation = selection, button = event.submitter;
  button.disabled = true;
  const text = $('note-text').value, kind = $('kind').value;
  if (!pendingSave || pendingSave.id !== id || pendingSave.data.text !== text || pendingSave.data.kind !== kind) pendingSave = { id, requestId: crypto.randomUUID(), data: { text, kind, baseRevision: board.revision } };
  try {
    const next = await api(`/api/benches/${id}/notes`, 'POST', pendingSave.data, pendingSave.requestId);
    if (selection === generation) { if (next.revision >= board.revision) board = next; pendingSave = null; $('note-text').value = ''; render(); notify('未確定のメモとして保存しました。'); }
  } catch (error) {
    notify(error.message);
    if (error.status === 409 && generation === selection) { pendingSave = null; await refresh(id, generation).catch(() => {}); }
  } finally { button.disabled = false; }
};
$('notes').onclick = async (event) => {
  const button = event.target.closest('[data-confirm]'); if (!button || !board) return;
  const id = board.id, generation = selection; button.disabled = true;
  try { await api(`/api/benches/${id}/notes/${button.dataset.confirm}/confirm`, 'POST', { baseRevision: board.revision }, crypto.randomUUID()); await refresh(id, generation); notify('確定しました。外部実行の許可ではありません。'); }
  catch (error) { notify(error.message); await refresh(id, generation).catch(() => {}); }
  finally { button.disabled = false; }
};
$('handoff').onclick = async () => { if (!board) return; try { const packet = await api(`/api/benches/${board.id}/handoff`); $('handoff-text').textContent = JSON.stringify(packet, null, 2); $('dialog').showModal(); } catch (error) { notify(error.message); } };
$('close').onclick = () => $('dialog').close();
load().catch((error) => notify(error.message));
