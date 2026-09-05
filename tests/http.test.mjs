import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

test('real HTTP/SSE: collaboration, isolation, conflicts and restart recovery', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(`${tmpdir()}/engawa-http-`);
  const port = 18000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  let server;
  const start = async () => {
    server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), ENGAWA_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    await once(server.stdout, 'data');
  };
  const stop = async () => { const exited = once(server, 'exit'); server.kill(); await exited; };
  const request = (path, cookie = '', method = 'GET', value) => fetch(base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Engawa-Client': 'local-ui' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const login = async (actorId) => (await request('/api/session', '', 'POST', { actorId })).headers.get('set-cookie').split(';')[0];
  const abort = new AbortController();
  try {
    await start();
    const owner = await login('aoi'), editor = await login('ren'), viewer = await login('nagi'), outsider = await login('sora');
    const path = '/api/benches/first-release';
    assert.equal((await request(path, outsider)).status, 404);
    assert.equal((await request('/api/benches/private-sketch', viewer)).status, 404);
    assert.equal((await request(path + '/notes', viewer, 'POST', { kind: 'task', text: 'no', baseRevision: 1 })).status, 403);
    for (const cookie of [owner, editor]) assert.equal((await request(path + '/join', cookie, 'POST', {})).status, 200);
    const stream = await fetch(base + path + '/events', { headers: { Cookie: owner }, signal: abort.signal });
    const reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: presence/);
    assert.equal((await request(path + '/events', outsider)).status, 404);
    await request(path + '/presence', editor, 'PUT', { mode: 'focus', x: 50, y: 55 });
    assert.equal((await request(path + '/knock', owner, 'POST', { targetActorId: 'ren' })).status, 409);
    await request(path + '/presence', editor, 'PUT', { mode: 'knock', x: 50, y: 55 });
    assert.equal((await request(path + '/knock', editor, 'POST', { targetActorId: 'aoi' })).status, 200);
    const created = await request(path + '/notes', editor, 'POST', { kind: 'decision', text: 'HTTP integration draft', baseRevision: 1 });
    assert.equal(created.status, 201);
    const board = await created.json();
    assert.equal(board.notes.at(-1).status, 'draft');
    assert.equal((await request(path + '/notes', editor, 'POST', { kind: 'task', text: 'stale', baseRevision: 1 })).status, 409);
    const confirm = path + `/notes/${board.notes.at(-1).id}/confirm`;
    assert.equal((await request(confirm, editor, 'POST', { baseRevision: 2 })).status, 403);
    assert.equal((await request(confirm, owner, 'POST', { baseRevision: 2 })).status, 200);
    let events = '';
    while (!events.includes('"revision":3')) events += new TextDecoder().decode((await reader.read()).value);
    assert.match(events, /event: knock/);
    assert.equal((await (await request(path + '/handoff', owner)).json()).authority.executionAuthorized, false);
    abort.abort();
    await stop(); await start();
    const resumed = await login('aoi');
    assert.equal((await (await request(path, resumed)).json()).notes.at(-1).status, 'confirmed');
    assert.deepEqual((await (await request(path + '/presence', resumed)).json()).participants, []);
    const stored = await readFile(`${directory}/workbenches.json`, 'utf8');
    assert.doesNotMatch(stored, /updatedAt|connectionId|"mode"/);
  } finally {
    abort.abort();
    if (server?.exitCode === null) await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
