/** Isolated Town rollout. Existing pilot and its data are not replaced. */
import { DurableObject } from 'cloudflare:workers';
import { authenticate } from '../remote/auth';
import type { Env, Identity } from '../remote/types';
import { Town, TownError } from './core.mjs';
import { TABLE_SQL, decodeRows, writeChanges } from './storage.mjs';
export { Directory } from '../remote/directory';
export { Workbench } from '../remote/workbench';
type TownEnv = Env & { TOWN: DurableObjectNamespace<TownRuntime>; GUEST_SUBJECTS?: string };
type Client = { controller: ReadableStreamDefaultController; identity: Identity; room: string; epoch: number };
const encoder = new TextEncoder();
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'microphone=(), camera=(), display-capture=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const failure = (e: unknown) => {
  const error = e as { status?: number; code?: string; message?: string };
  const known = Number.isInteger(error.status) && Number(error.status) >= 400 && Number(error.status) < 600;
  return json({ error: known ? error.code : 'unavailable', message: known ? error.message : '保存または権限を確認できません。入力を保ったまま接続を確認してください。' }, known ? error.status : 503);
};
async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new TownError(415, 'json_required', 'JSONが必要です。');
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) { await reader.cancel(); throw new TownError(413, 'too_large', '入力が大きすぎます。'); } chunks.push(part.value); }
  const all = new Uint8Array(size); let offset = 0; for (const c of chunks) { all.set(c, offset); offset += c.length; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new TownError(400, 'invalid_json', '入力形式が不正です。'); }
}
export class TownRuntime extends DurableObject<TownEnv> {
  private town: Town;
  private clients = new Set<Client>();
  private epoch = 0;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sweep: ReturnType<typeof setInterval> | undefined;
  constructor(ctx: DurableObjectState, env: TownEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(TABLE_SQL);
    const rows = ctx.storage.sql.exec<{ kind: string; owner: string; id: string; value: string }>('SELECT kind,owner,id,value FROM town_records ORDER BY rowid').toArray();
    this.town = new Town(decodeRows(rows));
  }
  private async context(identity: Identity) {
    if (!identity?.id || identity.expiresAt <= Date.now()) throw new TownError(401, 'session_expired', 'ログインの有効期限が切れました。');
    const places = await this.env.DIRECTORY.getByName('policy').bootstrap(identity);
    const guest = (this.env.GUEST_SUBJECTS ?? '').split(',').map(s => s.trim()).includes(identity.id);
    return { actor: { ...identity, guest }, places };
  }
  async disconnect() {
    this.epoch++; this.town.invalidate();
    for (const client of this.clients) { try { client.controller.enqueue(encoder.encode('event: revoked\ndata: {}\n\n')); client.controller.close(); } catch {} }
    this.clients.clear(); this.stopTimers();
  }
  private stopTimers() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.sweep !== undefined) clearInterval(this.sweep);
    this.timer = undefined; this.sweep = undefined;
  }
  private async emit(client: Client, full = true) {
    try {
      const context = await this.context(client.identity);
      if (client.epoch !== this.epoch || !this.clients.has(client)) return;
      const snapshot = full ? this.town.read(context, client.room) : this.town.presenceSnapshot(context, client.room);
      if ((client.controller.desiredSize ?? 1) <= 0) throw new Error('Slow client');
      client.controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
    } catch {
      try { client.controller.enqueue(encoder.encode('event: revoked\ndata: {}\n\n')); client.controller.close(); } catch {}
      this.clients.delete(client); if (!this.clients.size) this.stopTimers();
    }
  }
  private publish(full = false) {
    this.dirty ||= full;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; const full = this.dirty; this.dirty = false; this.ctx.waitUntil(Promise.all([...this.clients].map(c => this.emit(c, full))).then(() => {})); }, 100);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const identity = JSON.parse(request.headers.get('X-Engawa-Town-Identity') ?? 'null') as Identity;
      const context = await this.context(identity); const url = new URL(request.url); const room = url.searchParams.get('room') || '';
      if (url.pathname === '/api/town/events' && request.method === 'GET') {
        this.town.read(context, room);
        if (this.clients.size >= 100 || [...this.clients].filter(c => c.identity.id === identity.id).length >= 3) throw new TownError(429, 'connections', '接続数の上限です。他のタブを閉じてください。');
        let client: Client;
        const stream = new ReadableStream({
          start: controller => { client = { controller, identity, room, epoch: this.epoch }; this.clients.add(client); this.ctx.waitUntil(this.emit(client)); },
          cancel: () => { this.clients.delete(client); if (!this.clients.size) this.stopTimers(); }
        });
        this.sweep ??= setInterval(() => this.publish(), 5000);
        return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream' } });
      }
      if (url.pathname !== '/api/town') return json({ error: 'not_found' }, 404);
      if (request.method === 'GET') return json(this.town.read(context, room, url.searchParams.get('q') || ''));
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      const input = await readBody(request);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TownError(400, 'invalid_input', '操作の形式が不正です。');
      // Refresh authorization after reading the body; do not trust caller-supplied roles.
      const fresh = await this.context(identity); let result;
      if (['join', 'leave', 'move', 'mode', 'gesture', 'heartbeat'].includes(input.op)) { this.town.live(fresh, input); result = { ok: true }; }
      else if (input.op === 'whisper') result = this.town.whisper(fresh, input);
      else {
        const prepared = this.town.prepare(fresh, input);
        if (prepared.state) this.ctx.storage.transactionSync(() => writeChanges((sql: string, ...args: string[]) => this.ctx.storage.sql.exec(sql, ...args), this.town.durable(), prepared.state));
        result = this.town.commit(prepared);
      }
      this.publish(!['join','leave','move','mode','gesture','heartbeat','whisper'].includes(input.op)); return json(result);
    } catch (e) { return failure(e); }
  }
}
export default {
  async fetch(request: Request, env: TownEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) throw new TownError(403, 'cross_origin', '別のサイトからは操作できません。');
      const identity = await authenticate(request, env);
      const expected = request.headers.get('X-Engawa-Actor') || url.searchParams.get('actor');
      if (expected && expected !== identity.id) throw new TownError(401, 'identity_changed', 'ログインした本人が変わりました。');
      if (!['GET', 'HEAD'].includes(request.method) && (request.headers.get('origin') !== url.origin || request.headers.get('X-Engawa-Client') !== 'town-ui' || expected !== identity.id)) throw new TownError(403, 'csrf', '本人確認済みのアプリから操作してください。');
      const directory = env.DIRECTORY.getByName('policy');
      if (url.pathname === '/api/policy' && request.method === 'GET') { const result = await directory.inspectPolicy(identity); return json(result.policy ?? { error: result.error }, result.status); }
      if (url.pathname === '/api/policy' && request.method === 'PUT') {
        const result = await directory.replace(identity, await readBody(request));
        if (result.status !== 200) return json(result, result.status);
        await env.TOWN.getByName('town').disconnect();
        return json({ revision: result.revision });
      }
      if (['/api/town', '/api/town/events'].includes(url.pathname)) {
        // Fresh internal headers only. Client headers, cookies and JWT never reach the DO.
        const forwarded = new Headers({ 'X-Engawa-Town-Identity': JSON.stringify(identity) });
        if (request.headers.has('content-type')) forwarded.set('Content-Type', request.headers.get('content-type')!);
        return await env.TOWN.getByName('town').fetch(new Request(request, { headers: forwarded }));
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/local/')) return json({ error: 'not_found' }, 404);
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'method' }, 405);
      const asset = await env.ASSETS.fetch(request); const response = new Response(asset.body, asset);
      for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      return response;
    } catch (e) { return failure(e); }
  }
} satisfies ExportedHandler<TownEnv>;
