const $ = (id) => document.getElementById(id);
const labels = { hypothesis: '仮説', decision: '決定', constraint: '制約', question: '未解決の問い', task: '次の作業' };
const modes = { available: '会話歓迎', knock: 'ノックしてね', focus: '集中中', away: '離席中' };
let bootstrap = null, board = null, participants = [], joined = false, stream = null, toastTimer;

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function api(path, method = 'GET', data) {
  const response = await fetch(path, { method, cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Engawa-Client': 'local-ui' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(response.status, result.message ?? '通信に失敗しました。');
  return result;
}
function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function clearRoom() { stream?.close(); stream = null; joined = false; participants = []; $('join').textContent = '作業台に参加する'; $('mode').disabled = true; }

function renderBenchList() {
  $('bench-list').innerHTML = bootstrap.benches.map((b) => `<button class="bench ${b.id === board?.id ? 'active' : ''}" data-bench="${esc(b.id)}">${esc(b.title)}</button>`).join('');
}
function renderScene() {
  const people = participants.map((p, i) => {
    const cx = 260 + (p.x - p.y) * 2.1, cy = 125 + (p.x + p.y) * .75;
    const color = ['#b76750', '#758a7f', '#b5a067', '#7d889b'][i % 4];
    return `<g transform="translate(${cx} ${cy})"><ellipse cy="8" rx="16" ry="7" fill="#44503f" opacity=".14"/><rect x="-9" y="-27" width="18" height="26" fill="${color}"/><circle cy="-37" r="9" fill="#d8ad88"/><rect x="-40" y="-65" width="80" height="19" rx="10" fill="#fffdf5"/><text y="-52" text-anchor="middle" font-size="9" fill="#52604d">${esc(p.name)}</text></g>`;
  }).join('');
  $('scene').innerHTML = `<svg viewBox="0 0 900 470" role="img" aria-label="共同アトリエの俯瞰図"><rect width="900" height="470" fill="#edf0e6"/><path d="M450 80 780 230 450 390 120 230Z" fill="#e4d9c1" stroke="#d2c6ae"/><path d="M250 175 370 230 270 280 150 225Z" fill="#d1b18d"/><path d="M500 145 620 200 520 250 400 195Z" fill="#d5b792"/><path d="M485 255 645 330 520 390 360 315Z" fill="#c7a57f"/><rect x="145" y="100" width="130" height="55" rx="4" fill="#aabb9f"/><text x="450" y="440" text-anchor="middle" font-size="10" letter-spacing="3" fill="#8e9482">PICK UP WHERE WE LEFT OFF</text>${people}</svg>`;
  $('presence-count').textContent = `${participants.length}人がここにいます`;
  $('people').innerHTML = participants.length ? participants.map((p) => `<div class="person">${esc(p.name)} · ${modes[p.mode]}${bootstrap?.actor.id !== p.actorId ? ` <button data-knock="${esc(p.actorId)}" ${!joined || ['focus','away'].includes(p.mode) ? 'disabled' : ''}>ノック</button>` : ''}</div>`).join('') : '<span class="person">いまは静かな作業台です。</span>';
}
function renderBoard() {
  if (!board) return;
  $('welcome').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
  $('crumb').textContent = board.title; $('active-title').textContent = board.title; $('goal').textContent = board.goal; $('revision').textContent = `rev. ${board.revision}`;
  $('role').textContent = board.role === 'owner' ? 'オーナー：候補を確定できます。' : board.role === 'editor' ? '編集メンバー：確定はオーナーが行います。' : '閲覧招待：この作業台だけ見えます。';
  $('notes').innerHTML = [...board.notes].reverse().map((n) => `<article class="note ${n.status === 'confirmed' ? 'confirmed' : ''}"><small>${labels[n.kind]} · ${n.status === 'confirmed' ? '確定済み' : '未確定'}</small><p>${esc(n.text)}</p>${board.role === 'owner' && n.status === 'draft' && !['question','hypothesis'].includes(n.kind) ? `<button data-confirm="${esc(n.id)}">内容を確認して確定</button>` : ''}</article>`).join('');
  const writable = board.role !== 'viewer'; $('note-form').hidden = !writable; $('read-only').hidden = writable;
  renderBenchList(); renderScene();
}
async function selectBench(id) {
  const old = board?.id; if (old && joined) await api(`/api/benches/${old}/leave`, 'POST', {}).catch(() => {});
  clearRoom(); board = await api(`/api/benches/${id}`); participants = (await api(`/api/benches/${id}/presence`)).participants; renderBoard();
}
async function load() {
  bootstrap = await api('/api/bootstrap'); renderBenchList(); if (bootstrap.benches[0]) await selectBench(bootstrap.benches[0].id);
}
async function login() { try { await api('/api/session', 'POST', { actorId: $('actor').value }); bootstrap = null; board = null; await load(); } catch (e) { toast(e.message); } }

$('login').addEventListener('click', login);
$('logout').addEventListener('click', async () => { await api('/api/session', 'DELETE'); clearRoom(); bootstrap = null; board = null; $('workspace').hidden = true; $('welcome').hidden = false; $('bench-list').innerHTML = ''; $('logout').hidden = true; });
$('bench-list').addEventListener('click', (event) => { const button = event.target.closest('[data-bench]'); if (button) selectBench(button.dataset.bench).catch((e) => toast(e.message)); });
$('join').addEventListener('click', async () => {
  if (!board) return;
  try {
    if (joined) { await api(`/api/benches/${board.id}/leave`, 'POST', {}); clearRoom(); participants = (await api(`/api/benches/${board.id}/presence`)).participants; renderScene(); return; }
    await api(`/api/benches/${board.id}/join`, 'POST', {}); joined = true; $('join').textContent = '作業台から離れる'; $('mode').disabled = false;
    stream = new EventSource(`/api/benches/${board.id}/events`);
    stream.addEventListener('presence', (event) => { participants = JSON.parse(event.data); renderScene(); });
    stream.addEventListener('changed', async () => { board = await api(`/api/benches/${board.id}`); renderBoard(); });
    stream.addEventListener('knock', (event) => toast(`${JSON.parse(event.data).from}さんがノックしました。応答は必須ではありません。`));
    stream.onerror = () => { clearRoom(); toast('同期が切れました。参加し直してください。'); };
  } catch (e) { toast(e.message); }
});
$('mode').addEventListener('change', async () => { try { await api(`/api/benches/${board.id}/presence`, 'PUT', { mode: $('mode').value, x: 50, y: 55 }); } catch (e) { toast(e.message); } });
$('people').addEventListener('click', (event) => { const button = event.target.closest('[data-knock]'); if (button) api(`/api/benches/${board.id}/knock`, 'POST', { targetActorId: button.dataset.knock }).then(() => toast('ノックしました。マイクは開きません。')).catch((e) => toast(e.message)); });
$('note-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { board = await api(`/api/benches/${board.id}/notes`, 'POST', { kind: $('kind').value, text: $('note-text').value, baseRevision: board.revision }); $('note-text').value = ''; renderBoard(); toast('未確定のメモとして残しました。'); }
  catch (e) { toast(e.message); if (e.status === 409) { board = await api(`/api/benches/${board.id}`); renderBoard(); } }
});
$('notes').addEventListener('click', async (event) => { const button = event.target.closest('[data-confirm]'); if (!button) return; try { board = await api(`/api/benches/${board.id}/notes/${button.dataset.confirm}/confirm`, 'POST', { baseRevision: board.revision }); renderBoard(); toast('確定しました。外部実行の許可ではありません。'); } catch (e) { toast(e.message); } });
$('handoff').addEventListener('click', async () => { try { const value = await api(`/api/benches/${board.id}/handoff`); $('handoff-text').textContent = JSON.stringify(value, null, 2); $('dialog').showModal(); } catch (e) { toast(e.message); } });
$('close').addEventListener('click', () => $('dialog').close());
load().catch(() => {});
