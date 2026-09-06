import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const [ownerTab, editorTab, origin = 'http://127.0.0.1:14184'] = process.argv.slice(2);
if (!ownerTab || !editorTab || ownerTab === editorTab || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Pass two distinct local Cockpit fixture tab IDs and a loopback origin');
const exec = promisify(execFile), results = [], evidence = {};
const prefix = `M1.1 ${crypto.randomUUID().slice(0, 8)}`;
const texts = { snapshot: `${prefix} snapshot A`, draft: `${prefix} draft B`, next: `${prefix} next intent C`, decision: `${prefix} decision`, revoked: `${prefix} own revoked draft` };
evidence.texts = texts;
const cli = async (...args) => {
  const { stdout } = await exec('cockpit', args, { maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(stdout); if (result.ok === false) throw new Error(JSON.stringify(result));
  return result.data ?? result;
};
const originalIdentity = (await cli('task', 'browser-identity')).identity.id;
const identities = await cli('browser', 'identity', 'list', '--json');
const profiles = identities.filter((item) => ['engawa-m11-owner-local', 'engawa-m11-editor-local'].includes(item.name));
assert.equal(profiles.length, 2); assert.notEqual(profiles[0].partitionId, profiles[1].partitionId);
const names = new Map([[ownerTab, 'engawa-m11-owner-local'], [editorTab, 'engawa-m11-editor-local']]);
let assigned;
const browser = async (command, tab, ...args) => {
  if (assigned !== names.get(tab)) { await cli('task', 'browser-identity', names.get(tab)); assigned = names.get(tab); }
  return cli('browser', command, tab, ...args, '--json');
};
const evaluate = (tab, expression) => browser('evaluate', tab, '--expression', expression);
const click = (tab, selector) => browser('click', tab, '--selector', selector);
const type = async (tab, selector, text) => {
  if (text) return browser('type', tab, '--selector', selector, '--text', text);
  await browser('press', tab, '--selector', selector, '--key', 'A', '--mod', 'Meta');
  return browser('press', tab, '--selector', selector, '--key', 'Backspace');
};
const state = () => fetch(`${origin}/__fixture/state`).then((response) => response.json());
const control = async (value) => {
  const response = await fetch(`${origin}/__fixture/control`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(value) });
  assert.equal(response.status, 200); return response.json();
};
const fault = (subject, method, path, mode = 'hold') => control({ action: 'fault', subject, method, path, mode });
const until = async (check, label) => {
  for (let attempt = 0; attempt < 30; attempt++) { const result = await check(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 150)); }
  throw new Error(`Timed out: ${label}`);
};
const visible = (tab) => until(() => evaluate(tab, '!document.getElementById("workspace").hidden'), 'workspace');
const read = (tab, id, property = 'textContent') => evaluate(tab, `document.getElementById(${JSON.stringify(id)})[${JSON.stringify(property)}]`);
const held = () => until(async () => (await state()).held[0], 'held response');
const select = async (tab, bench) => { await click(tab, `[data-bench="${bench}"]`); await visible(tab); };
const refresh = async (tab) => { await click(tab, '#reload'); await visible(tab); };
const recovered = async (tab) => {
  if (!await evaluate(tab, 'document.querySelector("details").open')) await click(tab, 'summary');
  await click(tab, '#export-recovery'); return JSON.parse(await read(tab, 'recovery-text', 'value'));
};
const posts = async () => (await state()).requests.filter((request) => request.method === 'POST');
const record = (name) => { results.push(name); console.log(`PASS ${name}`); };

try {
  for (const tab of [ownerTab, editorTab]) assert.equal(await evaluate(tab, 'location.origin'), origin);
  assert.match(await read(ownerTab, 'identity'), /^owner@example\.invalid$/);
  assert.match(await read(editorTab, 'identity'), /^editor@example\.invalid$/);
  evidence.profiles = profiles.map(({ name, partitionId }) => ({ name, partitionId }));
  for (const tab of [ownerTab, editorTab]) { await select(tab, 'shared'); await click(tab, '#join'); }
  await until(async () => /2人/.test(await read(ownerTab, 'presence-count')), 'two isolated profiles');
  record('two independent signed identities join actual workerd WebSockets');

  await fault('owner', 'GET', '/api/benches/shared/handoff'); await click(ownerTab, '#handoff'); const packetHold = await held();
  await select(ownerTab, 'other'); await control({ action: 'release', id: packetHold });
  assert.equal(await read(ownerTab, 'dialog', 'open'), false); assert.equal(await read(ownerTab, 'handoff-text'), '');
  await select(ownerTab, 'shared'); await click(ownerTab, '#handoff');
  await until(() => read(ownerTab, 'dialog', 'open'), 'handoff opened');
  await browser('press', ownerTab, '--key', 'Escape'); await select(ownerTab, 'other');
  assert.equal(await read(ownerTab, 'handoff-text'), ''); record('delayed handoff fenced; selection clears previously opened packet');

  await select(ownerTab, 'shared'); await click(ownerTab, '#join');
  await until(async () => /参加・同期中/.test(await read(ownerTab, 'connection-state')), 'owner joined');
  await fault('owner', 'GET', '/api/benches/shared'); await control({ action: 'disconnect', bench: 'shared' }); const refreshHold = await held();
  await select(ownerTab, 'other'); await control({ action: 'release', id: refreshHold, status: 503 });
  assert.equal(await read(ownerTab, 'workspace', 'hidden'), false); assert.equal(await read(ownerTab, 'active-title'), '別テナントの作業台');
  record('old socket-close refresh failure leaves other tenant visible');

  await select(ownerTab, 'shared'); await type(ownerTab, '#note-text', texts.snapshot);
  await fault('owner', 'POST', '/api/benches/shared/notes'); await click(ownerTab, '#save'); const saveHold = await held();
  await type(ownerTab, '#note-text', texts.draft); await control({ action: 'release', id: saveHold });
  await until(async () => await read(ownerTab, 'save', 'disabled') === false, 'save acknowledged');
  assert.equal(await read(ownerTab, 'note-text', 'value'), texts.draft);
  await select(ownerTab, 'other'); assert.equal(await read(ownerTab, 'note-text', 'value'), ''); await select(ownerTab, 'shared');
  assert.equal(await read(ownerTab, 'note-text', 'value'), texts.draft); record('in-flight edits survive ack and tenant roundtrip');

  await fault('owner', 'POST', '/api/benches/shared/notes', 'lost-ack'); await click(ownerTab, '#save');
  await until(async () => await read(ownerTab, 'resolve-request', 'disabled') === false, 'ambiguous save');
  const originalSave = (await posts()).at(-1); await type(ownerTab, '#note-text', texts.next);
  await evaluate(ownerTab, 'fetch("/__fixture/expire").then(response => response.text())'); await click(ownerTab, '#reload');
  await until(async () => /再ログイン/.test(await read(ownerTab, 'connection-state')), 'real expired JWT rejected');
  assert.equal(await read(ownerTab, 'workspace', 'hidden'), true); const saveRecovery = await recovered(ownerTab);
  evidence.saveRecovery = saveRecovery;
  await evaluate(ownerTab, 'fetch("/__fixture/reauth").then(response => response.text())'); await refresh(ownerTab); await select(ownerTab, 'other'); await select(ownerTab, 'shared');
  assert.equal((await posts()).at(-1).id, originalSave.id); await click(ownerTab, '#resolve-request');
  await until(() => read(ownerTab, 'pending', 'hidden'), 'explicit save resolution');
  const saveReplay = (await posts()).at(-1); assert.equal(saveReplay.requestId, originalSave.requestId); assert.equal(saveReplay.body, originalSave.body);
  assert.equal(await read(ownerTab, 'note-text', 'value'), texts.next);
  const durable = await evaluate(ownerTab, 'fetch("/api/benches/shared").then(response => response.json())');
  assert.equal(durable.notes.filter((note) => note.text === texts.draft).length, 1);
  record('lost save ack + expired JWT + reauth + explicit exact replay creates one SQLite note');

  await refresh(editorTab); await type(editorTab, '#note-text', texts.decision);
  await browser('select', editorTab, '--selector', '#kind', '--value', 'decision'); await click(editorTab, '#save');
  await until(async () => await read(editorTab, 'note-text', 'value') === '', 'editor draft saved');
  await refresh(ownerTab); const decision = await evaluate(ownerTab, `fetch("/api/benches/shared").then(response => response.json()).then(board => board.notes.find(note => note.text === ${JSON.stringify(texts.decision)}))`);
  assert.equal(decision.status, 'draft'); const confirmPath = `/api/benches/shared/notes/${decision.id}/confirm`;
  await fault('owner', 'POST', confirmPath, 'lost-ack'); await click(ownerTab, `[data-confirm="${decision.id}"]`);
  await until(async () => await read(ownerTab, 'resolve-request', 'disabled') === false, 'ambiguous confirmation');
  const originalConfirm = (await posts()).at(-1); await select(ownerTab, 'other'); await refresh(ownerTab); await select(ownerTab, 'shared');
  assert.equal((await posts()).at(-1).id, originalConfirm.id); const confirmRecovery = await recovered(ownerTab); evidence.confirmRecovery = confirmRecovery;
  await click(ownerTab, '#resolve-request'); await until(() => read(ownerTab, 'pending', 'hidden'), 'explicit confirmation resolution');
  const confirmReplay = (await posts()).at(-1); assert.equal(confirmReplay.requestId, originalConfirm.requestId); assert.equal(confirmReplay.body, originalConfirm.body);
  assert.match(await read(ownerTab, 'notes'), /確定済み/); record('lost confirmation ack retains original ID/body across switching and reauthentication');

  const exportForFreshPage = await recovered(ownerTab);
  await type(ownerTab, '#note-text', ''); await browser('reload', ownerTab); await visible(ownerTab);
  if (!await evaluate(ownerTab, 'document.querySelector("details").open')) await click(ownerTab, 'summary');
  await type(ownerTab, '#recovery-text', JSON.stringify(exportForFreshPage)); const countBeforeImport = (await posts()).length;
  await click(ownerTab, '#import-recovery'); assert.equal((await posts()).length, countBeforeImport);
  assert.equal(await read(ownerTab, 'note-text', 'value'), texts.next);
  assert.deepEqual(await evaluate(ownerTab, '({local:localStorage.length,session:sessionStorage.length})'), { local: 0, session: 0 });
  record('explicit export + actual page reload + import restores input without storage or automatic send');

  await type(editorTab, '#note-text', texts.revoked);
  const policy = await evaluate(ownerTab, 'fetch("/api/policy").then(response => response.json())');
  const changed = structuredClone(policy); delete changed.benches.find((bench) => bench.id === 'shared').grants.editor;
  const replacePolicy = (value) => evaluate(ownerTab, `fetch("/api/policy",{method:"PUT",headers:{"Content-Type":"application/json","X-Engawa-Client":"remote-ui"},body:${JSON.stringify(JSON.stringify(value))}}).then(async response=>({status:response.status,value:await response.json()}))`);
  const revoked = await replacePolicy(changed); assert.equal(revoked.status, 200);
  try {
    await click(editorTab, '#handoff');
    await until(() => read(editorTab, 'workspace', 'hidden'), 'revoked fetched view cleared');
    assert.equal(await read(editorTab, 'notes', 'innerHTML'), ''); assert.equal(await read(editorTab, 'handoff-text'), '');
    const retained = await recovered(editorTab); assert.equal(retained.records.find((item) => item.workbenchId === 'shared').draft.text, texts.revoked);
  } finally {
    const latest = await evaluate(ownerTab, 'fetch("/api/policy").then(response=>response.json())');
    latest.benches.find((bench) => bench.id === 'shared').grants.editor = policy.benches.find((bench) => bench.id === 'shared').grants.editor;
    assert.equal((await replacePolicy(latest)).status, 200);
  }
  await refresh(editorTab); assert.equal(await read(editorTab, 'note-text', 'value'), texts.revoked);
  record('local grant revocation clears fetched data, preserves only own input and restores after reauthorization');

  evidence.checks = results;
  evidence.final = await evaluate(ownerTab, 'fetch("/api/benches/shared").then(response => response.json())');
  await writeFile('.data/m1-1-browser.json', JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ checks: results.length, status: 'PASS', productionTouched: false }));
} finally {
  for (const id of (await state()).held) await control({ action: 'release', id, status: 503 });
  await cli('task', 'browser-identity', originalIdentity);
}
