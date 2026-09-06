import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

let html = await readFile('public/index.html', 'utf8');
const identity = /      <div class="identity">[\s\S]*?      <\/div>/;
if (!identity.test(html) || !html.includes('まず「あおい」で入り')) throw new Error('Local template changed; review remote asset boundary');
html = html.replace(identity, '<div class="identity"><p id="identity">本人確認中</p><a id="remote-logout" href="/cdn-cgi/access/logout">ログアウト</a></div>')
  .replace('LOCAL PROTOTYPE / 架空ユーザー・録音なし・AI処理なし', 'REMOTE PILOT / 録音なし・音声未接続・AI処理なし')
  .replace('まず「あおい」で入り、ひとつメモを残してみてください。', '許可された作業台を読み込んでいます。')
  .replace('<button id="logout" hidden>退出</button>', '<button id="reload">権限を再確認</button>')
  .replace('  <div id="toast" role="status" hidden></div>', '')
  .replace('<div id="welcome"', `${await readFile('remote/recovery.html', 'utf8')}<div id="toast" role="status" hidden></div><div id="welcome"`)
  .replace('<button type="submit">メモを残す</button>', '<button id="save" type="submit">メモを残す</button>')
  .replace('<div id="read-only"', '<section id="pending" class="read-only" hidden><p id="pending-status" role="status"></p><button id="resolve-request" type="button">元の要求を再確認して解決</button><button id="discard-request" type="button">要求の追跡を明示的に破棄</button></section><div id="read-only"');
if (/デモユーザー|value="aoi"|id="actor"|id="login"/.test(html)) throw new Error('Demo identity leaked into remote assets');
await mkdir('remote/public', { recursive: true });
await writeFile('remote/public/index.html', html);
await writeFile('remote/public/style.css', `${await readFile('public/style.css', 'utf8')}\n${await readFile('remote/style.css', 'utf8')}`);
await copyFile('remote/app.js', 'remote/public/app.js');
