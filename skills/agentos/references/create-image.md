# Generate AI Image

## Prerequisites

1. Wallet is configured — run `setup --check` first.
2. Service URL is configured (built-in default is available).
3. The `create-image` command auto-checks allowance/balance and triggers WalletConnect funding when needed; **do not pre-call `topup`**.

## Request Shape

The server signature is `@GetMapping("/create") create(@RequestParam String body, ...)` — the entire JSON payload is passed as the URL-encoded `body` **query parameter**, not as a request body.

```
GET <serviceUrl>/open/ai/x402/skillBoss/create?body=<urlencoded-json>
```

Where the decoded `body` is:
```json
{
  "model": "replicate/black-forest-labs/flux-schnell",
  "inputs": {
    "prompt": "<user prompt>",
    "aspect_ratio": "16:9",
    "output_format": "png"
  }
}
```

The first call returns HTTP 402 with payment requirements; the second call is the **same URL** plus an added `PAYMENT-SIGNATURE` header.

### CLI flags

| Flag | Required | Default | Maps to |
| --- | --- | --- | --- |
| `--prompt <text>` | yes | — | `inputs.prompt` |
| `--aspect-ratio <ratio>` | no | `16:9` | `inputs.aspect_ratio` |
| `--output-format <fmt>` | no | `png` | `inputs.output_format` |
| `--model <id>` | no | `replicate/black-forest-labs/flux-schnell` | `model` |
| `--output <dir>` | no | `~/agentos-images` | local image save directory |
| `--service-url <url>` | no | from config | base URL |
| `--private-key <key>` | no | from config | session key override |

## Workflow

1. Collect a prompt from the user.
2. Run `agentos create-image --prompt "<text>"` (add other flags only if user explicitly asks).
3. CLI does the x402 dance (402 → fund-if-needed → approve-if-needed → signed retry → 200).
4. CLI downloads each `data.images[].url` and reads its format/dimensions/size.
5. Present the result table per image.

## Successful Response

Server returns:
```json
{
  "transaction": "0x...",
  "data": { "images": [ { "url": "https://assets.skillboss.co/....png" } ] }
}
```

CLI emits to stdout:
```json
{
  "success": true,
  "prompt": "<original>",
  "aspectRatio": "16:9",
  "outputFormat": "png",
  "model": "replicate/black-forest-labs/flux-schnell",
  "transaction": "0x...",
  "images": [
    {
      "url": "https://...png",
      "localPath": "/Users/<user>/agentos-images/<file>.png",
      "format": "png",
      "width": 1344,
      "height": 768,
      "sizeBytes": 1016287,
      "sizeHuman": "992.4 KB"
    }
  ],
  "balance": {
    "before": "5.05",
    "after": "4.95",
    "charged": 0.1,
    "topup": null
  },
  "data": { /* full server payload */ },
  "paymentResponse": { "txHash": "0x...", "networkId": "eip155:56" }
}
```

Notes:
- `transaction` (top-level) is the on-chain tx hash returned by the server. Display this — not `paymentResponse.txHash` — in the user-facing table.
- `format/width/height/sizeBytes/sizeHuman` come from local parsing of the downloaded file (PNG/JPEG/WebP headers). Fields may be `null` if the format is unknown.
- A failed download yields `{ url, error }` (no `localPath`/format/dimensions).
- `balance.before` is the USDT balance read before payment; `balance.after` is read after the x402 settlement (may be `null` if the post-payment RPC query failed). `balance.charged` is the USDT amount the server deducted this call. `balance.topup` is the USDT amount the user transferred in via WalletConnect during this run, or `null` if no top-up was needed.

## User-Facing Display Template

After parsing the JSON, render each image as a **key-value list** (not a fixed-width box-drawing table — long paths / tx hashes used to overflow):

```
✅ Generated

📁 Path        {localPath}
🎨 Format      {FORMAT}
📐 Dimensions  {width} × {height}
💾 Size        {sizeHuman}
🔗 Tx          {transaction}
💰 Charged     {charged} USDT
🏦 Balance     {balanceBefore} → {balanceAfter} USDT
```

Rules:
- `✅ Generated` verbatim, then one blank line, then 7 rows.
- Each row: emoji + space + label padded to the longest label width (`Dimensions` = 10) + two spaces + value.
- `{FORMAT}` = uppercase of `images[].format` (e.g. `png` → `PNG`).
- `{width} × {height}` uses U+00D7 with single spaces around it.
- `{transaction}` = full top-level tx hash (not `paymentResponse.txHash`).
- `{charged}` = `balance.charged`; `{balanceBefore}` / `{balanceAfter}` = `balance.before` / `balance.after`. The arrow is U+2192 with single spaces. If `balance.after` is `null`, drop the arrow and after-value, render only `{balanceBefore} USDT (post-balance unavailable)`.
- Multiple images → one block per image, separated by a blank line; the `Charged` / `Balance` rows appear once at the end (not per-image).
- Failed download → one line `❌ Download failed: {error} (source: {imageUrl})` instead of the per-image block.

## Error Handling

| Scenario | CLI Output | Action |
|---|---|---|
| Empty prompt | `Missing --prompt. Provide a non-empty image prompt.` | Ask user for a prompt |
| Wallet not configured | `Wallet not configured` | Run `setup --check` |
| Funding signature timeout (5 min) | `Payment approval timed out. Please try again.` | Relay; do not auto-retry |
| User rejected signature | `Payment approval was rejected. Please try again if you'd like to proceed.` | Relay; do not auto-retry |
| Insufficient balance after funding | `Still insufficient USDT after funding.` | Relay |
| Server network error | Error JSON | Suggest retry / check `serviceUrl` |
| Image download failed | Entry has `error` instead of `localPath` | Show single line `❌ Download failed: {error} (source: {imageUrl})` instead of the per-image block |

## Pricing Model

- Per-call USDT amount is **decided by the server** in the 402 response — not hardcoded client-side.
- Top-up amount selection:
  - **Interactive terminal (TTY)**: CLI prompts the user to choose a tier from `[5, 20, 50]` USDT or a custom amount. Tiers below the shortfall are filtered out, and the custom value must be ≥ shortfall.
  - **Headless (non-TTY)**: CLI auto-funds exactly the shortfall (`requiredUsdt - currentBalance`) — preserving the original behavior so agent skills don't need the user to make a selection.
