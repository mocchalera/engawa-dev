/** Record-sized SQL rows; never serialize all company data into one SQLite value. */
import { emptyState } from './core.mjs';
const key = (kind, owner, id) => JSON.stringify([kind, owner, id]);
export function encodeRows(state) {
  const rows = new Map();
  const put = (kind, owner, id, value) => rows.set(key(kind, owner, id), { kind, owner, id, value: JSON.stringify(value) });
  put('meta', '', 'schema', state.schema);
  for (const [id, room] of Object.entries(state.rooms)) {
    const { posts, tasks, objects, ...head } = room; put('room', '', id, head);
    for (const [kind, values] of [['post', posts], ['task', tasks], ['object', objects]]) for (const value of values) put(kind, id, value.id, value);
  }
  for (const [id, value] of Object.entries(state.profiles)) put('profile', '', id, value);
  for (const [owner, memories] of Object.entries(state.memories)) for (const value of memories) put('memory', owner, value.id, value);
  for (const [id, value] of Object.entries(state.receipts)) put('receipt', '', id, value);
  return rows;
}
export function decodeRows(rows) {
  if (!rows.length) return emptyState();
  const schema = rows.find(r => r.kind === 'meta' && r.id === 'schema');
  if (!schema || JSON.parse(schema.value) !== 1) throw new Error('Missing or unsupported Town schema; refuse to reset stored work');
  const state = emptyState();
  for (const r of rows.filter(r => r.kind === 'room')) state.rooms[r.id] = { ...JSON.parse(r.value), posts: [], tasks: [], objects: [] };
  for (const r of rows) {
    const value = JSON.parse(r.value);
    if (['post', 'task', 'object'].includes(r.kind)) {
      if (!Object.hasOwn(state.rooms, r.owner)) throw new Error('Orphan Town record');
      state.rooms[r.owner][{ post: 'posts', task: 'tasks', object: 'objects' }[r.kind]].push(value);
    } else if (r.kind === 'profile') state.profiles[r.id] = value;
    else if (r.kind === 'memory') (state.memories[r.owner] ??= []).push(value);
    else if (r.kind === 'receipt') state.receipts[r.id] = value;
  }
  for (const room of Object.values(state.rooms)) for (const group of ['posts','tasks','objects']) room[group].sort((a,b) => a.at - b.at || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  for (const list of Object.values(state.memories)) list.sort((a,b) => a.savedAt - b.savedAt || a.id.localeCompare(b.id));
  return state;
}
export const TABLE_SQL = 'CREATE TABLE IF NOT EXISTS town_records (kind TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind, owner, id))';
export function changes(before, after) {
  const old = encodeRows(before), next = encodeRows(after), upsert = [], remove = [];
  for (const [k, row] of next) if (old.get(k)?.value !== row.value) upsert.push(row);
  for (const [k, row] of old) if (!next.has(k)) remove.push(row);
  return { upsert, remove };
}
export function writeChanges(execute, before, after) {
  const diff = changes(before, after);
  if (!diff.upsert.some(r => r.kind === 'meta')) diff.upsert.push({kind:'meta',owner:'',id:'schema',value:JSON.stringify(after.schema)});
  for (const r of diff.upsert) execute('INSERT OR REPLACE INTO town_records (kind,owner,id,value) VALUES (?,?,?,?)', r.kind,r.owner,r.id,r.value);
  for (const r of diff.remove) execute('DELETE FROM town_records WHERE kind=? AND owner=? AND id=?',r.kind,r.owner,r.id);
}
