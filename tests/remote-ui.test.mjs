import test from 'node:test';
import assert from 'node:assert/strict';
import { createUI, bench, packet, response, settle } from './remote-ui-harness.mjs';

test('R1a: delayed A handoff cannot open over another tenant B', async () => {
  const ui = await createUI();
  const pending = ui.hold('/api/benches/a/handoff');
  const action = ui.click('handoff');
  await ui.select('b');
  pending.resolve(response(packet('a'))); await action;
  assert.equal(ui.element('active-title').textContent, 'Workbench b');
  assert.equal(ui.element('dialog').open, false);
  assert.equal(ui.element('handoff-text').textContent, '');
});

test('R1b: selection closes and clears already-open handoff', async () => {
  const ui = await createUI();
  await ui.click('handoff');
  assert.equal(ui.element('dialog').open, true);
  await ui.select('b');
  assert.equal(ui.element('dialog').open, false);
  assert.equal(ui.element('handoff-text').textContent, '');
});

test('R1c: rejected old close refresh cannot hide B', async () => {
  const ui = await createUI();
  ui.click('join'); ui.sockets[0].open();
  const pending = ui.hold('/api/benches/a');
  ui.sockets[0].close(1006);
  await ui.select('b');
  pending.reject(new Error('late A network failure')); await settle();
  assert.equal(ui.element('active-title').textContent, 'Workbench b');
  assert.equal(ui.element('workspace').hidden, false);
});

test('R2a: acknowledging snapshot A preserves newer input B', async () => {
  const ui = await createUI();
  ui.input('snapshot A');
  const pending = ui.hold('/api/benches/a/notes', 'POST');
  const action = ui.submit();
  await settle(); ui.input('new text B');
  pending.resolve(response(bench('a', 1))); await action;
  assert.equal(ui.element('note-text').value, 'new text B');
});

test('R2b: unsent draft restores only on its original workbench', async () => {
  const ui = await createUI();
  ui.input('private A draft', 'decision');
  await ui.select('b');
  assert.equal(ui.element('note-text').value, '');
  await ui.select('a');
  assert.equal(ui.element('note-text').value, 'private A draft');
  assert.equal(ui.element('kind').value, 'decision');
});

test('bootstrap success and catch are fenced by session epoch', async () => {
  for (const failure of [false, true]) {
    const ui = await createUI();
    const first = ui.hold('/api/bootstrap'); const oldLoad = ui.click('reload');
    ui.identity({ id: 'editor', name: 'New identity' }); await ui.click('reload');
    if (failure) first.reject(new Error('old bootstrap failed'));
    else first.resolve(response({ actor: { id: 'owner', name: 'Old identity' }, benches: [bench('a')] }));
    await oldLoad;
    assert.equal(ui.element('identity').textContent, 'New identity');
    assert.equal(ui.element('workspace').hidden, false);
    assert.doesNotMatch(ui.element('toast').textContent, /old bootstrap/);
  }
});

test('delayed selection read, socket callbacks and handoff failure cannot change new selection', async () => {
  const ui = await createUI();
  ui.click('join'); const socket = ui.sockets[0]; socket.open();
  const handoff = ui.hold('/api/benches/a/handoff'); const action = ui.click('handoff');
  const selected = ui.hold('/api/benches/b'); await ui.select('b'); await ui.select('a');
  ui.input('current draft');
  socket.onopen(); socket.message('changed', { revision: 99 }); socket.onclose();
  selected.resolve(response(bench('b', 12))); handoff.reject(new Error('late old handoff')); await action; await settle();
  assert.equal(ui.element('active-title').textContent, 'Workbench a');
  assert.equal(ui.element('note-text').value, 'current draft');
  assert.equal(ui.element('mode').disabled, true);
  assert.doesNotMatch(ui.element('toast').textContent, /late old handoff/);
});

test('handoff response validates tenant binding, and explicit close invalidates pending open', async () => {
  const ui = await createUI();
  const wrong = ui.hold('/api/benches/a/handoff'); const action = ui.click('handoff');
  wrong.resolve(response(packet('b'))); await action;
  assert.equal(ui.element('dialog').open, false);
  const late = ui.hold('/api/benches/a/handoff'); const pending = ui.click('handoff');
  ui.click('close'); late.resolve(response(packet())); await pending;
  assert.equal(ui.element('dialog').open, false);
});

test('save acknowledgement requires draft version, not just equal text after intervening edits', async () => {
  const ui = await createUI(); ui.input('A');
  const ack = ui.hold('/api/benches/a/notes', 'POST'); const action = ui.submit();
  ui.input('B'); ui.input('A'); ack.resolve(response(bench('a', 1))); await action;
  assert.equal(ui.element('note-text').value, 'A');
});

test('old save success, catch and finally do not clear B or unlock its pending mutation', async () => {
  for (const failure of [false, true]) {
    const ui = await createUI(); ui.input('A');
    const ackA = ui.hold('/api/benches/a/notes', 'POST'); const actionA = ui.submit();
    await ui.select('b'); ui.input('B');
    const ackB = ui.hold('/api/benches/b/notes', 'POST'); const actionB = ui.submit();
    if (failure) ackA.reject(new Error('old save failed')); else ackA.resolve(response(bench('a', 1)));
    await actionA;
    assert.equal(ui.element('save').disabled, true);
    assert.equal(ui.element('note-text').value, 'B');
    assert.doesNotMatch(ui.element('toast').textContent, /old save/);
    ackB.resolve(response(bench('b', 1))); await actionB;
  }
});

test('lost save acknowledgement survives selection and reauthentication; only explicit exact replay resolves it', async () => {
  const ui = await createUI(); ui.input('original snapshot', 'decision');
  const lost = ui.hold('/api/benches/a/notes', 'POST'); const action = ui.submit();
  lost.reject(new Error('ack lost')); await action;
  const original = ui.requests.find((request) => request.method === 'POST');
  ui.input('new intent'); await ui.select('b'); await ui.click('reload'); await ui.select('a');
  assert.equal(ui.element('note-text').value, 'new intent');
  await ui.submit(); assert.equal(ui.requests.filter((request) => request.method === 'POST').length, 1);
  const replay = ui.hold('/api/benches/a/notes', 'POST'); const resolving = ui.click('resolve-request');
  await settle(); const retry = ui.requests.filter((request) => request.method === 'POST').at(-1);
  assert.equal(retry.headers['Idempotency-Key'], original.headers['Idempotency-Key']);
  assert.equal(retry.headers['X-Engawa-Actor'], 'owner'); assert.equal(retry.body, original.body);
  replay.resolve(response(bench('a', 1))); await resolving;
  assert.equal(ui.element('note-text').value, 'new intent'); assert.equal(ui.element('pending').hidden, true);
});

test('ack loss followed by export and fresh-page import preserves exact body/key and does not send', async () => {
  const ui = await createUI(); ui.input('only my text', 'decision');
  const lost = ui.hold('/api/benches/a/notes', 'POST'); const action = ui.submit();
  lost.reject(new Error('lost')); await action;
  ui.input('my next draft'); ui.click('export-recovery'); const exported = ui.element('recovery-text').value;
  const fresh = await createUI(); fresh.element('recovery-text').value = exported; fresh.click('import-recovery');
  assert.equal(fresh.requests.some((request) => request.method === 'POST'), false);
  assert.equal(fresh.element('note-text').value, 'my next draft');
  const ack = fresh.hold('/api/benches/a/notes', 'POST'); const resolving = fresh.click('resolve-request'); await settle();
  const previous = ui.requests.find((request) => request.method === 'POST'), retry = fresh.requests.find((request) => request.method === 'POST');
  assert.equal(retry.body, previous.body); assert.equal(retry.headers['Idempotency-Key'], previous.headers['Idempotency-Key']);
  ack.resolve(response(bench('a', 1))); await resolving;
  assert.equal(fresh.element('note-text').value, 'my next draft');
});

test('confirmation ack loss and reauthentication retain original request, without automatic confirmation', async () => {
  const ui = await createUI();
  const lost = ui.hold('/api/benches/a/notes/note-1/confirm', 'POST'); const action = ui.confirm('note-1');
  lost.reject(new Error('lost confirmation')); await action;
  await ui.select('b'); await ui.click('reload'); await ui.select('a');
  assert.equal(ui.requests.filter((request) => request.method === 'POST').length, 1);
  ui.click('export-recovery'); const exported = ui.element('recovery-text').value;
  const fresh = await createUI(); fresh.element('recovery-text').value = exported; fresh.click('import-recovery');
  const ack = fresh.hold('/api/benches/a/notes/note-1/confirm', 'POST'); const resolving = fresh.click('resolve-request'); await settle();
  const previous = ui.requests.find((request) => request.method === 'POST'), retry = fresh.requests.find((request) => request.method === 'POST');
  assert.equal(retry.url, previous.url); assert.equal(retry.body, previous.body); assert.equal(retry.headers['Idempotency-Key'], previous.headers['Idempotency-Key']);
  ack.resolve(response(bench('a', 1))); await resolving;
  assert.equal(fresh.element('pending').hidden, true);
});

test('delayed confirmation ack or failure cannot change B DOM, draft or pending controls', async () => {
  for (const failure of [false, true]) {
    const ui = await createUI();
    const ack = ui.hold('/api/benches/a/notes/note-1/confirm', 'POST'); const action = ui.confirm('note-1');
    await ui.select('b'); ui.input('B draft');
    if (failure) ack.resolve(response({ message: 'old access expired' }, 401)); else ack.resolve(response(bench('a', 1)));
    await action;
    assert.equal(ui.element('workspace').hidden, false); assert.equal(ui.element('active-title').textContent, 'Workbench b');
    assert.equal(ui.element('note-text').value, 'B draft'); assert.equal(ui.element('save').disabled, false);
  }
});

test('authorization loss erases fetched information, while own input and unknown request remain exportable', async () => {
  for (const status of [401, 403, 404]) {
    const ui = await createUI(); await ui.click('handoff'); ui.input('my recoverable draft');
    const denied = ui.hold('/api/benches/a/notes', 'POST'); const action = ui.submit();
    denied.resolve(response({ message: 'access unavailable' }, status)); await action;
    assert.equal(ui.element('workspace').hidden, true); assert.equal(ui.element('dialog').open, false);
    for (const id of ['notes', 'people', 'bench-list']) assert.equal(ui.element(id).innerHTML, '');
    assert.equal(ui.element('handoff-text').textContent, '');
    ui.click('export-recovery'); const saved = JSON.parse(ui.element('recovery-text').value);
    assert.equal(saved.records[0].draft.text, 'my recoverable draft');
    assert.equal(saved.records[0].mutation.body.text, 'my recoverable draft');
    assert.equal(Object.hasOwn(saved.records[0], 'notes'), false);
  }
});

test('a newly authenticated actor cannot see, import or replay another actors drafts', async () => {
  const ui = await createUI(); ui.input('owner private draft'); ui.click('export-recovery'); const exported = ui.element('recovery-text').value;
  ui.identity({ id: 'editor', name: 'Editor' }); await ui.click('reload');
  assert.equal(ui.element('note-text').value, ''); ui.click('export-recovery');
  assert.deepEqual(JSON.parse(ui.element('recovery-text').value).records, []);
  ui.element('recovery-text').value = exported; ui.click('import-recovery');
  assert.equal(ui.element('note-text').value, ''); assert.equal(ui.requests.some((request) => request.method === 'POST'), false);
  ui.identity({ id: 'owner', name: 'Owner' }); await ui.click('reload');
  assert.equal(ui.element('note-text').value, 'owner private draft');
});

test('revoked replay rechecks access and never posts; cancellation is explicit and keeps input', async () => {
  const ui = await createUI(); ui.input('retained');
  const lost = ui.hold('/api/benches/a/notes', 'POST'); const action = ui.submit(); lost.reject(new Error('lost')); await action;
  const denied = ui.hold('/api/benches/a'); const resolving = ui.click('resolve-request'); denied.resolve(response({}, 404)); await resolving;
  assert.equal(ui.requests.filter((request) => request.method === 'POST').length, 1);
  await ui.click('reload');
  ui.context.confirm = () => false; ui.click('discard-request'); assert.equal(ui.element('save').disabled, true);
  ui.context.confirm = () => true; ui.click('discard-request'); assert.equal(ui.element('save').disabled, false);
  assert.equal(ui.element('note-text').value, 'retained');
});

test('same text with a new save intent gets a new request ID, not content-based deduplication', async () => {
  const ui = await createUI();
  for (let revision = 1; revision <= 2; revision++) {
    ui.input('same intentional text'); const ack = ui.hold('/api/benches/a/notes', 'POST'); const action = ui.submit();
    ack.resolve(response(bench('a', revision))); await action; assert.equal(ui.element('note-text').value, '');
  }
  const requests = ui.requests.filter((request) => request.method === 'POST');
  assert.notEqual(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
});

test('disconnect, reauth, voluntary nonparticipation and nobody else are distinct', async () => {
  const ui = await createUI(); assert.match(ui.element('connection-state').textContent, /未参加/);
  assert.match(ui.element('scene').innerHTML, /<svg/);
  ui.click('join'); ui.sockets[0].open(); ui.sockets[0].message('presence', [{ actorId: 'owner', name: 'Owner', mode: 'knock' }]);
  assert.match(ui.element('presence-count').textContent, /他の参加者はいません/);
  ui.sockets[0].close(1006); await settle(); assert.match(ui.element('connection-state').textContent, /切断中/);
  ui.click('join'); ui.sockets[1].open(); const expired = ui.hold('/api/benches/a');
  ui.sockets[1].close(1008); expired.resolve(response({}, 401)); await settle();
  assert.match(ui.element('connection-state').textContent, /再ログインが必要/); assert.equal(ui.element('reauth').hidden, false);
});

test('socket identity mismatch clears fetched state instead of displaying the new actors frames', async () => {
  const ui = await createUI(); ui.input('own text'); ui.click('join'); ui.sockets[0].open();
  ui.sockets[0].message('presence', [{ actorId: 'editor', name: 'Other identity' }], 'editor');
  assert.equal(ui.element('workspace').hidden, true); assert.equal(ui.element('people').innerHTML, '');
  ui.click('export-recovery'); assert.equal(JSON.parse(ui.element('recovery-text').value).records[0].draft.text, 'own text');
});

test('beforeunload warns, recovery import is atomic and refuses overwriting or foreign origins', async () => {
  const ui = await createUI(); ui.input('draft');
  let prevented = false; ui.listeners.beforeunload({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  ui.click('export-recovery'); const saved = ui.element('recovery-text').value;
  ui.input('newer draft'); ui.element('recovery-text').value = saved; ui.click('import-recovery'); assert.equal(ui.element('note-text').value, 'newer draft');
  const fresh = await createUI(); const wrong = JSON.parse(saved); wrong.origin = 'https://other.invalid'; fresh.element('recovery-text').value = JSON.stringify(wrong); fresh.click('import-recovery');
  assert.equal(fresh.element('note-text').value, '');
});

test('known session expiry clears cached data even without participation, and stale expiry is fenced', async () => {
  const ui = await createUI(); ui.input('own draft'); await ui.click('handoff');
  const timers = []; ui.context.setTimeout = (callback) => { timers.push(callback); return timers.length; }; ui.context.clearTimeout = () => {};
  const expired = ui.hold('/api/bootstrap'); const loading = ui.click('reload');
  expired.resolve(response({ actor: { id: 'owner', name: 'Owner' }, session: { expiresAt: 1 }, benches: [bench('a')] })); await loading;
  await ui.click('handoff'); timers[0]();
  assert.equal(ui.element('workspace').hidden, true); assert.equal(ui.element('dialog').open, false);
  ui.click('export-recovery'); assert.equal(JSON.parse(ui.element('recovery-text').value).records[0].draft.text, 'own draft');
  await ui.click('reload'); timers[0]();
  assert.equal(ui.element('workspace').hidden, false); assert.equal(ui.element('note-text').value, 'own draft');
});
