import worker from '../remote/worker';
export { Directory, Workbench } from '../remote/worker';

const faults = new Map();
const held = new Map();
const requests = [];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return new Response('Loopback fixture only', { status: 403 });
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return new Response('Same-origin fixture only', { status: 403 });
    const tokens = JSON.parse(env.FIXTURE_TOKENS);
    const subject = url.pathname.match(/^\/__fixture\/login\/(owner|editor|viewer)$/)?.[1];
    if (subject) return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': `engawa_fixture=${subject}; HttpOnly; SameSite=Strict; Path=/` } });
    const selected = request.headers.get('cookie')?.match(/(?:^|;\s*)engawa_fixture=(owner|editor|viewer)(?:;|$)/)?.[1];
    if (url.pathname === '/__fixture/control' && request.method === 'POST') {
      const input = await request.json();
      if (input.action === 'fault') {
        if (!['owner', 'editor', 'viewer'].includes(input.subject) || !/^\/api\/(bootstrap|benches\/[a-z0-9-]+(?:\/handoff|\/notes(?:\/[a-zA-Z0-9-]+\/confirm)?)?)$/.test(input.path) || !['GET', 'POST'].includes(input.method) || !['hold', 'lost-ack'].includes(input.mode)) return new Response('Invalid fault', { status: 400 });
        faults.set(`${input.subject}:${input.method}:${input.path}`, input);
      } else if (input.action === 'release') {
        const lease = held.get(input.id); if (!lease) return new Response('No held request', { status: 404 });
        lease.status = input.status ?? 200;
      } else if (input.action === 'disconnect' && ['shared', 'other'].includes(input.bench)) {
        await env.WORKBENCHES.getByName(input.bench).disconnect();
      } else return new Response('Invalid control', { status: 400 });
      return Response.json({ ok: true });
    }
    if (url.pathname === '/__fixture/state' && request.method === 'GET') return Response.json({ held: [...held.keys()], requests });
    if (url.pathname === '/__fixture/expire') return new Response('Local session expired', { headers: { 'Set-Cookie': 'engawa_expired=1; HttpOnly; SameSite=Strict; Path=/' } });
    if (url.pathname === '/__fixture/reauth') return new Response('Local session renewed', { headers: { 'Set-Cookie': 'engawa_expired=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/' } });
    if (url.pathname === '/cdn-cgi/access/logout') return new Response('Local fixture logged out', { headers: { 'Set-Cookie': 'engawa_fixture=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/' } });
    const headers = new Headers(request.headers);
    if (selected) headers.set('Cf-Access-Jwt-Assertion', request.headers.get('cookie')?.includes('engawa_expired=1') ? tokens.expired : tokens[selected]);
    const faultKey = `${selected}:${request.method}:${url.pathname}`, fault = faults.get(faultKey);
    faults.delete(faultKey);
    const receipt = { id: crypto.randomUUID(), subject: selected, path: url.pathname, method: request.method, requestId: headers.get('Idempotency-Key'), body: request.method === 'POST' && url.pathname.startsWith('/api/benches/') ? await request.clone().text() : undefined };
    if (url.pathname.startsWith('/api/')) { requests.push(receipt); if (requests.length > 200) requests.shift(); }
    const result = await worker.fetch(new Request(request, { headers }), env);
    if (!fault) return result;
    if (fault.mode === 'hold') {
      const lease = { status: undefined, deadline: Date.now() + 60000 }; held.set(receipt.id, lease);
      while (lease.status === undefined && Date.now() < lease.deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      held.delete(receipt.id);
      if (lease.status === 200) return result;
    }
    return new Response('Injected acknowledgement loss after worker completed', { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
};
