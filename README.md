# ENGAWA

**仕事の続きを、ここに。**

一人でいても孤立しない。集まっても拘束されない。ENGAWA は、距離と関わり方を自分で選びながら、人とAIが仕事の続きを共有できるコミュニケーション空間を探るプロジェクトです。

## v0.1 vertical slice

最初の実装は「3D版Slack」を作ることではなく、次の流れを検証する小さな共同アトリエです。

1. 一人で作業台に参加する
2. `会話歓迎 / ノック / 集中 / 離席` を選ぶ
3. 途中の問い・決定候補・制約・次の作業を残す
4. オーナーが必要な記録だけを確定する
5. 別の人が後から同じ作業台を開き、続きを再開する
6. 確定事項と未解決事項を分けた handoff JSON を取り出す

気配や位置は一時的な状態として扱い、勤怠や生産性スコアにはしません。会話・記録・AI実行も同一視しません。

## 現在の実装

- Node.js のみで動くローカルサーバー
- 2.5D / isometric の小さな共同アトリエUI
- HTTP + Server-Sent Events による気配と更新通知
- 作業台単位の明示的な権限 (`owner / editor / viewer`)
- ノートの `draft / confirmed` 分離
- revision による競合拒否
- 選んで残した仕事だけを JSON に永続化
- presence / position / session は永続化しない
- handoff JSON は文脈のみで、外部実行権限を含まない
- Node 組み込みテストと GitHub Actions CI

## M1 remote pilot 基盤（限定pilotとしてデプロイ済み）

- 別entryの Workers API / Static Assets と、Cloudflare Access JWT の署名・issuer・audience・期限検証
- membership と作業台grantを別々に検査する、SQLite Durable Object の権限台帳
- 作業台ごとの SQLite 永続化、競合拒否、保存要求IDによる重複処理防止
- メモリ内のみの WebSocket presence、期限切れと権限変更による既存接続の切断
- 固定デモIDを含まないremote UI。ローカル版のJSONとは別ストア

ローカルruntimeに加え、別途承認された限定pilotで実際のCloudflare Access認証、同一所有者の別PC同期、別アカウントの権限境界、期限切れ、同一ソース再デプロイ後の保存状態を確認しました。2026-09-06には異なる実アカウントの二台PCで集中／ノック、決定候補の保存と所有者による明示確定、再読み込み・退出を確認し、実環境で保存応答を失った場合の同一要求再送も検証しました。別PCの画面操作・受信・ログアウトは利用者報告、所有者画面・サーバー応答・保存状態は直接確認です。

**M1の実装・検証記録はPR #3までmainへ統合済みです（2026-09-06、`93a78e9be2326f971d435edd5830fcc38eb74897`）。** 検証用の追加権限は撤去し、所有者専用へ復元済みです。予定より1件多く保存された検証メモは削除せず保持し、原因未特定として検証報告に明記しています。クラウドDO単体の再起動は直接確認しておらず、一般公開・本番運用や製品全体の完成を認定するものではありません。実施済みと未確認の区別は `docs/VERIFICATION-PILOT.md`、設定手順は `docs/PILOT.md` を参照してください。初回の `docs/VERIFICATION-M1.md` と実機検証記録は当時の履歴として保持しています。

## M1.1 — 入力を失わず、正しい作業台へ戻る（Issue #4、レビュー対象・未デプロイ）

- 本人・session epoch・tenant・作業台・選択世代を固定し、古い非同期応答／失敗から画面を保護
- 自分の下書き、送信snapshot、成否未解決の保存／確定要求を分離。保存中の追記と作業台ごとの入力を保持
- 成否未解決時は元の要求IDと本文を保持し、現在の権限を再確認した後の明示操作で解決。自動再送・自動確定はしない
- 入力はページ内のみ。「権限を再確認」は入力を保持。ページを閉じる前には自分の入力・要求だけのJSONを明示的にコピーして退避できる（機密に注意）
- 同期切れ・再ログイン・自分の未参加・他人の不在を区別。接続数・ノック頻度の小さな制限を追加

再ログインは別タブで行い、元のページで権限を再確認してください。ブラウザ自体の再読み込み／終了をまたぐには明示退避が必要です。端末への自動永続化はしません。詳細と検証の境界は `docs/VERIFICATION-M1.1.md`。M1.1のレビュー・merge・deployは別の判断です。Issue #1/#4はOPENのままです。

## まだ実装していないもの

- セルフサービスの招待・権限管理UI（限定pilotの権限は管理者が設定）
- LiveKit による音声・Spatial Audio・画面共有
- 録音・文字起こし
- AI / Fumiori / Organization Agent 連携
- 本番向けマルチテナント運用

`npm start` のユーザーは **固定の架空デモID** です。本番認証ではありません。このNode版も、署名付き架空IDのブラウザfixtureも、インターネットへ公開しないでください。

## Run

Node.js 22 以上。

```bash
npm start
```

`http://127.0.0.1:4173` を開きます。

別ユーザーを同時に試す場合は、別ブラウザまたは別ブラウザプロファイルを使います。同じブラウザプロファイルのタブはCookieを共有します。

データは `.data/workbenches.json` に保存されます。

## Test

```bash
npm ci
npm test
npm run check
```

## Architecture

```text
Browser / 2.5D DOM+SVG
  -> same-origin HTTP commands
  -> Server-Sent Events
  -> Node local adapter
  -> Workbench domain rules
  -> atomic JSON store

PresenceHub
  -> memory only / TTL
```

remote entryではアプリ状態同期を Cloudflare Durable Objects に分離しました。音声・画面の LiveKit 接続はM1.1レビュー後の別PRです。音量ゼロをアクセス制御に使わず、許可されていない音声はそもそも配信しません。

詳しくは `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `WORK_ORDER.md` を参照してください。
