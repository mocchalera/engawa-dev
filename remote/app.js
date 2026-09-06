const $ = (id) => document.getElementById(id);
const labels = { hypothesis: '仮説', decision: '決定', constraint: '制約', question: '未解決の問い', task: '次の作業' };
const modes = { available: '会話歓迎', knock: 'ノックしてね', focus: '集中中', away: '離席中' };
let actor, board, socket, active, recoveryActor, sessionTimer, benches = [], epoch = 0, selection = 0, handoffVersion = 0;
const records = new Map();
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const notify = (message) => { $('toast').textContent = message; $('toast').hidden = false; };

async function api(path, scope, method = 'GET', data, requestId) {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Engawa-Client': 'remote-ui', ...(scope ? { 'X-Engawa-Actor': scope.actorId } : {}), ...(requestId ? { 'Idempotency-Key': requestId } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  let value;
  if (response.redirected) throw Object.assign(new Error('再ログインが必要です。入力と要求はこのページ内に保持しています。'), { status: 401 });
  try { value = await response.json(); } catch {
    const auth = response.status === 401 || response.headers.get('content-type')?.includes('text/html');
    throw Object.assign(new Error(auth ? 'ログインを確認できません。入力を退避して再ログインしてください。' : '通信応答を読み取れません。元の要求は保持しています。'), { status: auth ? 401 : 503 });
  }
  if (!response.ok) { const error = new Error(value.message ?? '操作できません。'); error.status = response.status; throw error; }
  return value;
}
const keyFor = (scope) => JSON.stringify([scope.actorId, scope.tenantId, scope.workbenchId]);
const current = (scope) => scope === active && scope?.epoch === epoch && scope.actorId === actor?.id && scope.selection === selection;
function record(scope = active) {
  const key = keyFor(scope);
  if (!records.has(key)) records.set(key, { actorId: scope.actorId, tenantId: scope.tenantId, workbenchId: scope.workbenchId, draft: { text: '', kind: 'question', version: 0 }, mutation: null });
  return records.get(key);
}
function captureDraft() {
  if (!active || !board) return;
  const state = record();
  if (state.draft.text !== $('note-text').value || state.draft.kind !== $('kind').value) state.draft = { text: $('note-text').value, kind: $('kind').value, version: state.draft.version + 1 };
}
function clearHandoff() {
  ++handoffVersion; $('dialog').close(); $('handoff-text').textContent = '';
}
function clearView() {
  clearHandoff(); $('workspace').hidden = true; $('notes').innerHTML = ''; $('people').innerHTML = ''; $('scene').innerHTML = '';
  for (const id of ['active-title', 'crumb', 'goal', 'revision', 'role', 'pending-status']) $(id).textContent = '';
  $('note-text').value = ''; $('kind').value = 'question'; $('recovery-text').value = ''; $('toast').hidden = true;
}
function detach() {
  captureDraft();
  if (active && record().mutation) record().mutation.state = 'unknown';
  leave(); active = null; board = null; ++selection; clearView();
}
function fail(scope, error) {
  if (!current(scope)) return;
  if ([401, 403, 404].includes(error.status)) {
    clearTimeout(sessionTimer);
    detach(); ++epoch; benches = []; $('bench-list').innerHTML = '';
    if (error.status === 401) { actor = null; $('identity').textContent = '再ログインが必要'; $('reauth').hidden = false; }
    $('connection-state').textContent = error.status === 401 ? '再ログインが必要です。別タブでログイン後、権限を再確認してください。' : '作業台へのアクセスを確認できません。取得済みの情報を消去しました。権限を再確認してください。';
  } else $('connection-state').textContent = '通信断または操作エラー。表示は最後に取得した状態です。要求を自動再送しません。';
  notify(error.message); recoveryStatus();
}
function checkedBoard(value, scope) {
  if (value?.id !== scope.workbenchId || value?.tenantId !== scope.tenantId) throw new Error('応答の作業台が一致しないため表示しません。');
  return value;
}
function people(participants) {
  $('presence-count').textContent = socket?.readyState === WebSocket.OPEN ? `${participants.length}人が参加中（本人ごと）。${participants.some((person) => person.actorId !== actor?.id) ? '' : '他の参加者はいません。'}` : '自分は未参加・他の参加者数は未取得';
  $('people').innerHTML = participants.map((person) => `<div class="person">${esc(person.name)} · ${esc(modes[person.mode] ?? '')}${person.actorId !== actor?.id ? ` <button data-knock="${esc(person.actorId)}" ${['focus', 'away'].includes(person.mode) ? 'disabled' : ''}>ノック</button>` : ''}</div>`).join('');
  const avatars = participants.slice(0, 8).map((person, index) => `<g transform="translate(${210 + (index % 4) * 160} ${190 + Math.floor(index / 4) * 100})"><title>${esc(person.name)}</title><ellipse cy="8" rx="16" ry="7" fill="#44503f" opacity=".14"/><rect x="-9" y="-27" width="18" height="26" fill="${index % 2 ? '#b76750' : '#758a7f'}"/><circle cy="-37" r="9" fill="#d8ad88"/><rect x="-72" y="-65" width="144" height="19" rx="10" fill="#fffdf5"/><text y="-52" text-anchor="middle" font-size="9" fill="#52604d">${esc(person.name.length > 22 ? person.name.slice(0, 21) + '…' : person.name)}</text></g>`).join('');
  $('scene').innerHTML = `<svg viewBox="0 0 900 470" role="img" aria-label="共同アトリエ。参加者の詳細は下の一覧。"><rect width="900" height="470" fill="#edf0e6"/><path d="M450 80 780 230 450 390 120 230Z" fill="#e4d9c1" stroke="#d2c6ae"/><path d="M250 175 370 230 270 280 150 225Z" fill="#d1b18d"/><path d="M500 145 620 200 520 250 400 195Z" fill="#d5b792"/><path d="M485 255 645 330 520 390 360 315Z" fill="#c7a57f"/><rect x="145" y="100" width="130" height="55" rx="4" fill="#aabb9f"/><text x="450" y="440" text-anchor="middle" font-size="10" letter-spacing="3" fill="#8e9482">PICK UP WHERE WE LEFT OFF</text>${avatars}</svg>`;
}
function leave() {
  const previous = socket; socket = null; previous?.close();
  $('mode').disabled = true; $('join').textContent = '作業台に参加する'; people([]);
  $('connection-state').textContent = '自分は未参加です。メモの保存と参加は別の操作です。';
}
function render() {
  $('welcome').hidden = true; $('workspace').hidden = false;
  $('active-title').textContent = board.title; $('crumb').textContent = board.title;
  $('goal').textContent = board.goal; $('revision').textContent = `rev. ${board.revision}`;
  $('role').textContent = { owner: 'オーナー：候補を確定できます。', editor: '編集メンバー：確定はオーナーが行います。', viewer: '閲覧招待：この作業台だけ見えます。' }[board.role];
  $('notes').innerHTML = [...board.notes].reverse().map((note) => `<article class="note ${note.status === 'confirmed' ? 'confirmed' : ''}"><small>${labels[note.kind]} · ${note.status === 'confirmed' ? '確定済み' : '未確定'}</small><p>${esc(note.text)}</p>${board.role === 'owner' && note.status === 'draft' && !['question', 'hypothesis'].includes(note.kind) ? `<button data-confirm="${esc(note.id)}">内容を確認して確定</button>` : ''}</article>`).join('');
  $('note-form').hidden = board.role === 'viewer'; $('read-only').hidden = board.role !== 'viewer';
  if (!socket) people([]);
  const state = record(); $('note-text').value = state.draft.text; $('kind').value = state.draft.kind;
  renderPending(); recoveryStatus();
}
function renderPending() {
  const mutation = record().mutation;
  $('pending').hidden = !mutation;
  $('pending-status').textContent = mutation ? `${mutation.type === 'save' ? '保存' : '確定'}要求 ${mutation.requestId}：${mutation.state === 'sending' ? '応答待ち。編集は続けられます。' : '成否未解決。元の内容・要求IDを保持しています。再確認して解決するまで新しい要求は送りません。'}` : '';
  $('resolve-request').disabled = mutation?.state === 'sending';
  $('discard-request').disabled = mutation?.state === 'sending';
  $('save').disabled = Boolean(mutation);
}
function ownRecords() { return [...records.values()].filter((state) => state.actorId === (actor?.id ?? recoveryActor) && (state.draft.text || state.mutation)); }
function recoveryStatus() { $('recovery-status').textContent = `このページ内に ${ownRecords().length} 作業台分の自分の入力・未解決要求を保持。端末へは自動保存しません。ページを閉じる前に必要なら退避JSONをコピーしてください。`; }
async function refresh(scope) {
  const next = await api(`/api/benches/${scope.workbenchId}`, scope);
  if (!current(scope)) return;
  checkedBoard(next, scope); captureDraft();
  if (next.revision >= board.revision) { board = next; render(); }
}
async function select(id) {
  const target = benches.find((item) => item.id === id);
  if (!actor || !target) return;
  detach();
  const scope = { actorId: actor.id, epoch, tenantId: target.tenantId, workbenchId: target.id, selection };
  active = scope;
  try {
    const next = await api(`/api/benches/${id}`, scope);
    if (!current(scope)) return;
    board = checkedBoard(next, scope); render();
  } catch (error) { fail(scope, error); }
}
async function load() {
  const previous = active;
  clearTimeout(sessionTimer); detach(); const ticket = ++epoch; actor = null; benches = []; $('bench-list').innerHTML = ''; $('identity').textContent = '本人確認中';
  try {
    const bootstrap = await api('/api/bootstrap');
    if (ticket !== epoch) return;
    actor = bootstrap.actor; recoveryActor = actor.id; benches = bootstrap.benches;
    if (Number.isFinite(bootstrap.session?.expiresAt)) {
      const expire = () => {
        if (ticket !== epoch) return;
        const remaining = bootstrap.session.expiresAt - Date.now();
        if (remaining > 0) { sessionTimer = setTimeout(expire, Math.min(remaining, 2147483647)); return; }
        detach(); ++epoch; actor = null; benches = []; $('bench-list').innerHTML = ''; $('identity').textContent = '再ログインが必要'; $('reauth').hidden = false;
        $('connection-state').textContent = '再ログインが必要です。有効期限に達したため取得済みの情報を消去しました。自分の入力・要求は退避できます。'; recoveryStatus();
      };
      sessionTimer = setTimeout(expire, Math.max(0, Math.min(bootstrap.session.expiresAt - Date.now(), 2147483647)));
    }
    $('identity').textContent = actor.name; $('reauth').hidden = true;
    $('bench-list').innerHTML = benches.map((item) => `<button class="bench" data-bench="${esc(item.id)}">${esc(item.title)}</button>`).join('');
    recoveryStatus();
    if (benches.length) await select(benches.find((item) => actor.id === previous?.actorId && item.id === previous.workbenchId && item.tenantId === previous.tenantId)?.id ?? benches[0].id);
    else { $('welcome').hidden = false; $('welcome').textContent = '参加を許可された作業台がありません。自分の入力は退避できます。管理者に確認してください。'; }
  } catch (error) {
    if (ticket !== epoch) return;
    $('connection-state').textContent = error.status === 401 ? '再ログインが必要です。別タブでログイン後、権限を再確認してください。' : '通信断。本人確認を完了できませんでした。';
    $('reauth').hidden = error.status !== 401; notify(error.message); recoveryStatus();
  }
}
$('reload').onclick = load;
$('bench-list').onclick = (event) => { const button = event.target.closest('[data-bench]'); if (button) return select(button.dataset.bench); };
$('join').onclick = () => {
  if (socket) return leave();
  if (!board) return;
  const scope = active;
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/benches/${scope.workbenchId}/events`);
  socket = connection; $('join').textContent = '接続中（クリックで中止）';
  connection.onopen = () => { if (socket !== connection || !current(scope)) return; $('connection-state').textContent = '接続した本人を確認中です。'; };
  connection.onmessage = (event) => {
    if (socket !== connection || !current(scope)) return;
    const message = JSON.parse(event.data);
    if (message.actorId !== scope.actorId) return fail(scope, Object.assign(new Error('ログインした本人が変わりました。権限を再確認してください。'), { status: 401 }));
    if ($('mode').disabled) { $('join').textContent = '作業台から離れる'; $('mode').disabled = false; $('mode').value = 'knock'; $('connection-state').textContent = '参加・同期中です。オンラインでも応答は必須ではありません。'; }
    if (message.kind === 'presence') people(message.data);
    if (message.kind === 'changed') refresh(scope).catch((error) => fail(scope, error));
    if (message.kind === 'knock') notify(`${message.data.from}さんがノックしました。応答は必須ではありません。`);
    if (message.kind === 'error') notify(message.data.message);
  };
  connection.onclose = () => { if (socket !== connection || !current(scope)) return; leave(); $('connection-state').textContent = '同期が切れました。権限を確認中です。自動参加はしません。'; refresh(scope).then(() => { if (current(scope)) $('connection-state').textContent = '同期は切断中です。権限は確認済み。参加し直すまで他の参加者数は未取得です。'; }).catch((error) => fail(scope, error)); };
};
$('mode').onchange = () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'presence', mode: $('mode').value, x: 50, y: 55 })); };
$('people').onclick = (event) => { const button = event.target.closest('[data-knock]'); if (button && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'knock', targetActorId: button.dataset.knock })); };
async function sendMutation(scope, mutation, reauthorize = false) {
  const state = record(scope);
  mutation.state = 'sending'; renderPending();
  try {
    if (reauthorize) {
      await refresh(scope);
      if (!current(scope)) return;
      if (board.role === 'viewer' || (mutation.type === 'confirm' && board.role !== 'owner')) throw Object.assign(new Error('現在の権限では要求を解決できません。元の要求は退避できます。'), { status: 403 });
    }
    const suffix = mutation.type === 'save' ? 'notes' : `notes/${mutation.noteId}/confirm`;
    const next = await api(`/api/benches/${scope.workbenchId}/${suffix}`, scope, 'POST', mutation.body, mutation.requestId);
    if (!current(scope) || state.mutation !== mutation) return;
    checkedBoard(next, scope); captureDraft();
    if (mutation.type === 'save' && state.draft.version === mutation.snapshot.version && state.draft.text === mutation.snapshot.text && state.draft.kind === mutation.snapshot.kind) state.draft = { ...state.draft, text: '', version: state.draft.version + 1 };
    if (next.revision >= board.revision) board = next;
    state.mutation = null; render(); notify(mutation.type === 'save' ? '未確定のメモとして保存しました。' : '確定しました。外部実行の許可ではありません。');
  } catch (error) {
    if (!current(scope) || state.mutation !== mutation) return;
    mutation.state = 'unknown'; fail(scope, error);
  } finally { if (current(scope)) { renderPending(); recoveryStatus(); } }
}
$('note-text').oninput = () => { captureDraft(); recoveryStatus(); };
$('kind').onchange = () => { captureDraft(); recoveryStatus(); };
$('note-form').onsubmit = (event) => {
  event.preventDefault(); if (!board || board.role === 'viewer' || record().mutation) return;
  captureDraft(); const state = record();
  const mutation = { type: 'save', requestId: crypto.randomUUID(), body: { text: state.draft.text, kind: state.draft.kind, baseRevision: board.revision }, snapshot: { ...state.draft }, state: 'sending' };
  state.mutation = mutation; return sendMutation(active, mutation);
};
$('notes').onclick = (event) => {
  const button = event.target.closest('[data-confirm]'); if (!button || !board || board.role !== 'owner' || record().mutation) return;
  const mutation = { type: 'confirm', noteId: button.dataset.confirm, requestId: crypto.randomUUID(), body: { baseRevision: board.revision }, state: 'sending' };
  record().mutation = mutation; return sendMutation(active, mutation);
};
$('resolve-request').onclick = () => { if (board && record().mutation?.state === 'unknown') return sendMutation(active, record().mutation, true); };
$('discard-request').onclick = () => {
  if (!board || record().mutation?.state !== 'unknown') return;
  if (!confirm('元の要求の追跡を破棄しますか？サーバーで既に保存・確定済みの可能性があります。これは取り消しではありません。必要なら先に退避JSONをコピーし、保存済み内容を確認してください。')) return;
  record().mutation = null; renderPending(); recoveryStatus(); notify('追跡だけを破棄しました。入力は保持しています。新しい保存は別の意図として扱われます。');
};
$('handoff').onclick = async () => {
  if (!board) return;
  const scope = active, version = ++handoffVersion;
  try {
    const packet = await api(`/api/benches/${scope.workbenchId}/handoff`, scope);
    if (!current(scope) || version !== handoffVersion) return;
    if (packet?.scope?.tenantId !== scope.tenantId || packet.scope.workbenchId !== scope.workbenchId) throw new Error('引き継ぎの作業台が一致しないため表示しません。');
    $('handoff-text').textContent = JSON.stringify(packet, null, 2); $('dialog').showModal();
  } catch (error) { if (version === handoffVersion) fail(scope, error); }
};
$('close').onclick = clearHandoff;
$('export-recovery').onclick = () => {
  captureDraft();
  const saved = ownRecords().map((state) => ({ ...state, mutation: state.mutation ? { ...state.mutation, state: 'unknown' } : null }));
  $('recovery-text').value = JSON.stringify({ schema: 'engawa.recovery/v1', origin: location.origin, actorId: actor?.id ?? recoveryActor, records: saved }, null, 2);
  $('recovery-text').focus(); $('recovery-text').select(); notify('自分の入力と要求IDだけの退避JSONです。機密を含み得ます。安全な場所へコピーし、共有端末に残さないでください。');
};
function validateRecovery(value) {
  const validId = (id) => typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id);
  const validDraft = (draft) => draft && typeof draft.text === 'string' && draft.text.length <= 3000 && Object.hasOwn(labels, draft.kind) && Number.isSafeInteger(draft.version) && draft.version >= 0;
  if (!actor || value?.schema !== 'engawa.recovery/v1' || value.origin !== location.origin || value.actorId !== actor.id || !Array.isArray(value.records) || value.records.length > 100) throw new Error('本人・保存元・形式を確認できません。同じ本人で権限を再確認してください。');
  const restored = new Map();
  for (const item of value.records) {
    if (item.actorId !== actor.id || !validId(item.tenantId) || !validId(item.workbenchId) || !validDraft(item.draft)) throw new Error('退避データのscopeまたは入力が不正です。');
    const mutation = item.mutation;
    if (mutation) {
      if (!['save', 'confirm'].includes(mutation.type) || !/^[a-zA-Z0-9-]{16,80}$/.test(mutation.requestId) || !Number.isSafeInteger(mutation.body?.baseRevision) || mutation.body.baseRevision < 0) throw new Error('要求IDまたはrevisionが不正です。');
      if (mutation.type === 'save' && (!validDraft(mutation.snapshot) || mutation.body.text !== mutation.snapshot.text || mutation.body.kind !== mutation.snapshot.kind || Object.keys(mutation.body).sort().join() !== 'baseRevision,kind,text')) throw new Error('送信snapshotが一致しません。');
      if (mutation.type === 'confirm' && (!/^[a-zA-Z0-9-]+$/.test(mutation.noteId) || Object.keys(mutation.body).join() !== 'baseRevision')) throw new Error('確定要求が不正です。');
    }
    const key = keyFor(item), existing = records.get(key);
    if (restored.has(key) || existing?.draft.text || existing?.mutation) throw new Error('この作業台の入力を上書きしません。現在の入力を別途退避してください。');
    restored.set(key, { actorId: actor.id, tenantId: item.tenantId, workbenchId: item.workbenchId, draft: { text: item.draft.text, kind: item.draft.kind, version: item.draft.version }, mutation: mutation ? { type: mutation.type, requestId: mutation.requestId, body: mutation.body, ...(mutation.type === 'save' ? { snapshot: { ...mutation.snapshot } } : { noteId: mutation.noteId }), state: 'unknown' } : null });
  }
  return restored;
}
$('import-recovery').onclick = () => {
  try {
    captureDraft();
    if ($('recovery-text').value.length > 400000) throw new Error('退避JSONが大きすぎます。');
    const restored = validateRecovery(JSON.parse($('recovery-text').value));
    for (const [key, value] of restored) records.set(key, value);
    $('recovery-text').value = ''; if (board) render(); recoveryStatus(); notify('自分の入力・要求を復元しました。送信や確定は行っていません。');
  } catch (error) { notify(error.message); }
};
window.addEventListener('beforeunload', (event) => { captureDraft(); if ([...records.values()].some((state) => state.draft.text || state.mutation)) { event.preventDefault(); event.returnValue = ''; } });
$('remote-logout').onclick = (event) => {
  captureDraft();
  if (ownRecords().length && !confirm('未保存入力・成否未解決要求があります。先に退避JSONをコピーしてください。退避済み、または入力と要求の追跡を破棄してログアウトしますか？サーバー処理の取り消しにはなりません。')) { event.preventDefault(); return; }
  clearTimeout(sessionTimer); detach(); ++epoch; actor = null; recoveryActor = null; records.clear(); benches = []; $('bench-list').innerHTML = ''; $('identity').textContent = 'ログアウト中';
};
load();
