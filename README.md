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

ローカルruntimeに加え、別途承認された限定pilotで実際のCloudflare Access認証、同一所有者の別PC同期、別アカウントの権限境界、期限切れ、同一ソース再デプロイ後の保存状態を確認しました。検証用の追加権限は撤去し、所有者専用へ復元済みです。一般公開・本番運用の認定ではありません。

**異なる実アカウントを使う二台のPCでの一連の協働操作など、最終受け入れは残っています。** 実施済みと未確認の区別は `docs/VERIFICATION-PILOT.md`、設定手順は `docs/PILOT.md` を参照してください。`docs/VERIFICATION-M1.md` は初回実装時点の履歴として保持しています。

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

remote entryではアプリ状態同期を Cloudflare Durable Objects に分離しました。音声・画面の LiveKit 接続は次のGateです。音量ゼロをアクセス制御に使わず、許可されていない音声はそもそも配信しません。

詳しくは `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `WORK_ORDER.md` を参照してください。
