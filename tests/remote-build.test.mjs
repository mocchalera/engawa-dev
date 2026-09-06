import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';

test('production entry and asset manifest exclude local identities and test-only capabilities', async () => {
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  assert.equal(config.main, 'remote/worker.ts');
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual((await readdir(config.assets.directory)).sort(), ['app.js', 'index.html', 'style.css']);
  const bundle = await build({ entryPoints: [config.main], write: false, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers'] });
  assert.doesNotMatch(bundle.outputFiles[0].text, /__fixture|__test|FIXTURE_TOKENS|fail_receipt|seedDatabase|demo-actors|aoi/);
  const html = await readFile('remote/public/index.html', 'utf8');
  assert.equal((html.match(/id="toast"/g) ?? []).length, 1);
  assert.ok(html.indexOf('id="toast"') < html.indexOf('id="workspace"'));
  assert.match(await readFile('remote/public/style.css', 'utf8'), /#toast\{position:static/);
});
