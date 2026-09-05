import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DomainError } from './common';
import type { Env, Identity } from './types';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authenticate(request: Request, env: Env): Promise<Identity> {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER ?? '') || !env.ACCESS_AUD) throw new DomainError(503, 'auth_unconfigured', '認証設定が必要です。');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 8192) throw new DomainError(401, 'unauthenticated', 'Cloudflare Accessでログインしてください。');
  let keys = keySets.get(env.ACCESS_ISSUER);
  if (!keys) { keys = createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`)); keySets.set(env.ACCESS_ISSUER, keys); }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['sub', 'iat', 'exp'] });
    if (!payload.sub || payload.sub.length > 200 || typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 || payload.type !== 'app' || typeof payload.email !== 'string') throw new Error('Invalid user identity');
    return { id: payload.sub, name: payload.email, expiresAt: payload.exp * 1000 };
  } catch { throw new DomainError(401, 'unauthenticated', 'ログインの有効期限または署名を確認できません。'); }
}
