import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { readFile } from 'node:fs/promises';

const issuer = 'https://engawa-fixture.cloudflareaccess.com';
const audience = 'local-browser-fixture';
const keys = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture', alg: 'RS256', use: 'sig' };
const tokens = Object.fromEntries(await Promise.all(['owner', 'editor', 'viewer'].map(async (subject) => [subject, await new SignJWT({ type: 'app', email: `${subject}@example.invalid` }).setSubject(subject).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('1h').setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(keys.privateKey)])));
const bundle = await build({ entryPoints: ['tests/remote-browser.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'] });
const runtime = new Miniflare(convertV4MiniflareOptions({
  name: 'engawa-browser-fixture', host: '127.0.0.1', port: 14174, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-05',
  durableObjects: { DIRECTORY: { className: 'Directory', useSQLite: true }, WORKBENCHES: { className: 'Workbench', useSQLite: true } },
  bindings: { ACCESS_ISSUER: issuer, ACCESS_AUD: audience, ADMIN_SUBJECTS: 'owner', FIXTURE_TOKENS: JSON.stringify(tokens) },
  serviceBindings: { ASSETS: async (request) => {
    const path = new URL(request.url).pathname;
    if (!['/', '/style.css', '/app.js'].includes(path)) return new Response('Not found', { status: 404 });
    return new Response(await readFile(`remote/public/${path === '/' ? 'index.html' : path.slice(1)}`), { headers: { 'Content-Type': path === '/' ? 'text/html' : path === '/app.js' ? 'text/javascript' : 'text/css' } });
  } },
  outboundService: async (request) => request.url === `${issuer}/cdn-cgi/access/certs` ? Response.json({ keys: [jwk] }) : new Response('No external requests', { status: 403 })
}));
await runtime.ready;
const origin = 'http://127.0.0.1:14174';
const response = await runtime.dispatchFetch(`${origin}/api/policy`, { method: 'PUT', headers: { Origin: origin, 'Cf-Access-Jwt-Assertion': tokens.owner, 'X-Engawa-Client': 'remote-ui', 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, members: { atelier: ['owner', 'editor', 'viewer'] }, benches: [{ id: 'shared', tenantId: 'atelier', title: '二人の、仕事のつづき。', goal: '途中の仕事を残し、必要なときに集まる。', grants: { owner: 'owner', editor: 'editor', viewer: 'viewer' } }] }) });
if (response.status !== 200) { await runtime.dispose(); throw new Error(`Fixture provisioning failed: ${response.status}`); }
console.log('LOCAL SIGNED-IDENTITY FIXTURE ONLY: http://127.0.0.1:14174/__fixture/login/owner (or editor/viewer). Never expose this fixture.');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await runtime.dispose(); process.exit(0); });
