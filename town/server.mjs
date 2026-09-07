/** Loopback-only integration fixture. NOT a public authentication server. */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Town, emptyState, TownError } from './core.mjs';
import { TABLE_SQL, decodeRows, writeChanges } from './storage.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = { aoi: { name: 'あおい', color: 'sage', avatar: 'person' }, sora: { name: 'そら', color: 'coral', avatar: 'cat' }, guest: { name: 'ゲスト', color: 'gold', avatar: 'bird' } };
const PLACES = [
  { id: 'atelier', tenantId: 'studio', title: 'アトリエの家', goal: '途中の仕事も、今日のひとことも。', role: 'owner' },
  { id: 'garden', tenantId: 'commons', title: 'みんなの広場', goal: '用事がなくても、ここに。', role: 'owner' },
  { id: 'cafe', tenantId: 'commons', title: '喫茶 こもれび', goal: 'ひと息ついて、話のつづき。', role: 'owner' },
  { id: 'library', tenantId: 'studio', title: '静かな書斎', goal: '集中したいときの小さな居場所。', role: 'owner' }
];
const security = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(), camera=(), display-capture=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const json = (res, value, status = 200) => { res.writeHead(status, { ...security, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new TownError(415, 'json_required', 'JSONが必要です。');
  const chunks = []; let size = 0;
  for await (const b of req) { size += b.length; if (size > 65536) throw new TownError(413, 'too_large', '入力が大きすぎます。'); chunks.push(b); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new TownError(400, 'invalid_json', '入力形式が不正です。'); }
}
export async function startTown({ port = 8789, dbPath = join(here, '..', '.data', 'town.sqlite'), seed = true } = {}) {
  if (dbPath !== ':memory:') await mkdir(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; ' + TABLE_SQL);
  const rows = db.prepare('SELECT kind,owner,id,value FROM town_records ORDER BY rowid').all();
  const saved = rows.length > 0;
  const state = decodeRows(rows);
  if (!saved && seed) for (const [id, profile] of Object.entries(FIXTURES)) state.profiles[id] = profile;
  const town = new Town(state);
  if (!saved && seed) {
    const ctx = { actor: { id: 'aoi', expiresAt: Date.now() + 3600_000 }, places: PLACES };
    let n = 0;
    const send = input => town.execute(ctx, { requestId: `seed-${++n}`, revision: town.room(input.roomId).revision, ...input });
    send({ op: 'post', roomId: 'garden', text: 'ここは、仕事の前に「おはよう」がある場所。\n各部屋は架空のデモです。実在する会社の情報は入っていません。' });
    send({ op: 'pin', roomId: 'garden', id: town.room('garden').posts[0].id });
    send({ op: 'object', roomId: 'garden', kind: 'plant', label: 'みんなのオリーブ' });
    send({ op: 'object', roomId: 'garden', kind: 'note', label: '途中のものを、途中のままで。' });
    send({ op: 'task', roomId: 'atelier', title: '今日つくった途中のものを、ひとつ見せる', project: 'はじめの一歩', mine: true });
    send({ op: 'task', roomId: 'cafe', title: 'みんなで聴く音を選ぶ', project: '場づくり', mine: false });
    writeChanges((sql,...args)=>db.prepare(sql).run(...args),emptyState(),town.durable());
  }
  const sessions = new Map(), clients = new Set(); let publishTimer, dirty = false;
  function context(req) {
    const cookie = /(?:^|;\s*)engawa_local=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    const session = sessions.get(cookie);
    if (!session || session.expiresAt <= Date.now()) throw new TownError(401, 'login_required', 'ローカルデモに入り直してください。');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const expected = req.headers['x-engawa-actor'] || url.searchParams.get('actor');
    if (expected && expected !== session.id) throw new TownError(401, 'identity_changed', 'ログインした人が変わりました。');
    const places = session.id === 'guest' ? PLACES.filter(p => ['garden', 'cafe'].includes(p.id)).map(p => ({ ...p, role: 'editor' })) : PLACES.map(p => ({ ...p, role: session.id === 'aoi' ? 'owner' : 'editor' }));
    return { actor: { ...session, guest: session.id === 'guest' }, places };
  }
  function snapshot(req, roomId, query) { return { ...town.read(context(req), roomId, query), localDemo: true }; }
  function publish(full = false) {
    dirty ||= full;
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
      publishTimer = undefined; const full = dirty; dirty = false;
      for (const c of clients) {
        try { const snap = full ? snapshot(c.req,c.roomId,'') : {...town.presenceSnapshot(context(c.req),c.roomId),localDemo:true}; if (!c.res.write(`data: ${JSON.stringify(snap)}\n\n`)) { c.res.end(); clients.delete(c); } }
        catch { c.res.write('event: revoked\ndata: {}\n\n'); c.res.end(); clients.delete(c); }
      }
    }, 65);
  }
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || req.headers['x-forwarded-host'] || req.headers['forwarded'] || req.headers['x-forwarded-for']) throw new TownError(403, 'loopback_only', 'このデモはローカル専用です。');
      const origin = `http://${host}`; const url = new URL(req.url, origin);
      if (req.headers.origin && req.headers.origin !== origin) throw new TownError(403, 'cross_origin', '別のサイトからは操作できません。');
      if (!['GET', 'HEAD'].includes(req.method) && (req.headers.origin !== origin || req.headers['x-engawa-client'] !== 'town-ui')) throw new TownError(403, 'csrf', 'アプリから操作してください。');
      if (url.pathname === '/local/session' && req.method === 'POST') {
        const input = await body(req);
        if (!input || typeof input !== 'object' || !Object.hasOwn(FIXTURES, input.actor)) throw new TownError(400, 'invalid_actor', '架空ユーザーを選んでください。');
        const token = randomUUID(); sessions.set(token, { id: input.actor, expiresAt: Date.now() + 3600_000 });
        res.setHeader('Set-Cookie', `engawa_local=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
        return json(res, { ok: true });
      }
      if (url.pathname === '/local/login' || url.pathname === '/local/login.js') {
        const isJS = url.pathname.endsWith('.js');
        res.writeHead(200, { ...security, 'Content-Type': isJS ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' });
        return res.end(await readFile(join(here, isJS ? 'local-login.js' : 'local-login.html')));
      }
      if (url.pathname === '/api/town/events' && req.method === 'GET') {
        const roomId = url.searchParams.get('room') || '';
        const snap = snapshot(req, roomId, '');
        res.writeHead(200, { ...security, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(snap)}\n\n`);
        const client = { req, res, roomId }; clients.add(client);
        req.on('close', () => clients.delete(client)); return;
      }
      if (url.pathname === '/api/town' && req.method === 'GET') return json(res, snapshot(req, url.searchParams.get('room') || '', url.searchParams.get('q') || ''));
      if (url.pathname === '/api/town' && req.method === 'POST') {
        const ctx = context(req), input = await body(req); let result;
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TownError(400, 'invalid_input', '操作の形式が不正です。');
        if (['join', 'leave', 'move', 'mode', 'gesture', 'heartbeat'].includes(input.op)) { town.live(ctx, input); result = { ok: true }; }
        else if (input.op === 'whisper') result = town.whisper(ctx, input);
        else {
          const prepared = town.prepare(ctx, input);
          if (prepared.state) {
            db.exec('BEGIN IMMEDIATE');
            try { writeChanges((sql,...args)=>db.prepare(sql).run(...args),town.durable(),prepared.state); db.exec('COMMIT'); }
            catch (e) { db.exec('ROLLBACK'); throw e; }
          }
          result = town.commit(prepared);
        }
        publish(!['join','leave','move','mode','gesture','heartbeat','whisper'].includes(input.op)); return json(res, result);
      }
      if (url.pathname.startsWith('/api/')) throw new TownError(404, 'not_found', '見つかりません。');
      if (!['GET', 'HEAD'].includes(req.method)) throw new TownError(405, 'method', '未対応の操作です。');
      if (url.pathname !== '/style.css') try { context(req); } catch { res.writeHead(302, { ...security, Location: '/local/login' }); return res.end(); }
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['index.html', 'app.js', 'world.js', 'recovery.js', 'style.css'].includes(name)) throw new TownError(404, 'not_found', '見つかりません。');
      const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
      res.writeHead(200, { ...security, 'Content-Type': `${type}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : await readFile(join(here, 'public', name)));
    } catch (e) { if (!res.headersSent) json(res, { error: e.code || 'unavailable', message: e instanceof TownError ? e.message : '保存できませんでした。入力を保ったまま、もう一度確認してください。' }, e.status || 503); else res.end(); }
  });
  const sweep = setInterval(publish, 5000); sweep.unref();
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { server, town, db, origin: `http://127.0.0.1:${server.address().port}`, close: async () => { clearInterval(sweep); clearTimeout(publishTimer); for (const c of clients) c.res.end(); await new Promise(r => server.close(r)); db.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startTown({ port: Number(process.env.PORT || 8789), dbPath: process.env.TOWN_DB || undefined });
  console.log(`ENGAWA Town · LOCAL FICTIONAL DEMO ONLY · ${app.origin}`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
