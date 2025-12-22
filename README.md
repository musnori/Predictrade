# PredicTrade (Polymarket-style prototype)

PredicTrade is a centralized Polymarket-style prediction market built on Vercel + @vercel/kv. This prototype focuses on a binary YES/NO order book with fully-collateralized minting (YES + NO = $1).

## Polymarket準拠ポイント

- **YES/NO の2アウトカム**（価格は 0.00〜1.00 / bps 管理）。
- **YES価格 + NO価格 = 1.00** を常に成立（表示価格は YES を基準に補完）。
- **Mint 方式**：YES買い + NO買いが合致した時、合計 $1 で **1 YES + 1 NO share** を生成。
- **表示価格**：bid/ask midpoint。スプレッドが 0.10 を超える場合は last trade を表示。
- **担保ロック**：発注時に available → locked へ移動し、約定時に消費。
- **解決**：admin が outcome を確定し、勝ち share へ 1.00 を分配。
- **Clarification**：rulesUpdates に履歴を append-only で記録。

## 非対応 / 簡略化

- UMA Oracle は未実装（admin が手動で resolve）。
- UI のチャートは簡易表示（orderbook / trades のみ）。
- マーケット作成は admin のみ（proposal は未実装）。

## KV キー設計（v2）

Prefix: `predictrade:pm:v2`

| Key | 内容 |
| --- | --- |
| `idx:users` | userId の Set |
| `idx:events` | eventId の Set |
| `user:{userId}` | `{ userId, displayName, createdAt }` |
| `bal:{userId}` | `{ available, locked, updatedAt }` (units) |
| `event:{eventId}` | market 本体 |
| `order:{eventId}:{orderId}` | order |
| `idx:orders:{eventId}` | orderId の Set |
| `trade:{eventId}:{tradeId}` | trade |
| `idx:trades:{eventId}` | tradeId の List |
| `pos:{eventId}:{userId}` | `{ yesQty, noQty }` |
| `rules:{eventId}` | clarification list |
| `audit:{eventId}` | audit log list |
| `coll:{eventId}` | mint 担保積立 (units) |
| `lock:{name}` | ロック用キー |

Units は整数管理: `PRICE_SCALE = 10000` (10000 units = 1 pt)

## Admin スナップショット

`/api/admin/snapshot?key=ADMIN_KEY` でマーケット・注文板・トレード・ポジション・残高を一覧化します。
