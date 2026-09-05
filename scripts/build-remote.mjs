import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

let html = await readFile('public/index.html', 'utf8');
const identity = /      <div class="identity">[\s\S]*?      <\/div>/;
if (!identity.test(html) || !html.includes('まず「あおい」で入り')) throw new Error('Local template changed; review remote asset boundary');
html = html.replace(identity, '<div class="identity"><p id="identity">本人確認中</p><a href="/cdn-cgi/access/logout">ログアウト</a></div>')
  .replace('LOCAL PROTOTYPE / 架空ユーザー・録音なし・AI処理なし', 'REMOTE PILOT / 録音なし・音声未接続・AI処理なし')
  .replace('まず「あおい」で入り、ひとつメモを残してみてください。', '許可された作業台を読み込んでいます。')
  .replace('<button id="logout" hidden>退出</button>', '<button id="reload">再読み込み</button>');
if (/デモユーザー|value="aoi"|id="actor"|id="login"/.test(html)) throw new Error('Demo identity leaked into remote assets');
await mkdir('remote/public', { recursive: true });
await writeFile('remote/public/index.html', html);
await copyFile('public/style.css', 'remote/public/style.css');
await copyFile('remote/app.js', 'remote/public/app.js');
