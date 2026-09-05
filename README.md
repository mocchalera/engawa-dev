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

## まだ実装していないもの

- 実ユーザー認証・招待管理
- Cloudflare Workers / Durable Objects への移行
- LiveKit による音声・Spatial Audio・画面共有
- 録音・文字起こし
- AI / Fumiori / Organization Agent 連携
- 本番向けマルチテナント運用

現在のユーザーは **固定の架空デモID** です。本番認証ではありません。ローカル検証専用で、インターネットへ公開しないでください。

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
npm test
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

将来は、アプリ状態同期を Cloudflare Durable Objects、音声・画面を LiveKit に分離する方針です。音量ゼロをアクセス制御に使わず、許可されていない音声はそもそも配信しません。

詳しくは `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `WORK_ORDER.md` を参照してください。
