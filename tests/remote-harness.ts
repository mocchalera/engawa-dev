import worker, { Workbench as ProductionWorkbench } from '../remote/worker';
export { Directory } from '../remote/worker';

export class Workbench extends ProductionWorkbench {
  async inspect() {
    return {
      work: this.ctx.storage.sql.exec('SELECT * FROM work').toArray(),
      receipts: this.ctx.storage.sql.exec('SELECT * FROM receipts').toArray(),
      tables: this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray()
    };
  }
  async failWrites(enabled: boolean) {
    if (enabled) this.ctx.storage.sql.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    else this.ctx.storage.sql.exec('DROP TRIGGER fail_receipt');
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__test/gateway') {
      let allocations = 0;
      const target = new URL(`/api/benches/${url.searchParams.get('bench')}`, url.origin);
      const guarded = { ...env, WORKBENCHES: { getByName() { allocations++; return { async fetch() { throw new Error('Injected transport failure'); } }; } } };
      try {
        const response = await worker.fetch(new Request(target, request), guarded);
        return Response.json({ allocations, status: response.status });
      } catch { return Response.json({ allocations, status: 'unhandled_rejection' }); }
    }
    if (url.pathname === '/__test/inspect') return Response.json(await env.WORKBENCHES.getByName('shared').inspect());
    if (url.pathname === '/__test/fail') { await env.WORKBENCHES.getByName('shared').failWrites(url.searchParams.get('on') === '1'); return new Response('ok'); }
    return worker.fetch(request, env);
  }
};
