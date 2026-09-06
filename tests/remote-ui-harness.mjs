import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

export const settle = async () => { for (let turn = 0; turn < 12; turn++) await new Promise((resolve) => setImmediate(resolve)); };
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
};
export const response = (value, status = 200) => ({ ok: status < 400, status, redirected: false, headers: new Headers({ 'content-type': 'application/json' }), json: async () => structuredClone(value) });
export const bench = (id = 'a', revision = 0, notes = []) => ({ id, tenantId: `tenant-${id}`, title: `Workbench ${id}`, goal: '', role: 'owner', revision, notes });
export const packet = (id = 'a') => ({ schema: 'engawa.handoff/v1', scope: { tenantId: `tenant-${id}`, workbenchId: id }, confirmed: [], unresolved: [], authority: { executionAuthorized: false } });

class Element {
  constructor(id = '') { Object.assign(this, { id, value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', open: false, dataset: {}, listeners: {} }); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  dispatchEvent(event) { return this[`on${event.type}`]?.(event) ?? this.listeners[event.type]?.(event); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
  select() {}
  closest() { return this; }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { delete this[key]; }
}

export async function createUI() {
  const elements = new Map();
  const element = (id) => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  element('kind').value = 'question';
  const requests = [], sockets = [], holds = [], listeners = {};
  let identity = { id: 'owner', name: 'Fictional owner' };
  const boards = new Map(['a', 'b'].map((id) => [id, bench(id)]));
  const fetch = async (url, options = {}) => {
    const request = { url, method: options.method ?? 'GET', ...options };
    requests.push(request);
    const index = holds.findIndex((hold) => hold.url === url && hold.method === request.method);
    if (index !== -1) return holds.splice(index, 1)[0].promise;
    if (url === '/api/bootstrap') return response({ actor: identity, benches: [...boards.values()] });
    const id = url.split('/')[3];
    if (url.endsWith('/handoff')) return response(packet(id));
    if (request.method === 'GET') return response(boards.get(id));
    throw new Error(`Unexpected mutation: ${url}`);
  };
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.({}); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
    message(kind, data, actorId = 'owner') { this.onmessage?.({ data: JSON.stringify({ kind, data, actorId }) }); }
  }
  const context = {
    document: { getElementById: element, querySelector: (selector) => element(selector), addEventListener: (type, listener) => { listeners[type] = listener; } },
    fetch, WebSocket: Socket, crypto: { randomUUID }, location: { protocol: 'https:', host: 'fixture.invalid', origin: 'https://fixture.invalid', href: 'https://fixture.invalid/' },
    console, URL, Blob, Headers, setTimeout, clearTimeout, AbortController, structuredClone,
    addEventListener: (type, listener) => { listeners[type] = listener; },
    confirm: () => true,
    localStorage: { setItem() { throw new Error('Sensitive persistence forbidden'); } },
    sessionStorage: { setItem() { throw new Error('Sensitive persistence forbidden'); } }
  };
  context.window = context;
  runInNewContext(await readFile(process.env.REMOTE_UI_SOURCE ?? 'remote/app.js', 'utf8'), context, { filename: 'remote/app.js' });
  await settle();
  return {
    element, requests, sockets, boards, context, listeners,
    hold(url, method = 'GET') { const hold = { url, method, ...deferred() }; holds.push(hold); return hold; },
    identity(value) { identity = value; },
    input(text, kind = 'question') { element('note-text').value = text; element('note-text').dispatchEvent({ type: 'input' }); element('kind').value = kind; element('kind').dispatchEvent({ type: 'change' }); },
    async select(id) { const target = new Element(); target.dataset.bench = id; element('bench-list').onclick({ target }); await settle(); },
    submit() { return element('note-form').onsubmit({ preventDefault() {}, submitter: element('save') }); },
    click(id) { return element(id).onclick({ preventDefault() {}, target: element(id) }); },
    confirm(noteId) { const target = new Element(); target.dataset.confirm = noteId; return element('notes').onclick({ target }); }
  };
}
