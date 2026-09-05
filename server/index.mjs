import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { ACTORS, MODES, DomainError, actorById, seedDatabase, validateDatabase, roleFor, requireReadable, publicBench, addNote, confirmNote, handoff } from '../src/domain.mjs';

const PORT = Number(process.env.PORT ?? 4173);
const DATA_DIR = resolve(process.env.ENGAWA_DATA_DIR ?? '.data');
const DATA_FILE = resolve(DATA_DIR, 'workbenches.json');
const PUBLIC = resolve('public');
const sessions = new Map();
const presence = new Map();
const streams = new Map();
const HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
let database;
let writeTail = Promise.resolve();

async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  try { return validateDatabase(JSON.parse(await readFile(DATA_FILE, 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const fresh = seedDatabase();
    await persist(fresh);
    return fresh;
  }
}

async function persist(value) {
  const tmp = resolve(DATA_DIR, `.workbenches-${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(tmp, DATA_FILE);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=()');
}

function json(res, status, value) {
  headers(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function body(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new DomainError(415, 'json_required', 'JSONで送信してください。');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new DomainError(413, 'too_large', '入力が大きすぎます。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new DomainError(400, 'invalid_json', 'JSONが不正です。'); }
}

function localBoundary(req) {
  let url;
  try { url = new URL(req.url ?? '/', `http://${req.headers.host}`); }
  catch { throw new DomainError(400, 'invalid_host', 'ホストが不正です。'); }
  if (!HOSTS.has(url.hostname) || req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip']) throw new DomainError(403, 'local_only', 'この試作はローカル専用です。');
  if (req.headers.origin && req.headers.origin !== url.origin) throw new DomainError(403, 'cross_origin', '別サイトからは操作できません。');
  if (!['GET', 'HEAD'].includes(req.method ?? 'GET') && req.headers['x-engawa-client'] !== 'local-ui') throw new DomainError(403, 'csrf', 'アプリから操作してください。');
  return url;
}

function sessionId(req) {
  const found = String(req.headers.cookie ?? '').split(';').map((v) => v.trim()).find((v) => v.startsWith('engawa_session='));
  return found?.slice('engawa_session='.length) ?? '';
}

function session(req) {
  const id = sessionId(req); const value = sessions.get(id);
  if (!value) throw new DomainError(401, 'unauthenticated', 'デモユーザーを選んでください。');
  return { id, actor: actorById(value.actorId) };
}

function benchFor(actor, id) {
  return requireReadable(actor, database.benches.find((bench) => bench.id === id));
}

async function mutate(actor, id, transform) {
  const action = writeTail.then(async () => {
    const current = benchFor(actor, id);
    const next = transform(current);
    const nextDb = { ...database, benches: database.benches.map((bench) => bench.id === id ? next : bench) };
    await persist(nextDb);
    database = nextDb;
    emit(id, 'changed', { revision: next.revision });
    return publicBench(actor, next);
  });
  writeTail = action.catch(() => undefined);
  return action;
}

function visibleBenches(actor) {
  return database.benches.filter((bench) => roleFor(actor, bench)).map((bench) => ({ id: bench.id, tenantId: bench.tenantId, title: bench.title, goal: bench.goal, revision: bench.revision, role: roleFor(actor, bench) }));
}

function publicPresence(benchId) {
  return [...presence.values()].filter((p) => p.benchId === benchId && Date.now() - p.updatedAt < 45000).map(({ actorId, name, mode, x, y }) => ({ actorId, name, mode, x, y }));
}

function emit(benchId, kind, data) {
  for (const [sid, responses] of streams) {
    const p = presence.get(sid);
    if (!p || p.benchId !== benchId) continue;
    for (const res of responses) if (!res.destroyed && !res.writableEnded) res.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

function broadcastPresence(benchId) { emit(benchId, 'presence', publicPresence(benchId)); }
function leave(sid) {
  const previous = presence.get(sid)?.benchId;
  presence.delete(sid);
  for (const res of streams.get(sid) ?? []) res.end();
  streams.delete(sid);
  if (previous) broadcastPresence(previous);
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, mode: 'local-only', recording: false, media: 'unconfigured', ai: 'unconfigured' });
  if (req.method === 'GET' && url.pathname === '/api/demo-actors') return json(res, 200, { actors: ACTORS });
  if (req.method === 'POST' && url.pathname === '/api/session') {
    const input = await body(req);
    if (Object.keys(input).some((key) => key !== 'actorId')) throw new DomainError(400, 'unexpected_field', '許可されていない入力項目があります。');
    const actor = actorById(input.actorId);
    const old = sessionId(req); if (old) { leave(old); sessions.delete(old); }
    const id = randomBytes(32).toString('hex'); sessions.set(id, { actorId: actor.id });
    res.setHeader('Set-Cookie', `engawa_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    return json(res, 201, { actor });
  }

  const s = session(req);
  if (req.method === 'DELETE' && url.pathname === '/api/session') {
    leave(s.id); sessions.delete(s.id);
    res.setHeader('Set-Cookie', 'engawa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/bootstrap') return json(res, 200, { actor: s.actor, benches: visibleBenches(s.actor), capabilities: { recording: false, media: false, ai: false } });

  const match = /^\/api\/benches\/([a-z0-9-]+)(?:\/(.*))?$/.exec(url.pathname);
  if (!match) throw new DomainError(404, 'not_found', '見つかりません。');
  const [, benchId, action = ''] = match;
  benchFor(s.actor, benchId);

  if (req.method === 'GET' && !action) return json(res, 200, publicBench(s.actor, benchFor(s.actor, benchId)));
  if (req.method === 'GET' && action === 'handoff') return json(res, 200, handoff(s.actor, benchFor(s.actor, benchId), new Date().toISOString()));
  if (req.method === 'GET' && action === 'presence') return json(res, 200, { participants: publicPresence(benchId) });
  if (req.method === 'POST' && action === 'notes') {
    const input = await body(req);
    return json(res, 201, await mutate(s.actor, benchId, (bench) => addNote(s.actor, bench, input, randomUUID(), new Date().toISOString())));
  }

  const confirm = /^notes\/([a-zA-Z0-9-]+)\/confirm$/.exec(action);
  if (req.method === 'POST' && confirm) {
    const input = await body(req);
    return json(res, 200, await mutate(s.actor, benchId, (bench) => confirmNote(s.actor, bench, confirm[1], input, new Date().toISOString())));
  }

  if (req.method === 'POST' && action === 'join') {
    await body(req);
    leave(s.id);
    presence.set(s.id, { actorId: s.actor.id, name: s.actor.name, benchId, mode: 'knock', x: 50, y: 55, updatedAt: Date.now() });
    broadcastPresence(benchId);
    return json(res, 200, { joined: true });
  }
  if (req.method === 'POST' && action === 'leave') { await body(req); leave(s.id); return json(res, 200, { joined: false }); }
  if (req.method === 'PUT' && action === 'presence') {
    const current = presence.get(s.id);
    if (!current || current.benchId !== benchId) throw new DomainError(409, 'not_joined', '先に作業台へ参加してください。');
    const input = await body(req);
    if (!MODES.includes(input.mode) || !Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > 100 || input.y < 0 || input.y > 100) throw new DomainError(400, 'invalid_presence', '状態または位置が不正です。');
    presence.set(s.id, { ...current, mode: input.mode, x: input.x, y: input.y, updatedAt: Date.now() });
    broadcastPresence(benchId);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && action === 'knock') {
    const current = presence.get(s.id);
    if (!current || current.benchId !== benchId) throw new DomainError(409, 'not_joined', '先に作業台へ参加してください。');
    const input = await body(req);
    const target = [...presence.entries()].find(([, p]) => p.actorId === input.targetActorId && p.benchId === benchId);
    if (!target) throw new DomainError(404, 'not_found', '相手はいません。');
    if (['focus', 'away'].includes(target[1].mode)) throw new DomainError(409, 'do_not_disturb', '相手は集中中または離席中です。');
    for (const receiver of streams.get(target[0]) ?? []) receiver.write(`event: knock\ndata: ${JSON.stringify({ from: s.actor.name })}\n\n`);
    return json(res, 200, { sent: true, microphoneStarted: false });
  }
  if (req.method === 'GET' && action === 'events') {
    const current = presence.get(s.id);
    if (!current || current.benchId !== benchId) throw new DomainError(409, 'not_joined', '先に作業台へ参加してください。');
    headers(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const receivers = streams.get(s.id) ?? new Set(); receivers.add(res); streams.set(s.id, receivers);
    res.write(`event: presence\ndata: ${JSON.stringify(publicPresence(benchId))}\n\n`);
    res.write(`event: changed\ndata: ${JSON.stringify({ revision: benchFor(s.actor, benchId).revision })}\n\n`);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000); heartbeat.unref();
    res.on('close', () => { clearInterval(heartbeat); receivers.delete(res); if (!receivers.size) streams.delete(s.id); });
    return;
  }
  if (action === 'media-token' || action === 'execute') throw new DomainError(503, 'not_configured', '音声・画面配信・AI実行は未接続です。');
  throw new DomainError(404, 'not_found', '見つかりません。');
}

database = await load();
const server = createServer(async (req, res) => {
  try {
    const url = localBoundary(req);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method)) throw new DomainError(405, 'method', '許可されていません。');
    const path = resolve(PUBLIC, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(PUBLIC + sep) || !Object.hasOwn(MIME, extname(path))) throw new DomainError(404, 'not_found', '見つかりません。');
    const content = await readFile(path);
    headers(res); res.writeHead(200, { 'Content-Type': MIME[extname(path)] }); res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (res.headersSent) return res.end();
    const expected = error instanceof DomainError;
    json(res, expected ? error.status : 500, { error: expected ? error.code : 'internal', message: expected ? error.message : '保存または接続に失敗しました。' });
  }
});

setInterval(() => {
  const now = Date.now(); const affected = new Set();
  for (const [sid, p] of presence) if (now - p.updatedAt >= 45000) { presence.delete(sid); affected.add(p.benchId); }
  for (const benchId of affected) broadcastPresence(benchId);
}, 5000).unref();

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('PORT must be 1024-65535');
server.listen(PORT, '127.0.0.1', () => console.log(`ENGAWA local prototype: http://127.0.0.1:${PORT}`));
