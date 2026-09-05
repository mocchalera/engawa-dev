import { authenticate } from './auth';
import { body, DomainError, failure, json } from './common';
import type { Env } from './types';
export { Directory } from './directory';
export { Workbench } from './workbench';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) throw new DomainError(403, 'cross_origin', '別サイトからは操作できません。');
      const identity = await authenticate(request, env);
      if (!['GET', 'HEAD'].includes(request.method) && (request.headers.get('origin') !== url.origin || request.headers.get('x-engawa-client') !== 'remote-ui')) throw new DomainError(403, 'csrf', 'アプリから操作してください。');
      const directory = env.DIRECTORY.getByName('policy');
      if (url.pathname === '/api/policy' && request.method === 'GET') {
        const result = await directory.inspectPolicy(identity);
        return json(result.policy ?? { error: result.error }, result.status);
      }
      if (url.pathname === '/api/bootstrap' && request.method === 'GET') return json({ actor: { id: identity.id, name: identity.name }, benches: await directory.bootstrap(identity), capabilities: { recording: false, media: false, ai: false } });
      if (url.pathname === '/api/policy' && request.method === 'PUT') {
        const result = await directory.replace(identity, await body(request));
        if (result.status !== 200) return json(result, result.status);
        await Promise.all(result.affected!.map((id) => env.WORKBENCHES.getByName(id).disconnect()));
        return json({ revision: result.revision });
      }
      if (/^\/api\/benches\/[a-z0-9-]+(?:\/.*)?$/.test(url.pathname)) {
        const headers = new Headers(request.headers);
        headers.delete('Cf-Access-Jwt-Assertion');
        headers.delete('Cookie');
        headers.set('X-Engawa-Identity', JSON.stringify(identity));
        return env.WORKBENCHES.getByName(url.pathname.split('/')[3]).fetch(new Request(request, { headers }));
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'method' }, 405);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      for (const [key, value] of json({}).headers) if (key !== 'content-type') response.headers.set(key, value);
      return response;
    } catch (error) { return failure(error); }
  }
} satisfies ExportedHandler<Env>;
