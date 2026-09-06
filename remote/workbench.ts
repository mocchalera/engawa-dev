import { DurableObject } from 'cloudflare:workers';
import { addNote, confirmNote, publicBench, handoff, MODES } from '../src/domain.mjs';
import { body, DomainError, failure, json } from './common';
import type { Env, Identity, BenchPolicy } from './types';

type Participant = { identity: Identity; mode: string; x: number; y: number };

export class Workbench extends DurableObject<Env> {
  private connections = new Map<WebSocket, Participant>();
  private limits = new Map<string, { started: number; messages: number; knocks: Map<string, number> }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private benchId = '';
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS work (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS receipts (subject TEXT, request_id TEXT, fingerprint TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(subject, request_id))');
  }
  private directory() { return this.env.DIRECTORY.getByName('policy'); }
  private async authorized(identity: Identity) {
    const policy = await this.directory().authorize(identity, this.benchId);
    if (!policy || identity.expiresAt <= Date.now()) throw new DomainError(404, 'not_found', '作業台が見つかりません。');
    return policy;
  }
  private read(policy: BenchPolicy) {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM work WHERE singleton=1').toArray()[0];
    const stored = row ? JSON.parse(row.value) : { id: policy.id, tenantId: policy.tenantId, notes: [], revision: 0 };
    if (stored.id !== policy.id || stored.tenantId !== policy.tenantId) throw new Error('Workbench binding mismatch');
    return { ...stored, ...policy };
  }
  private remove(socket: WebSocket, code = 1000, reason = 'left') {
    const subject = this.connections.get(socket)?.identity.id;
    this.connections.delete(socket);
    if (subject && ![...this.connections.values()].some((item) => item.identity.id === subject)) this.limits.delete(subject);
    try { socket.close(code, reason); } catch {}
    if (!this.connections.size && this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }
  async disconnect() {
    for (const socket of this.connections.keys()) this.remove(socket, 1008, 'Permissions changed; reconnect');
  }
  private async live() {
    const live: [WebSocket, Participant][] = [];
    for (const [socket, participant] of this.connections) {
      try { await this.authorized(participant.identity); }
      catch { this.remove(socket, 1008, 'Authorization expired'); continue; }
      if (this.connections.has(socket)) live.push([socket, participant]);
    }
    return live;
  }
  private async publish(kind = 'presence', value?: unknown) {
    const live = await this.live();
    const present = live.filter(([socket]) => this.connections.has(socket));
    const participants = [...new Set(present.map(([, participant]) => participant.identity.id))].map((subject) => {
      const group = present.filter(([, participant]) => participant.identity.id === subject).map(([socket]) => this.connections.get(socket)!);
      const participant = group[0];
      const mode = ['focus', 'away', 'knock', 'available'].find((value) => group.some((item) => item.mode === value));
      return { actorId: subject, name: participant.identity.name, mode, x: participant.x, y: participant.y };
    });
    for (const [socket, participant] of live) {
      try {
        await this.authorized(participant.identity);
        if (this.connections.has(socket)) socket.send(JSON.stringify({ kind, actorId: participant.identity.id, data: value ?? participants }));
      } catch { this.remove(socket, 1008, 'Authorization unavailable'); }
    }
  }
  private async message(socket: WebSocket, raw: string | ArrayBuffer) {
    try {
      const participant = this.connections.get(socket);
      if (!participant) return;
      const now = Date.now();
      const limit = this.limits.get(participant.identity.id) ?? { started: now, messages: 0, knocks: new Map<string, number>() };
      if (now - limit.started >= 1000) { limit.started = now; limit.messages = 0; }
      this.limits.set(participant.identity.id, limit);
      if (++limit.messages > 10) throw new DomainError(429, 'message_rate', '操作が続いています。少し待ってください。');
      await this.authorized(participant.identity);
      if (!this.connections.has(socket)) return;
      if (typeof raw !== 'string' || raw.length > 1024) throw new DomainError(400, 'invalid_message', '状態の入力が不正です。');
      const input = JSON.parse(raw);
      if (input?.kind === 'presence' && Object.keys(input).sort().join() === 'kind,mode,x,y' && MODES.includes(input.mode) && Number.isFinite(input.x) && Number.isFinite(input.y) && input.x >= 0 && input.x <= 100 && input.y >= 0 && input.y <= 100) {
        if (!this.connections.has(socket)) return;
        this.connections.set(socket, { ...participant, mode: input.mode, x: input.x, y: input.y });
        await this.publish();
      } else if (input?.kind === 'knock' && Object.keys(input).sort().join() === 'kind,targetActorId') {
        const targets = (await this.live()).filter(([, item]) => item.identity.id === input.targetActorId);
        if (!targets.length || input.targetActorId === participant.identity.id) throw new DomainError(409, 'not_present', 'ノックできる相手はいません。');
        await this.authorized(participant.identity);
        for (const [, target] of targets) await this.authorized(target.identity);
        const currentTargets = [...this.connections].filter(([, item]) => item.identity.id === input.targetActorId);
        if (currentTargets.some(([, item]) => ['focus', 'away'].includes(item.mode))) throw new DomainError(409, 'do_not_disturb', '相手のいずれかの接続が集中中または離席中です。');
        const deliveryTime = Date.now();
        for (const [target, last] of limit.knocks) if (deliveryTime - last >= 3000) limit.knocks.delete(target);
        if (deliveryTime - (limit.knocks.get(input.targetActorId) ?? 0) < 3000) throw new DomainError(429, 'knock_cooldown', '同じ相手へのノックは3秒以上空けてください。');
        if (this.connections.has(socket) && currentTargets.length) {
          limit.knocks.set(input.targetActorId, deliveryTime);
          for (const [targetSocket, target] of targets) if (this.connections.has(targetSocket)) targetSocket.send(JSON.stringify({ kind: 'knock', actorId: target.identity.id, data: { from: participant.identity.name, microphoneStarted: false } }));
        }
      } else throw new DomainError(400, 'invalid_message', '状態の入力が不正です。');
    } catch (error) {
      if (error instanceof DomainError && error.status !== 404) {
        if (this.connections.has(socket)) socket.send(JSON.stringify({ kind: 'error', actorId: this.connections.get(socket)!.identity.id, data: { code: error.code, message: error.message } }));
        if (error.code === 'message_rate') this.remove(socket, 1008, 'Message rate exceeded');
      } else this.remove(socket, 1008, 'Authorization or message invalid');
    }
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const [, , , id, ...parts] = url.pathname.split('/');
      if (this.benchId && this.benchId !== id) throw new Error('Object binding mismatch');
      this.benchId = id;
      const identity: Identity = JSON.parse(request.headers.get('X-Engawa-Identity') ?? 'null');
      const action = parts.join('/');
      const input = request.method === 'POST' ? await body(request) : undefined;
      const policy = await this.authorized(identity);
      if (request.method === 'GET' && action === 'events') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || request.headers.get('origin') !== url.origin) throw new DomainError(400, 'websocket_required', '同じサイトから接続してください。');
        if (this.connections.size >= 50) return json({ error: 'capacity' }, 429);
        if ([...this.connections.values()].filter((item) => item.identity.id === identity.id).length >= 3) return json({ error: 'subject_capacity' }, 429);
        const pair = new WebSocketPair();
        const [client, socket] = Object.values(pair);
        socket.accept();
        this.connections.set(socket, { identity, mode: 'knock', x: 50, y: 55 });
        socket.addEventListener('message', (event) => this.ctx.waitUntil(this.message(socket, event.data)));
        const closed = () => { this.remove(socket); this.ctx.waitUntil(this.publish()); };
        socket.addEventListener('close', closed);
        socket.addEventListener('error', closed);
        if (!this.timer) this.timer = setInterval(() => this.ctx.waitUntil(this.publish()), 5000);
        socket.send(JSON.stringify({ kind: 'changed', actorId: identity.id, data: { revision: this.read(policy).revision } }));
        this.ctx.waitUntil(this.publish());
        return new Response(null, { status: 101, webSocket: client });
      }
      if (request.method === 'GET' && !action) return json(publicBench(identity, this.read(policy)));
      if (request.method === 'GET' && action === 'handoff') return json(handoff(identity, this.read(policy), new Date().toISOString()));
      const confirm = /^notes\/([a-zA-Z0-9-]+)\/confirm$/.exec(action);
      if (request.method === 'POST' && (action === 'notes' || confirm)) {
        const requestId = request.headers.get('Idempotency-Key');
        if (!requestId || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new DomainError(400, 'request_id_required', '保存要求IDが必要です。');
        if (policy.grants[identity.id] === 'viewer') throw new DomainError(403, 'read_only', 'この招待は閲覧専用です。');
        const fingerprint = JSON.stringify({ action, input });
        const next = this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec('DELETE FROM receipts WHERE created < ?', Date.now() - 86400000);
          const receipt = this.ctx.storage.sql.exec<{ fingerprint: string }>('SELECT fingerprint FROM receipts WHERE subject=? AND request_id=?', identity.id, requestId).toArray()[0];
          if (receipt) {
            if (receipt.fingerprint !== fingerprint) throw new DomainError(409, 'idempotency_conflict', '保存要求IDが別の内容に使われています。');
            return this.read(policy);
          }
          if (this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM receipts').one().count >= 1000) throw new DomainError(429, 'receipt_capacity', 'しばらく待ってから保存してください。');
          const current = this.read(policy);
          const next = confirm ? confirmNote(identity, current, confirm[1], input, new Date().toISOString()) : addNote(identity, current, input, crypto.randomUUID(), new Date().toISOString());
          const { grants, ...durable } = next;
          this.ctx.storage.sql.exec('INSERT OR REPLACE INTO work VALUES (1, ?)', JSON.stringify(durable));
          this.ctx.storage.sql.exec('INSERT INTO receipts VALUES (?, ?, ?, ?)', identity.id, requestId, fingerprint, Date.now());
          return next;
        });
        this.ctx.waitUntil(this.publish('changed', { revision: next.revision }));
        return json(publicBench(identity, next), action === 'notes' ? 201 : 200);
      }
      if (action === 'media-token' || action === 'execute') return json({ error: 'not_configured' }, 503);
      return json({ error: 'not_found' }, 404);
    } catch (error) { return failure(error); }
  }
}
