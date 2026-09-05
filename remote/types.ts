export type Role = 'owner' | 'editor' | 'viewer';
export type Identity = { id: string; name: string; expiresAt: number };
export type BenchPolicy = { id: string; tenantId: string; title: string; goal: string; grants: Record<string, Role> };
export type Policy = { revision: number; members: Record<string, string[]>; benches: BenchPolicy[] };
export interface Env {
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  ADMIN_SUBJECTS: string;
  ASSETS: Fetcher;
  DIRECTORY: DurableObjectNamespace<import('./directory').Directory>;
  WORKBENCHES: DurableObjectNamespace<import('./workbench').Workbench>;
}
