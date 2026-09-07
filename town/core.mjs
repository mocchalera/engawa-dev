/** ENGAWA Town domain. No I/O, credentials, attendance history, or recording. */
export const BUFFER_MS = 5 * 60_000;
export const PRESENCE_MS = 90_000;
// The current single-object pilot fails closed before unbounded growth.
export const MAX_DURABLE_BYTES = 4 * 1024 * 1024;
export const NEAR = 6;
export const MODES = ['available', 'knock', 'focus', 'away'];
export class TownError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new TownError(status, code, message); };
const text = (v, max, optional = false) => {
  if (typeof v !== 'string' || v.length > max || (!optional && !v.trim())) fail(400, 'invalid_input', '入力の長さと内容を確認してください。');
  return v.trim();
};
const clone = v => structuredClone(v);
const canonical = v => JSON.stringify(v, (_k, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
const canWrite = role => role === 'owner' || role === 'editor';
const roomEmpty = () => ({ revision: 0, posts: [], tasks: [], objects: [], ambience: 'auto', game: { cells: Array(9).fill(null), turn: '○', players: {}, winner: null } });
export const emptyState = () => ({ schema: 1, rooms: {}, profiles: {}, memories: {}, receipts: {} });
const own = (obj, key) => Object.hasOwn(obj, key) ? obj[key] : undefined;
const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
const validId = id => { if (!safeId(id)) fail(400, 'invalid_id', '識別子が不正です。'); return id; };
export class Town {
  constructor(durable = emptyState(), clock = Date.now, makeId = () => crypto.randomUUID()) {
    if (durable.schema !== 1) throw new Error('Unsupported Town schema');
    this.state = clone(durable); this.now = clock; this.makeId = makeId;
    this.people = new Map(); this.buffer = []; this.rates = new Map();
  }
  durable() { return clone(this.state); }
  expire() {
    const now = this.now();
    for (const [id, p] of this.people) if (p.seenAt + PRESENCE_MS <= now || p.expiresAt <= now) this.people.delete(id);
    this.buffer = this.buffer.filter(m => m.at + BUFFER_MS > now);
    for (const [key, r] of this.rates) if (r.at + 60_000 < now) this.rates.delete(key);
  }
  context(ctx) {
    if (!ctx?.actor || !safeId(ctx.actor.id) || ctx.actor.expiresAt <= this.now() || !Array.isArray(ctx.places)) fail(401, 'session_expired', 'ログインをやり直してください。');
    return ctx;
  }
  place(ctx, id, write = false) {
    this.context(ctx); validId(id);
    const place = ctx.places.find(p => p.id === id);
    if (!place) fail(404, 'not_found', 'この場所にはアクセスできません。');
    if (write && !canWrite(place.role)) fail(403, 'read_only', 'この場所は閲覧専用です。');
    return place;
  }
  room(id, state = this.state) { return own(state.rooms, id) ?? roomEmpty(); }
  profile(actor, state = this.state) { return own(state.profiles, actor.id) ?? { name: 'メンバー', avatar: 'person', color: 'sage' }; }
  name(actor, state = this.state) { return this.profile(actor, state).name; }
  invalidate() { this.people.clear(); this.buffer = []; }
  live(ctx, input) {
    this.context(ctx); this.expire();
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_input', '操作の形式が不正です。');
    const id = ctx.actor.id;
    const key = `live:${id}`; const now = this.now();
    const rate = this.rates.get(key);
    if (rate?.at + 1000 > now && rate.n >= 15) fail(429, 'rate_limited', '少し間をあけて操作してください。');
    this.rates.set(key, rate?.at + 1000 > now ? { at: rate.at, n: rate.n + 1 } : { at: now, n: 1 });
    if (input.op === 'leave') { this.people.delete(id); return; }
    this.place(ctx, input.roomId);
    if (input.op === 'join') {
      const seed = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
      this.people.set(id, { id, roomId: input.roomId, x: ((seed % 5) - 2) * 1.2, z: (Math.floor(seed / 5) % 4) - 1, mode: 'available', gesture: '', gestureAt: 0, seenAt: now, expiresAt: ctx.actor.expiresAt, guest: Boolean(ctx.actor.guest) });
      return;
    }
    const p = this.people.get(id);
    if (!p || p.roomId !== input.roomId) fail(409, 'not_present', '先にこの場所へ入ってください。');
    p.seenAt = now; p.expiresAt = ctx.actor.expiresAt;
    if (input.op === 'move') {
      if (![input.x, input.z].every(v => Number.isFinite(v) && Math.abs(v) <= 9)) fail(400, 'invalid_position', '移動先が範囲外です。');
      p.x = input.x; p.z = input.z;
    } else if (input.op === 'mode') {
      if (!MODES.includes(input.mode)) fail(400, 'invalid_mode', '状態が不正です。');
      p.mode = input.mode;
    } else if (input.op === 'gesture') {
      if (!['wave', 'clap', 'heart', 'coffee'].includes(input.gesture)) fail(400, 'invalid_gesture', '挨拶の種類が不正です。');
      p.gesture = input.gesture; p.gestureAt = now;
    } else if (input.op !== 'heartbeat') fail(400, 'unknown_operation', '不明な操作です。');
  }
  whisper(ctx, input) {
    this.context(ctx); this.expire();
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_input', '操作の形式が不正です。');
    this.place(ctx, input.roomId, true);
    const p = this.people.get(ctx.actor.id);
    if (!p || p.roomId !== input.roomId) fail(409, 'not_present', 'つぶやくには、その場に入ってください。');
    const key = `whisper:${ctx.actor.id}`; const prev = this.rates.get(key);
    if (prev && this.now() - prev.at < 1000) fail(429, 'rate_limited', '少し間をあけて話してください。');
    const content = text(input.text, 500);
    this.rates.set(key, { at: this.now(), n: 1 });
    const recipients = [...this.people.values()].filter(q => q.id === p.id || (q.roomId === p.roomId && !['focus', 'away'].includes(q.mode) && Math.hypot(p.x - q.x, p.z - q.z) <= NEAR)).map(q => q.id);
    if (this.buffer.length >= 3000) fail(503, 'buffer_busy', '今はつぶやきが混み合っています。掲示板への投稿を使ってください。');
    if (input.note && !['C4', 'D4', 'E4', 'G4', 'A4'].includes(input.note)) fail(400, 'invalid_note', '音が不正です。');
    const message = { id: this.makeId(), roomId: p.roomId, author: p.id, name: this.name(ctx.actor), text: content, at: this.now(), recipients, ...(input.note ? { note: input.note } : {}) };
    this.buffer.push(message);
    return { id: message.id };
  }
  read(ctx, selected, query = '') {
    this.context(ctx); this.expire();
    const allowed = new Set(ctx.places.map(p => p.id));
    const p = this.people.get(ctx.actor.id);
    if (p && !allowed.has(p.roomId)) this.people.delete(ctx.actor.id);
    if (selected) this.place(ctx, selected);
    const places = ctx.places.map(({ id, tenantId, title, goal, role }) => ({ id, tenantId, title, goal, role }));
    const tasks = places.flatMap(place => this.room(place.id).tasks.map(t => ({ ...clone(t), roomId: place.id, roomTitle: place.title })));
    const memories = (own(this.state.memories, ctx.actor.id) ?? []).filter(m => allowed.has(m.roomId)).map(clone);
    const people = [...this.people.values()].filter(p => allowed.has(p.roomId)).map(({ seenAt: _s, expiresAt: _e, ...p }) => ({ ...p, ...this.profile({ id: p.id }), gesture: p.gestureAt + 4000 > this.now() ? p.gesture : '' }));
    const buffer = this.buffer.filter(m => allowed.has(m.roomId) && m.recipients.includes(ctx.actor.id)).map(({ recipients: _r, ...m }) => ({ ...m }));
    const current = selected ? clone(this.room(selected)) : null;
    if (current) {
      current.totalPosts = current.posts.length;
      const keep = new Set(current.posts.slice(-150).map(p => p.id));
      for (const p of current.posts) if (p.pinned) keep.add(p.id);
      for (const p of current.posts) if (keep.has(p.id) && p.parentId) keep.add(p.parentId);
      current.posts = current.posts.filter(p => keep.has(p.id));
    }
    const q = String(query).trim().toLocaleLowerCase().slice(0, 100);
    const search = q ? places.flatMap(place => [
      ...this.room(place.id).posts.map(p => ({ ...p, kind: 'post', roomId: place.id, roomTitle: place.title })),
      ...this.room(place.id).tasks.map(t => ({ ...t, text: t.title, kind: 'task', roomId: place.id, roomTitle: place.title }))
    ]).filter(p => `${p.text} ${p.project ?? ''}`.toLocaleLowerCase().includes(q)).slice(-100).reverse() : [];
    return { actor: { id: ctx.actor.id, ...this.profile(ctx.actor), guest: Boolean(ctx.actor.guest) }, expiresAt: ctx.actor.expiresAt, now: this.now(), places, selected: selected || null, current, people, tasks, memories, buffer, search, capabilities: { audio: false, screen: false, recording: false, ai: false, rewindText: true }, bufferMs: BUFFER_MS };
  }
  presenceSnapshot(ctx, selected) {
    this.context(ctx); this.expire(); if (selected) this.place(ctx, selected);
    const allowed = new Set(ctx.places.map(p => p.id));
    const people = [...this.people.values()].filter(p => allowed.has(p.roomId)).map(({ seenAt: _s, expiresAt: _e, ...p }) => ({ ...p, ...this.profile({id:p.id}), gesture:p.gestureAt+4000>this.now()?p.gesture:'' }));
    const buffer = this.buffer.filter(m => allowed.has(m.roomId) && m.recipients.includes(ctx.actor.id)).slice(-50).map(({recipients: _r,...m}) => ({...m}));
    return {kind:'presence',actor:{id:ctx.actor.id,...this.profile(ctx.actor),guest:Boolean(ctx.actor.guest)},expiresAt:ctx.actor.expiresAt,now:this.now(),selected:selected||null,places:ctx.places.map(({id,tenantId,title,goal,role})=>({id,tenantId,title,goal,role})),people,buffer};
  }
  prepare(ctx, input) {
    this.context(ctx); this.expire();
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_input', '操作の形式が不正です。');
    validId(input.requestId);
    const durableOps = ['profile', 'post', 'pin', 'deletePost', 'task', 'taskUpdate', 'deleteTask', 'capture', 'forget', 'share', 'object', 'water', 'deleteObject', 'ambience', 'play', 'resetGame'];
    if (!durableOps.includes(input.op)) fail(400, 'unknown_operation', '不明な保存操作です。');
    const fingerprint = canonical(input); const key = `${ctx.actor.id}:${input.requestId}`;
    const old = own(this.state.receipts, key);
    // Always reauthorize before returning a receipt. A receipt is not an access grant.
    if (input.roomId) this.place(ctx, input.roomId, !['capture', 'forget', 'profile'].includes(input.op));
    if (old) {
      if (old.fingerprint !== fingerprint) fail(409, 'request_collision', '同じ送信IDで異なる内容は保存できません。');
      return { replay: true, result: clone(old.result), state: null };
    }
    const next = this.durable(); const now = this.now(); const author = ctx.actor.id;
    for (const [k, r] of Object.entries(next.receipts)) if (r.at + 86_400_000 <= now) delete next.receipts[k];
    if (Object.keys(next.receipts).length >= 20_000) fail(503, 'receipt_capacity', '保存の受付容量に達しました。管理者に連絡してください。');
    let result = { ok: true };
    if (input.op === 'profile') {
      if (!['person', 'cat', 'bird', 'rabbit'].includes(input.avatar) || !['sage', 'coral', 'blue', 'gold', 'plum'].includes(input.color)) fail(400, 'invalid_profile', 'アバターを選び直してください。');
      next.profiles[author] = { name: text(input.name, 40), avatar: input.avatar, color: input.color };
    } else if (input.op === 'forget') {
      const list = own(next.memories, author) ?? [];
      if (!list.some(m => m.id === input.id)) fail(404, 'not_found', '記憶が見つかりません。');
      next.memories[author] = list.filter(m => m.id !== input.id);
    } else {
      const place = this.place(ctx, input.roomId, input.op !== 'capture');
      const room = own(next.rooms, input.roomId) ?? (next.rooms[input.roomId] = roomEmpty());
      // Every shared durable mutation has a revision precondition, including creates.
      if (input.op !== 'capture' && (!Number.isSafeInteger(input.revision) || input.revision !== room.revision)) fail(409, 'revision_conflict', '他の人の更新があります。最新の内容を確認して、もう一度保存してください。');
      const get = (list, id) => list.find(x => x.id === id) ?? fail(404, 'not_found', '対象が見つかりません。');
      const editable = item => { if (item.author !== author && place.role !== 'owner') fail(403, 'not_owner', '作成した本人または場所のオーナーだけが変更できます。'); };
      const addPost = (content, extra = {}) => {
        if (room.posts.length >= 10_000) fail(507, 'capacity', '掲示板の容量に達しました。記録は自動削除していません。');
        const p = { id: this.makeId(), author, name: this.name(ctx.actor), text: content, at: now, order: room.revision, pinned: false, parentId: null, ...extra };
        room.posts.push(p); result = { ok: true, id: p.id };
      };
      if (input.op === 'post') {
        let parentId = input.parentId || null;
        if (parentId) { const parent = get(room.posts, parentId); parentId = parent.parentId || parent.id; get(room.posts, parentId); }
        addPost(text(input.text, 8000), { parentId });
      } else if (input.op === 'pin') {
        const p = get(room.posts, input.id); editable(p); p.pinned = !p.pinned;
      } else if (input.op === 'deletePost') {
        const p = get(room.posts, input.id); editable(p); p.text = 'この投稿は削除されました。'; p.deleted = true; p.pinned = false;
      } else if (input.op === 'task') {
        if (room.tasks.length >= 3000) fail(507, 'capacity', 'タスクの容量に達しました。');
        const due = input.due || '';
        if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)))) fail(400, 'invalid_due', '期限を確認してください。');
        const t = { id: this.makeId(), author, name: this.name(ctx.actor), title: text(input.title, 200), project: text(input.project ?? '', 100, true), due, assignee: input.mine ? author : null, done: false, at: now, order: room.revision };
        room.tasks.push(t); result = { ok: true, id: t.id };
      } else if (input.op === 'taskUpdate') {
        const t = get(room.tasks, input.id);
        if (typeof input.done === 'boolean') t.done = input.done;
        if (input.claim === true) { if (t.assignee && t.assignee !== author && place.role !== 'owner') fail(403, 'assigned', 'このタスクは他の人が担当しています。'); t.assignee = author; }
        if (input.claim === false) { if (t.assignee !== author && place.role !== 'owner') fail(403, 'not_owner', '担当を外せるのは本人かオーナーです。'); t.assignee = null; }
      } else if (input.op === 'deleteTask') {
        const t = get(room.tasks, input.id); editable(t); room.tasks = room.tasks.filter(t => t.id !== input.id);
      } else if (input.op === 'capture') {
        const m = this.buffer.find(m => m.id === input.id && m.roomId === input.roomId && m.recipients.includes(author));
        if (!m) fail(404, 'not_available', 'その場で届いた、5分以内のつぶやきだけを保存できます。');
        const list = own(next.memories, author) ?? (next.memories[author] = []);
        if (list.length >= 1000) fail(507, 'capacity', '個人の記憶がいっぱいです。不要なものを削除してください。');
        const { recipients: _r, ...copy } = m;
        const saved = { ...copy, sourceId: copy.id, id: this.makeId(), savedAt: now };
        list.push(saved); result = { ok: true, id: saved.id };
      } else if (input.op === 'share') {
        const m = get(own(next.memories, author) ?? [], input.id);
        if (m.roomId !== input.roomId) fail(403, 'scope_expansion', '記憶は元の場所にだけ共有できます。');
        addPost(m.text, { source: { author: m.author, name: m.name, at: m.at }, kind: 'memory' });
      } else if (input.op === 'object') {
        if (!['plant', 'note', 'photo'].includes(input.kind)) fail(400, 'invalid_object', '置くものを選んでください。');
        if (room.objects.length >= 36) fail(507, 'capacity', 'この場所には36個まで置けます。');
        if (input.kind === 'photo' && (typeof input.image !== 'string' || input.image.length > 48000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.image))) fail(400, 'invalid_image', '48KB以下の画像を選んでください。');
        room.objects.push({ id: this.makeId(), author, name: this.name(ctx.actor), kind: input.kind, label: text(input.label, 120), at: now, order: room.revision, wateredAt: 0, growth: 0, ...(input.kind === 'photo' ? { image: input.image } : {}) });
      } else if (input.op === 'water') {
        const o = get(room.objects, input.id);
        if (o.kind !== 'plant') fail(400, 'not_plant', '植物ではありません。');
        if (o.wateredAt && now - o.wateredAt < 86_400_000) fail(409, 'already_watered', '今日はもう水をもらいました。');
        o.wateredAt = now; o.growth = Math.min(5, o.growth + 1);
      } else if (input.op === 'deleteObject') {
        const o = get(room.objects, input.id); editable(o); room.objects = room.objects.filter(o => o.id !== input.id);
      } else if (input.op === 'ambience') {
        if (!['auto', 'piano', 'rain', 'quiet'].includes(input.value)) fail(400, 'invalid_ambience', '音の種類が不正です。');
        room.ambience = input.value;
      } else if (input.op === 'play') {
        const g = room.game; const cell = input.cell;
        if (!Number.isInteger(cell) || cell < 0 || cell > 8 || g.cells[cell] || g.winner) fail(409, 'invalid_move', '別のマスを選ぶか、新しいゲームを始めてください。');
        const other = g.turn === '○' ? '×' : '○';
        if (g.players[other] === author || (g.players[g.turn] && g.players[g.turn] !== author)) fail(403, 'not_your_turn', '相手の番です。');
        g.players[g.turn] = author; g.cells[cell] = g.turn;
        for (const [a, b, c] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]) if (g.cells[a] && g.cells[a] === g.cells[b] && g.cells[a] === g.cells[c]) g.winner = g.turn;
        if (!g.winner && g.cells.every(Boolean)) g.winner = 'draw';
        g.turn = other;
      } else if (input.op === 'resetGame') {
        const g = room.game;
        if (g.cells.some(Boolean) && !g.winner && !Object.values(g.players).includes(author) && place.role !== 'owner') fail(403, 'not_player', '対局中のリセットは参加者かオーナーだけができます。');
        room.game = roomEmpty().game;
      }
      if (input.op !== 'capture') room.revision++;
    }
    next.receipts[key] = { at: now, fingerprint, result };
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_DURABLE_BYTES) fail(507, 'pilot_capacity', '現在の運用枠の容量に達しました。記録は自動削除していません。管理者がバックアップと容量拡張を確認してください。');
    return { state: next, result, replay: false };
  }
  commit(prepared) { if (prepared.state) this.state = prepared.state; return prepared.result; }
  execute(ctx, input) { return this.commit(this.prepare(ctx, input)); }
}
