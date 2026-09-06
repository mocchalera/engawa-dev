import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const issuer = 'https://engawa-test.cloudflareaccess.com';
const audience = 'engawa-test-audience';
const origin = 'https://pilot.example';
const initialPolicy = () => ({ revision: 0, members: { atelier: ['owner', 'editor', 'viewer', 'member-only'], studio: ['outsider'] }, benches: [
  { id: 'shared', tenantId: 'atelier', title: 'Fictional shared pilot', goal: 'Resume work', grants: { owner: 'owner', editor: 'editor', viewer: 'viewer' } },
  { id: 'private', tenantId: 'atelier', title: 'Private', goal: '', grants: { owner: 'owner' } },
  { id: 'limits', tenantId: 'atelier', title: 'Fictional socket limits', goal: '', grants: { owner: 'owner', editor: 'editor' } },
  { id: 'other-tenant', tenantId: 'studio', title: 'Other tenant', goal: '', grants: { outsider: 'owner' } }
] });

test('Cloudflare runtime: verified identity, SQLite work, ephemeral sockets and negative boundaries', { timeout: 60000 }, async (context) => {
  const directory = await mkdtemp(`${tmpdir()}/engawa-remote-`);
  const keys = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'pilot-test', alg: 'RS256', use: 'sig' };
  const sign = (subject, overrides = {}, signingKey = keys.privateKey) => new SignJWT({ type: 'app', email: `${subject}@example.invalid`, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'pilot-test' }).setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime('10m').sign(signingKey);
  const tokens = Object.fromEntries(await Promise.all(['owner', 'editor', 'viewer', 'outsider', 'member-only'].map(async (subject) => [subject, await sign(subject)])));
  await build({ entryPoints: ['tests/remote-harness.ts'], bundle: true, format: 'esm', outfile: `${directory}/worker.mjs`, external: ['cloudflare:workers'], platform: 'browser' });
  const options = {
    name: 'engawa-test', modules: true, script: await readFile(`${directory}/worker.mjs`, 'utf8'), compatibilityDate: '2026-09-05',
    durableObjects: { DIRECTORY: { className: 'Directory', useSQLite: true }, WORKBENCHES: { className: 'Workbench', useSQLite: true } },
    bindings: { ACCESS_ISSUER: issuer, ACCESS_AUD: audience, ADMIN_SUBJECTS: 'owner' },
    serviceBindings: { ASSETS: async (request) => {
      const pathname = new URL(request.url).pathname;
      if (!['/', '/app.js', '/style.css'].includes(pathname)) return new MFResponse('not found', { status: 404 });
      return new MFResponse(await readFile(`remote/public/${pathname === '/' ? 'index.html' : pathname.slice(1)}`), { headers: { 'Content-Type': pathname === '/' ? 'text/html' : pathname === '/app.js' ? 'text/javascript' : 'text/css' } });
    } },
    outboundService: async (request) => {
      assert.equal(request.url, `${issuer}/cdn-cgi/access/certs`);
      return MFResponse.json({ keys: [jwk] });
    }
  };
  const runtimeOptions = { ...convertV4MiniflareOptions(options), resourcePersistencePath: `${directory}/state` };
  let runtime = new Miniflare(runtimeOptions);
  const sockets = [];
  const request = (path, subject = 'owner', method = 'GET', value, extra = {}) => runtime.dispatchFetch(origin + path, { method, headers: { 'Cf-Access-Jwt-Assertion': tokens[subject] ?? subject, Origin: origin, 'Content-Type': 'application/json', 'X-Engawa-Client': 'remote-ui', ...extra }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const connect = async (subject, bench = 'shared') => {
    const response = await request(`/api/benches/${bench}/events`, subject, 'GET', undefined, { Upgrade: 'websocket' });
    assert.equal(response.status, 101);
    const socket = response.webSocket, messages = [];
    socket.addEventListener('message', (event) => messages.push(JSON.parse(event.data)));
    socket.accept(); sockets.push(socket);
    return { socket, messages };
  };
  const until = async (predicate, description) => {
    const deadline = Date.now() + 8000;
    while (!predicate()) { if (Date.now() >= deadline) assert.fail(`Timed out: ${description}`); await new Promise((resolve) => setTimeout(resolve, 20)); }
  };
  try {
    await context.test('signed identity required, audience/issuer/signature/expiry and actor spoofing rejected', async () => {
      assert.equal((await runtime.dispatchFetch(origin + '/api/bootstrap')).status, 401);
      assert.equal((await request('/api/bootstrap', 'not-a-jwt')).status, 401);
      const wrongKeys = await generateKeyPair('RS256');
      assert.equal((await request('/api/bootstrap', await sign('owner', {}, wrongKeys.privateKey))).status, 401);
      for (const patch of [{ aud: 'wrong' }, { iss: 'https://wrong.example' }, { exp: 1 }, { nbf: Math.floor(Date.now() / 1000) + 60 }]) {
        const token = await new SignJWT({ sub: 'owner', type: 'app', email: 'owner@example.invalid', iss: issuer, aud: audience, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...patch }).setProtectedHeader({ alg: 'RS256', kid: 'pilot-test' }).sign(keys.privateKey);
        assert.equal((await request('/api/bootstrap', token)).status, 401);
      }
      assert.equal((await request('/api/session', 'owner', 'POST', { actorId: 'owner' })).status, 404);
      assert.equal((await request('/api/demo-actors')).status, 404);
      assert.equal((await request('/api/bootstrap', 'viewer', 'GET', undefined, { 'X-Engawa-Identity': JSON.stringify({ id: 'owner' }) })).status, 200);
      assert.equal((await (await request('/api/bootstrap', 'viewer')).json()).actor.id, 'viewer');
    });
    await context.test('admin provisioning, CSRF, membership plus object grants and immutable tenant binding', async () => {
      assert.equal((await request('/api/policy', 'editor')).status, 403);
      assert.equal((await (await request('/api/policy')).json()).revision, 0);
      assert.equal((await request('/api/policy', 'editor', 'PUT', initialPolicy())).status, 403);
      assert.equal((await request('/api/policy', 'owner', 'PUT', initialPolicy(), { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await request('/api/policy', 'owner', 'PUT', initialPolicy())).status, 200);
      assert.equal((await request('/api/policy', 'owner', 'PUT', initialPolicy())).status, 409);
      for (const subject of ['outsider', 'member-only']) {
        assert.equal((await request('/api/benches/shared', subject)).status, 404);
        assert.equal((await request('/api/benches/shared/events', subject, 'GET', undefined, { Upgrade: 'websocket' })).status, 404);
        assert.equal((await request('/api/benches/shared/handoff', subject)).status, 404);
      }
      assert.equal((await request('/api/benches/private', 'viewer')).status, 404);
      assert.equal((await request('/api/benches/private', 'viewer', 'GET', undefined, { 'X-Engawa-Identity': JSON.stringify({ id: 'owner', expiresAt: Date.now() + 60000 }) })).status, 404);
      assert.equal((await request('/api/benches/other-tenant', 'owner')).status, 404);
      assert.deepEqual((await (await request('/api/bootstrap', 'viewer')).json()).benches.map((bench) => bench.id), ['shared']);
      const moved = initialPolicy(); moved.revision = 1; moved.benches[0].tenantId = 'studio'; moved.benches[0].grants = { outsider: 'owner' };
      assert.equal((await request('/api/policy', 'owner', 'PUT', moved)).status, 409);
      assert.equal((await (await request('/api/policy')).json()).revision, 1);
    });
    await context.test('gateway rejects before allocating a workbench and catches transport rejection', async () => {
      for (const [subject, bench] of [['outsider', 'shared'], ['owner', 'unknown-bench']]) {
        assert.deepEqual(await (await request(`/__test/gateway?bench=${bench}`, subject)).json(), { allocations: 0, status: 404 });
      }
      assert.deepEqual(await (await request('/__test/gateway?bench=shared')).json(), { allocations: 1, status: 503 });
    });
    await context.test('expected actor is a precondition, never an authentication override', async () => {
      const before = await (await request('/api/benches/shared')).json();
      assert.equal((await request('/api/benches/shared', 'editor', 'GET', undefined, { 'X-Engawa-Actor': 'owner' })).status, 401);
      assert.equal((await request('/api/benches/shared/notes', 'editor', 'POST', { text: 'wrong session', kind: 'question', baseRevision: 0 }, { 'X-Engawa-Actor': 'owner', 'Idempotency-Key': 'wrong-session-request-0001' })).status, 401);
      assert.deepEqual(await (await request('/api/benches/shared')).json(), before);
      assert.equal((await request('/api/benches/shared', 'editor', 'GET', undefined, { 'X-Engawa-Actor': 'editor' })).status, 200);
    });
    await context.test('subject socket cap, unique people, conservative focus, knock cooldown and message budget', async () => {
      const owners = await Promise.all([connect('owner', 'limits'), connect('owner', 'limits'), connect('owner', 'limits')]);
      assert.equal((await request('/api/benches/limits/events', 'owner', 'GET', undefined, { Upgrade: 'websocket' })).status, 429);
      const editors = await Promise.all([connect('editor', 'limits'), connect('editor', 'limits')]);
      await until(() => owners[0].messages.some((message) => message.kind === 'presence' && message.data.length === 2), 'two subjects, five connections');
      assert.ok(owners[0].messages.every((message) => message.actorId === 'owner'));
      editors[1].socket.send(JSON.stringify({ kind: 'presence', mode: 'focus', x: 50, y: 55 }));
      await until(() => owners[0].messages.some((message) => message.kind === 'presence' && message.data.some((person) => person.actorId === 'editor' && person.mode === 'focus')), 'any connection focus');
      owners[0].socket.send(JSON.stringify({ kind: 'knock', targetActorId: 'editor' }));
      await until(() => owners[0].messages.some((message) => message.data.code === 'do_not_disturb'), 'subject focus refuses');
      assert.ok(editors.every((connection) => !connection.messages.some((message) => message.kind === 'knock')));
      editors[1].socket.send(JSON.stringify({ kind: 'presence', mode: 'knock', x: 50, y: 55 }));
      await until(() => owners[0].messages.filter((message) => message.kind === 'presence').at(-1)?.data.find((person) => person.actorId === 'editor')?.mode === 'knock', 'focus cleared');
      owners[0].socket.send(JSON.stringify({ kind: 'knock', targetActorId: 'editor' }));
      await until(() => editors.every((connection) => connection.messages.some((message) => message.kind === 'knock')), 'deliver to both eligible connections');
      owners[1].socket.send(JSON.stringify({ kind: 'knock', targetActorId: 'editor' }));
      await until(() => owners[1].messages.some((message) => message.data.code === 'knock_cooldown'), 'cooldown shared by sender subject');
      assert.ok(editors.every((connection) => connection.messages.filter((message) => message.kind === 'knock').length === 1));
      await new Promise((resolve) => setTimeout(resolve, 3050));
      owners[1].socket.send(JSON.stringify({ kind: 'knock', targetActorId: 'editor' }));
      await until(() => editors.every((connection) => connection.messages.filter((message) => message.kind === 'knock').length === 2), 'cooldown ends');
      for (let index = 0; index < 12; index++) owners[2].socket.send(JSON.stringify({ kind: 'presence', mode: 'knock', x: 50, y: 55 }));
      await until(() => owners[2].messages.some((message) => message.data.code === 'message_rate'), 'subject message budget');
      await until(() => owners[2].socket.readyState >= 2, 'over-budget socket closed');
      for (const connection of [...owners, ...editors]) connection.socket.close();
    });
    const owner = await connect('owner'), editor = await connect('editor'), outsider = await connect('outsider', 'other-tenant');
    await context.test('WebSocket presence/knock, focus refusal and scope-limited notifications', async () => {
      await until(() => owner.messages.some((message) => message.kind === 'presence' && message.data.length === 2), 'two participants');
      editor.socket.send(JSON.stringify({ kind: 'presence', mode: 'focus', x: 20, y: 30 }));
      await until(() => owner.messages.some((message) => message.kind === 'presence' && message.data.some((person) => person.mode === 'focus')), 'focus');
      owner.socket.send(JSON.stringify({ kind: 'knock', targetActorId: 'editor' }));
      await until(() => owner.messages.some((message) => message.kind === 'error'), 'focus rejects knock');
      editor.socket.send(JSON.stringify({ kind: 'knock', targetActorId: 'owner' }));
      await until(() => owner.messages.some((message) => message.kind === 'knock'), 'knock');
      assert.equal(outsider.messages.some((message) => message.kind === 'presence' && message.data.some((person) => person.actorId !== 'outsider')), false);
    });
    let saved;
    const data = { kind: 'decision', text: 'Fictional runtime note', baseRevision: 0 }, requestId = 'runtime-save-request-0001';
    await context.test('draft, viewer denial, revision conflict, atomic idempotency and explicit confirmation', async () => {
      assert.equal((await request('/api/benches/shared/notes', 'viewer', 'POST', data, { 'Idempotency-Key': requestId })).status, 403);
      assert.equal((await request('/api/benches/shared/notes', 'editor', 'POST', { ...data, status: 'confirmed' }, { 'Idempotency-Key': requestId })).status, 400);
      saved = await (await request('/api/benches/shared/notes', 'editor', 'POST', data, { 'Idempotency-Key': requestId })).json();
      assert.equal(saved.notes[0].status, 'draft');
      const duplicate = await (await request('/api/benches/shared/notes', 'editor', 'POST', data, { 'Idempotency-Key': requestId })).json();
      assert.equal(duplicate.revision, 1); assert.equal(duplicate.notes.length, 1);
      assert.equal((await request('/api/benches/shared/notes', 'editor', 'POST', { ...data, text: 'different' }, { 'Idempotency-Key': requestId })).status, 409);
      assert.equal((await request('/api/benches/shared/notes', 'editor', 'POST', data, { 'Idempotency-Key': 'runtime-stale-request-0002' })).status, 409);
      const confirm = `/api/benches/shared/notes/${saved.notes[0].id}/confirm`;
      assert.equal((await request(confirm, 'editor', 'POST', { baseRevision: 1 }, { 'Idempotency-Key': 'runtime-confirm-request-0003' })).status, 403);
      assert.equal((await request(confirm, 'owner', 'POST', { baseRevision: 1 }, { 'Idempotency-Key': 'runtime-confirm-request-0003' })).status, 200);
      assert.equal((await (await request('/api/benches/shared/handoff')).json()).authority.executionAuthorized, false);
      await until(() => owner.messages.some((message) => message.kind === 'changed' && message.data.revision === 2), 'confirmed notification');
      assert.equal(outsider.messages.some((message) => message.kind === 'changed' && message.data.revision > 0), false);
    });
    await context.test('actual SQLite failure rolls back note and receipt; retry succeeds without phantom notification', async () => {
      await request('/__test/fail?on=1');
      const next = { ...data, text: 'Recovery', baseRevision: 2 }, headers = { 'Idempotency-Key': 'runtime-retry-request-0004' };
      assert.equal((await request('/api/benches/shared/notes', 'editor', 'POST', next, headers)).status, 503);
      assert.equal((await (await request('/api/benches/shared')).json()).revision, 2);
      assert.equal(owner.messages.some((message) => message.kind === 'changed' && message.data.revision === 3), false);
      await request('/__test/fail?on=0');
      assert.equal((await request('/api/benches/shared/notes', 'editor', 'POST', next, headers)).status, 201);
      const stored = await (await request('/__test/inspect')).json();
      assert.equal(stored.receipts.length, 3);
      assert.doesNotMatch(JSON.stringify(stored), /expiresAt|updatedAt|"mode"|"x"|"y"|example.invalid/);
    });
    await context.test('grant and membership revocation close existing sockets, forbid writes and reconnects', async () => {
      const policy = initialPolicy(); policy.revision = 1; delete policy.benches[0].grants.editor;
      assert.equal((await request('/api/policy', 'owner', 'PUT', policy)).status, 200);
      await until(() => editor.socket.readyState >= 2, 'revoked socket closed');
      assert.equal((await request('/api/benches/shared', 'editor')).status, 404);
      assert.equal((await request('/api/benches/shared/events', 'editor', 'GET', undefined, { Upgrade: 'websocket' })).status, 404);
      assert.equal((await request('/api/benches/shared/notes', 'editor', 'POST', data, { 'Idempotency-Key': requestId })).status, 404);
      const viewer = await connect('viewer');
      policy.revision = 2; policy.members.atelier = policy.members.atelier.filter((subject) => subject !== 'viewer'); delete policy.benches[0].grants.viewer;
      assert.equal((await request('/api/policy', 'owner', 'PUT', policy)).status, 200);
      await until(() => viewer.socket.readyState >= 2, 'membership revoked');
      assert.equal((await request('/api/benches/shared', 'viewer')).status, 404);
    });
    await context.test('JWT expiration closes an idle existing socket and prevents reconnection', async () => {
      const token = await new SignJWT({ type: 'app', email: 'owner@example.invalid' }).setProtectedHeader({ alg: 'RS256', kid: 'pilot-test' }).setIssuer(issuer).setAudience(audience).setSubject('owner').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + 2).sign(keys.privateKey);
      const expiring = await connect(token);
      await until(() => expiring.socket.readyState >= 2, 'expiry timer');
      assert.equal((await request('/api/benches/shared/events', token, 'GET', undefined, { Upgrade: 'websocket' })).status, 401);
    });
    await context.test('runtime restart restores durable work and policy, never presence; reconnect fetches latest revision', async () => {
      for (const socket of sockets) { try { socket.close(); } catch {} }
      await runtime.dispose(); runtime = new Miniflare(runtimeOptions);
      const restored = await (await request('/api/benches/shared')).json();
      assert.equal(restored.revision, 3); assert.equal(restored.notes[0].status, 'confirmed');
      assert.equal((await request('/api/benches/shared', 'editor')).status, 404);
      const fresh = await connect('owner');
      await until(() => fresh.messages.some((message) => message.kind === 'presence'), 'fresh presence');
      assert.equal(fresh.messages.find((message) => message.kind === 'presence').data.length, 1);
      assert.ok(fresh.messages.some((message) => message.kind === 'changed' && message.data.revision === 3));
    });
    await context.test('restart retains subject-bound save and confirmation receipts without bypassing revocation', async () => {
      const headers = { 'Idempotency-Key': requestId };
      assert.equal((await request('/api/benches/shared/notes', 'editor', 'POST', data, headers)).status, 404);
      assert.equal((await request('/api/benches/shared/notes', 'owner', 'POST', data, headers)).status, 409);
      const policy = await (await request('/api/policy')).json();
      policy.benches.find((bench) => bench.id === 'shared').grants.editor = 'editor';
      assert.equal((await request('/api/policy', 'owner', 'PUT', policy)).status, 200);
      const before = await (await request('/__test/inspect')).json();
      const restored = await (await request('/api/benches/shared', 'editor')).json();
      const duplicate = await request('/api/benches/shared/notes', 'editor', 'POST', data, headers);
      assert.equal(duplicate.status, 201);
      assert.deepEqual(await duplicate.json(), restored);
      const changed = await request('/api/benches/shared/notes', 'editor', 'POST', { ...data, text: 'Changed retry after restart' }, headers);
      assert.equal(changed.status, 409);
      assert.equal((await changed.json()).error, 'idempotency_conflict');
      const recovery = await request('/api/benches/shared/notes', 'editor', 'POST', { ...data, text: 'Recovery', baseRevision: 2 }, { 'Idempotency-Key': 'runtime-retry-request-0004' });
      assert.equal(recovery.status, 201);
      assert.deepEqual(await recovery.json(), restored);
      const confirmed = await request(`/api/benches/shared/notes/${saved.notes[0].id}/confirm`, 'owner', 'POST', { baseRevision: 1 }, { 'Idempotency-Key': 'runtime-confirm-request-0003' });
      assert.equal(confirmed.status, 200);
      assert.equal((await confirmed.json()).revision, restored.revision);
      assert.deepEqual(await (await request('/__test/inspect')).json(), before);
      assert.equal((await (await request('/api/benches/shared/handoff')).json()).authority.executionAuthorized, false);
    });
    await context.test('remote static build has no actor picker and all assets require identity', async () => {
      assert.equal((await runtime.dispatchFetch(origin + '/')).status, 401);
      assert.equal((await runtime.dispatchFetch(origin + '/app.js')).status, 401);
      assert.doesNotMatch(await (await request('/')).text(), /id="actor"|id="login"|デモユーザー|value="aoi"/);
      assert.doesNotMatch(await (await request('/app.js')).text(), /demo-actors|\/api\/session/);
    });
  } finally {
    for (const socket of sockets) { try { socket.close(); } catch {} }
    await runtime.dispose(); await rm(directory, { recursive: true, force: true });
  }
});
