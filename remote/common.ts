import { DomainError } from '../src/domain.mjs';
export { DomainError };

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), display-capture=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  } });
}

export function failure(error: unknown) {
  return error instanceof DomainError
    ? json({ error: error.code, message: error.message }, error.status)
    : json({ error: 'unavailable', message: '保存または認証の確認に失敗しました。再接続してください。' }, 503);
}

export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError(415, 'json_required', 'JSONが必要です。');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new DomainError(413, 'too_large', '入力が大きすぎます。'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new DomainError(400, 'invalid_json', 'JSONが不正です。'); }
}
