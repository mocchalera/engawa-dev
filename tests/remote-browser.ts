import worker from '../remote/worker';
export { Directory, Workbench } from '../remote/worker';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return new Response('Loopback fixture only', { status: 403 });
    const tokens = JSON.parse(env.FIXTURE_TOKENS);
    const subject = url.pathname.match(/^\/__fixture\/login\/(owner|editor|viewer)$/)?.[1];
    if (subject) return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': `engawa_fixture=${subject}; HttpOnly; SameSite=Strict; Path=/` } });
    const selected = request.headers.get('cookie')?.match(/(?:^|;\s*)engawa_fixture=(owner|editor|viewer)(?:;|$)/)?.[1];
    const headers = new Headers(request.headers);
    if (selected) headers.set('Cf-Access-Jwt-Assertion', tokens[selected]);
    return worker.fetch(new Request(request, { headers }), env);
  }
};
