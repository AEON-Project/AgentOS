# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@aeon-ai-pay/agentos` — AEON AgentOS is a platform-level execution system for AI Agents. It connects skill invocation, task execution, authorized payment and settlement networks. Currently open skill: **AI image generation**, paid per-request via the x402 HTTP payment protocol with USDT (BEP-20) on BSC.

User supplies a `prompt`; the CLI handles wallet setup, x402 payment, and returns the generated image.

The single business endpoint is `GET /open/ai/x402/skillBoss/create?prompt=<text>`.

Published as both a global npm CLI (`agentos`) and an agent skill compatible with Claude Code, Cursor, Codex, and 39+ platforms.

## Commands

```bash
# Run CLI commands directly
node bin/cli.mjs setup                            # Generate local wallet, show config
node bin/cli.mjs create-image --prompt "<text>"       # Generate AI image via x402 payment
node bin/cli.mjs wallet                           # Check USDT/BNB balance
node bin/cli.mjs topup                            # Transfer USDT via WalletConnect
node bin/cli.mjs gas                              # Transfer BNB for tx fees
node bin/cli.mjs withdraw                         # Reclaim funds from session key
node bin/cli.mjs clean                            # Uninstall skill & clear cache

# Or via npm scripts
npm run create-image -- --prompt "..."
npm run wallet

# Release
node scripts/release.mjs
```

No build step — all source is native ES Modules (`.mjs`), executed directly by Node.js. **Requires Node.js >= 25** (enforced by a hard check at the top of `bin/cli.mjs` and the `engines` field in `package.json`). No test suite exists.

**Stdout vs stderr convention**: command modules write structured JSON results (final success/failure payload) to **stdout** via `console.log`, and write all progress / status / human-readable diagnostics to **stderr** via `console.error`. Errors are also emitted as JSON on stderr before `process.exit(1)`. When piping output, only stdout is parseable JSON.

## Architecture

### Entry Points
- `bin/cli.mjs` — Commander.js CLI definition, lazy-loads command modules. Also contains a global `uncaughtException` guard for a known WalletConnect v2 relay bug (`isJsonRpcPayload` null-frame TypeError) — do not remove this guard.
- `skills/agentos/SKILL.md` — Agent skill specification (triggers, opening protocol, workflow). Contains **verbatim copy constraints** for output templates that an agent operator must reproduce exactly (see "Copy Consistency Constraints" in that file).
- `scripts/postinstall.mjs` — Auto-installs skill into detected AI coding agents on `npm install -g`. First tries `npx skills add ...`; falls back to copying `skills/agentos/` directly into `~/.claude/skills/agentos/`.

### Core Modules (`src/`)
- `x402.mjs` — x402 protocol client: wraps axios with EIP-712 signing via `@aeon-ai-pay/axios` + `@aeon-ai-pay/evm`. `fetchPaymentRequirements()` does an unsigned GET expecting HTTP 402 and parses the `accepts[0]` payload. Also installs an axios interceptor that captures `orderNo` from the 402 body for later correlation.
- `walletconnect.mjs` — WalletConnect v2 integration: QR code UI (custom HTML page served by a local status server), session lifecycle, ERC20 transfers (USDT + BNB). Largest file in the codebase (~45 KB) — most non-trivial logic lives here.
- `balance.mjs` — EVM balance/allowance queries via Viem public client on BSC (`getWalletBalance`, `getAllowance`).
- `config.mjs` — Config persistence at `~/.agentos/config.json` (mode 0o600). `resolve(cliValue, envKey, configKey)` enforces the priority chain **CLI args > env vars > config file**. Default `serviceUrl` falls back to `https://aeon-qrpay-dev.alchemytech.cc`.
- `constants.mjs` — BSC RPC URL (QuickNode), USDT BEP-20 address, x402 facilitator address, WalletConnect default project ID and 5-minute timeout.
- `update-check.mjs` — Background auto-update detection via `npm view`.

### Command Modules (`src/commands/`)
Each command module exports a single async function. Pattern: parse options → `resolve()` config (CLI > env > file) → call shared utilities → write JSON to stdout or error JSON to stderr → `process.exit(0|1)`.

**`create-image.mjs` is the orchestration hot path.** It chains: `fetchPaymentRequirements` → `getWalletBalance` + `getAllowance` → optional `inlineWalletConnectTopup` (USDT top-up + 0.0003 BNB if no BNB and approve needed) → re-check balances → x402 EIP-712 sign and retry the same URL with `PAYMENT-SIGNATURE` header → download every `data.images[].url` to `~/agentos-images/` and parse PNG/JPEG/WebP headers in-process for width/height/size. After payment, re-queries USDT balance and emits a `balance: { before, after, charged, topup }` field in the result JSON for the agent to display.

**Top-up amount selection** (3-way branch when USDT is short):
1. `--topup-amount <usdt>` supplied → CLI uses it directly (must be ≥ shortfall, else exits with `TOPUP_AMOUNT_TOO_SMALL`).
2. TTY attached, no `--topup-amount` → CLI interactively prompts the user to pick from `[5, 20, 50]` USDT or a custom value (≥ shortfall).
3. Non-TTY (agent invocation), no `--topup-amount` → CLI exits **before** opening WalletConnect with a JSON containing `code: "TOPUP_REQUIRED"`, `shortfall`, `presets`, etc. The agent surfaces the choices to the user and reruns the same command with `--topup-amount`. This avoids opening a QR session that the agent can't dismiss to ask for input.

### Interactive WalletConnect Constraints
`create-image`, `topup`, and `gas` all open a local QR page and block waiting for the user to scan in their wallet app (5-minute timeout from `WC_CONNECT_TIMEOUT_MS`). **Never run these commands with `run_in_background: true` and never kill the process while the user is mid-scan** — the on-chain transfer may have already been broadcast, leaving funds in the local wallet that the user paid for but didn't get credited toward generation. Recovery: run `agentos wallet` to check, then re-run `create-image` (do NOT re-topup).

### Key Architectural Concepts

**Session Key Model**: A randomly generated private key stored locally acts as a "session key." The user's main wallet (MetaMask, etc.) funds this key via WalletConnect. The session key then signs x402 payments (gasless EIP-712) for image generation.

**x402 Payment Flow**: `GET /open/ai/x402/skillBoss/create?body=<urlencoded JSON> (decoded { model, inputs: { prompt, aspect_ratio, output_format } }) → HTTP 402 + requirements → client EIP-712 sign → retry same URL with PAYMENT-SIGNATURE → HTTP 200 + { transaction, data: { images: [{url}] } } → CLI downloads & parses meta`. Server endpoint is Spring `@GetMapping("/create") create(@RequestParam String body, ...)`.

**Gas Model**: One-time `approve` tx requires BNB (~0.0003). Each generation itself is gasless (server-paid). Withdrawal requires BNB for direct on-chain transfer.

**Pricing Model**: Per-call USDT amount is decided by the server in the 402 response, not hardcoded client-side. The wallet is charged exactly that amount. Top-up amount is user-selected from `[5, 20, 50]` USDT or a custom value (with a floor of `requiredUsdt - currentBalance`); see "Top-up amount selection" above for the 3-way branching by `--topup-amount` flag / TTY presence.

## Key Dependencies
- `viem` — EVM client (balance queries, contract reads)
- `@walletconnect/sign-client` — Wallet connection protocol
- `@aeon-ai-pay/axios` / `@aeon-ai-pay/evm` — Custom x402 protocol wrappers
- `commander` — CLI framework
