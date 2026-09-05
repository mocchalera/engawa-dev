import { DurableObject } from 'cloudflare:workers';
import { DomainError } from './common';
import type { Env, Identity, Policy, BenchPolicy } from './types';

export function validatePolicy(value: unknown): Policy {
  const policy = value as Policy;
  const invalid = () => { throw new DomainError(400, 'invalid_policy', '権限設定の形式が不正です。'); };
  if (!policy || Object.keys(policy).sort().join() !== 'benches,members,revision' || !Number.isSafeInteger(policy.revision) || policy.revision < 0 || !policy.members || typeof policy.members !== 'object' || Array.isArray(policy.members) || !Array.isArray(policy.benches) || policy.benches.length > 30) return invalid();
  for (const [tenant, subjects] of Object.entries(policy.members)) {
    if (!/^[a-z0-9-]{1,80}$/.test(tenant) || !Array.isArray(subjects) || subjects.length > 50 || subjects.some((subject) => typeof subject !== 'string' || !subject || subject.length > 200)) return invalid();
  }
  const ids = new Set();
  for (const bench of policy.benches) {
    if (!bench || Object.keys(bench).sort().join() !== 'goal,grants,id,tenantId,title' || !/^[a-z0-9-]{1,80}$/.test(bench.id) || !Object.hasOwn(policy.members, bench.tenantId) || ids.has(bench.id) || typeof bench.title !== 'string' || !bench.title.trim() || bench.title.length > 120 || typeof bench.goal !== 'string' || bench.goal.length > 3000 || !bench.grants || typeof bench.grants !== 'object' || Array.isArray(bench.grants)) return invalid();
    ids.add(bench.id);
    if (!Object.values(bench.grants).includes('owner')) return invalid();
    for (const [subject, role] of Object.entries(bench.grants)) if (!['owner', 'editor', 'viewer'].includes(role) || !policy.members[bench.tenantId].includes(subject)) return invalid();
  }
  return policy;
}

export class Directory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS policy (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS bindings (id TEXT PRIMARY KEY, tenant TEXT NOT NULL)');
  }
  private read(): Policy {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM policy WHERE singleton=1').toArray()[0];
    return row ? JSON.parse(row.value) : { revision: 0, members: {}, benches: [] };
  }
  async authorize(identity: Identity, id: string): Promise<BenchPolicy | null> {
    if (identity.expiresAt <= Date.now()) return null;
    const policy = this.read();
    const bench = policy.benches.find((item) => item.id === id);
    return bench && policy.members[bench.tenantId]?.includes(identity.id) && Object.hasOwn(bench.grants, identity.id) ? bench : null;
  }
  async bootstrap(identity: Identity) {
    const policy = this.read();
    return policy.benches.filter((bench) => identity.expiresAt > Date.now() && policy.members[bench.tenantId]?.includes(identity.id) && Object.hasOwn(bench.grants, identity.id)).map(({ grants, ...bench }) => ({ ...bench, role: grants[identity.id] }));
  }
  private isAdmin(identity: Identity) {
    return identity.expiresAt > Date.now() && (this.env.ADMIN_SUBJECTS ?? '').split(',').map((subject) => subject.trim()).filter(Boolean).includes(identity.id);
  }
  async inspectPolicy(identity: Identity) {
    return this.isAdmin(identity) ? { status: 200, policy: this.read() } : { status: 403, error: 'admin_required' };
  }
  async replace(identity: Identity, input: unknown) {
    if (!this.isAdmin(identity)) return { status: 403, error: 'admin_required' };
    let policy: Policy;
    try { policy = validatePolicy(input); } catch { return { status: 400, error: 'invalid_policy' }; }
    const previous = this.read();
    if (policy.revision !== previous.revision) return { status: 409, error: 'revision_conflict' };
    for (const bench of policy.benches) {
      const binding = this.ctx.storage.sql.exec<{ tenant: string }>('SELECT tenant FROM bindings WHERE id=?', bench.id).toArray()[0];
      if (binding && binding.tenant !== bench.tenantId) return { status: 409, error: 'immutable_tenant_binding' };
    }
    const next = { ...policy, revision: previous.revision + 1 };
    this.ctx.storage.transactionSync(() => {
      for (const bench of next.benches) this.ctx.storage.sql.exec('INSERT OR IGNORE INTO bindings VALUES (?, ?)', bench.id, bench.tenantId);
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO policy VALUES (1, ?)', JSON.stringify(next));
    });
    return { status: 200, revision: next.revision, affected: [...new Set([...previous.benches, ...next.benches].map((bench) => bench.id))] };
  }
}
