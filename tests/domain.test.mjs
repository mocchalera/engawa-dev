import test from 'node:test';
import assert from 'node:assert/strict';
import { actorById, seedDatabase, roleFor, requireReadable, publicBench, addNote, confirmNote, handoff, validateDatabase } from '../src/domain.mjs';

const owner = actorById('aoi');
const editor = actorById('ren');
const viewer = actorById('nagi');
const outsider = actorById('sora');
const now = '2026-09-05T05:00:00.000Z';
const bench = () => seedDatabase().benches[0];

function fails(fn, status) { assert.throws(fn, (error) => error.status === status); }

test('explicit workbench grant controls read', () => {
  assert.equal(roleFor(viewer, bench()), 'viewer');
  fails(() => requireReadable(outsider, bench()), 404);
});

test('tenant membership is not inherited as object access', () => {
  const db = seedDatabase();
  fails(() => requireReadable(viewer, db.benches[1]), 404);
});

test('public view does not expose grant roster', () => {
  assert.equal('grants' in publicBench(owner, bench()), false);
});

test('viewer cannot write', () => {
  fails(() => addNote(viewer, bench(), { kind: 'task', text: 'x', baseRevision: 1 }, 'n1', now), 403);
});

test('new decision is draft even when created by owner', () => {
  const next = addNote(owner, bench(), { kind: 'decision', text: 'レビュー後に公開する', baseRevision: 1 }, 'n1', now);
  assert.equal(next.notes.at(-1).status, 'draft');
  assert.equal(next.revision, 2);
});

test('client cannot spoof status or author', () => {
  fails(() => addNote(editor, bench(), { kind: 'decision', text: 'x', baseRevision: 1, authorId: 'aoi' }, 'n1', now), 400);
});

test('stale revision is rejected', () => {
  fails(() => addNote(owner, bench(), { kind: 'task', text: 'x', baseRevision: 0 }, 'n1', now), 409);
});

test('only owner can confirm', () => {
  const next = addNote(editor, bench(), { kind: 'decision', text: 'x', baseRevision: 1 }, 'n1', now);
  fails(() => confirmNote(editor, next, 'n1', { baseRevision: 2 }, now), 403);
  assert.equal(confirmNote(owner, next, 'n1', { baseRevision: 2 }, now).notes.at(-1).status, 'confirmed');
});

test('question and hypothesis cannot become confirmed decisions', () => {
  fails(() => confirmNote(owner, bench(), 'seed-question', { baseRevision: 1 }, now), 400);
});

test('handoff is context only and keeps unresolved separate', () => {
  const value = handoff(owner, bench(), now);
  assert.equal(value.authority.executionAuthorized, false);
  assert.equal(value.confirmed.length, 1);
  assert.equal(value.unresolved.length, 1);
  assert.equal('grants' in value, false);
});

test('unauthorized handoff is not available', () => {
  fails(() => handoff(outsider, bench(), now), 404);
});

test('corrupt persistence fails instead of silently reseeding', () => {
  assert.throws(() => validateDatabase({ schemaVersion: 2, benches: [] }));
  assert.deepEqual(validateDatabase(seedDatabase()), seedDatabase());
});
