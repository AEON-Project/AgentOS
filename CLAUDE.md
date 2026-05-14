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
node bin/cli.mjs prepare                          # Pre-flight: ensure ≥1 USDT + facilitator pre-approve (also `--topup-amount <n>` to add more, ≥5 USDT)
node bin/cli.mjs create-image --prompt "<text>"       # Generate AI image via x402 payment
node bin/cli.mjs wallet                           # Check USDT/BNB balance
node bin/cli.mjs gas                              # Transfer BNB for withdraw fees
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
- `funding.mjs` — High-level funding orchestration shared by `prepare` and `create-image`. Exports `fundSessionKey({ sessionAddress, usdtAmount, needGas })` (one WalletConnect session, transfers USDT and/or 0.0003 BNB), `approveFacilitator(privateKey)` (session key broadcasts `ERC20.approve(facilitator, MaxUint256)` directly on-chain), and `promptTopupAmount(minTopup)` (TTY-only tier picker). Also defines `LOW_BALANCE_THRESHOLD = 1` (when `prepare` *triggers* a top-up — kept low so users with comfortable headroom aren't pestered), `MIN_TOPUP_USDT = 5` (the minimum *amount* per top-up, ensuring a single funding lasts a long time), and `TOPUP_PRESETS = [5, 20, 50]` tiers. Keep these two thresholds distinct: trigger ≠ minimum.
- `balance.mjs` — EVM balance/allowance queries via Viem public client on BSC (`getWalletBalance`, `getAllowance`).
- `config.mjs` — Config persistence at `~/.agentos/config.json` (mode 0o600). `resolve(cliValue, envKey, configKey)` enforces the priority chain **CLI args > env vars > config file**. Default `serviceUrl` falls back to `https://ai-api.aeon.xyz`.
- `constants.mjs` — BSC RPC URL (QuickNode), USDT BEP-20 address, x402 facilitator address, WalletConnect default project ID and 5-minute timeout.
- `update-check.mjs` — Synchronous version check on every CLI invocation (`bin/cli.mjs` calls it before parsing argv). When `npm view` reports a newer version, the current process **foreground-installs** the new package, runs its postinstall, then exits with code `2` and a stderr JSON `{ "code": "UPDATE_APPLIED", from, to }` — telling the caller (agent or human) to rerun the same command on the upgraded binary. Foreground (rather than detached background) is intentional: a backgrounded `npm install -g` mid-command leaves the global package half-replaced (new `bin/cli.mjs` registering commands whose `src/commands/*.mjs` files haven't been copied yet), which used to cause `ERR_MODULE_NOT_FOUND` on the very next command.

### Command Modules (`src/commands/`)
Each command module exports a single async function. Pattern: parse options → `resolve()` config (CLI > env > file) → call shared utilities → write JSON to stdout or error JSON to stderr → `process.exit(0|1)`.

**`prepare.mjs` is the proactive entry point.** Reads session key balance + allowance, and triggers funding when either `usdt < LOW_BALANCE_THRESHOLD` (1 USDT) or `allowance == 0`. The funding flow itself enforces a higher *minimum* of `MIN_TOPUP_USDT` (5 USDT) per top-up: `funding.fundSessionKey` (USDT + optional 0.0003 BNB in one WalletConnect session) followed by `funding.approveFacilitator` (session key signs and broadcasts `ERC20.approve(facilitator, MaxUint256)` directly). After this completes the wallet is gasless-ready — every subsequent x402 generation only needs an EIP-712 signature. An explicit `--topup-amount <n>` always forces a transfer regardless of the trigger threshold (this is the canonical way to add more funds later).

**`create-image.mjs` is the lazy fallback.** It chains: `fetchPaymentRequirements` → `getWalletBalance` + `getAllowance` → if balance is short, **same** funding flow as `prepare` (calls `funding.fundSessionKey`) → re-check balances → x402 EIP-712 sign and retry the same URL with `PAYMENT-SIGNATURE` header → download every `data.images[].url` to `~/agentos-images/` and parse PNG/JPEG/WebP headers in-process for width/height/size. In normal usage `prepare` has already funded + approved, so this top-up branch is rarely hit; when it is, the floor is `max(5, requiredUsdt)` — never a "just enough" decimal. The result JSON exposes a `balance: { initial, before, after, charged, topup }` field where `initial` is the wallet USDT before any funding, `before` is after the WalletConnect top-up (or = `initial` if none), and `after` is after the on-chain x402 settlement — chosen so that `initial + topup ≈ before` and `before − charged ≈ after` reconcile, letting the agent render a 3-snapshot money flow (initial → before → after) instead of a single misleading initial→after delta.

**Top-up amount selection** is centralized in `funding.promptTopupAmount(minTopup)` and reused by both `prepare` and `create-image`. The floor is `max(MIN_TOPUP_USDT=5, ceil(shortfall))` — for `prepare` it's always 5; for `create-image` fallback it's 5 today (per-call price ≪ 5) but auto-rises if a future capability charges > 5 USDT. Note this is the *amount* floor, not the *trigger* threshold (`LOW_BALANCE_THRESHOLD = 1` USDT in `prepare`; `requiredUsdt` from the 402 response in `create-image` fallback). 3-way branch when funding is needed:
1. `--topup-amount <usdt>` supplied → CLI uses it directly (must be ≥ floor, else exits with `TOPUP_AMOUNT_TOO_SMALL`).
2. TTY attached, no `--topup-amount` → CLI interactively prompts the user to pick from preset tiers (those ≥ floor) or a custom value (≥ floor).
3. Non-TTY (agent invocation), no `--topup-amount` → CLI exits **before** opening WalletConnect with a JSON containing `code: "TOPUP_REQUIRED"`, `minTopup`, `presets`, etc. The agent surfaces the choices to the user and reruns the same command with `--topup-amount`. This avoids opening a QR session that the agent can't dismiss to ask for input.

### Interactive WalletConnect Constraints
`prepare`, `create-image` (when funding fallback fires), and `gas` all open a local QR page and block waiting for the user to scan in their wallet app (5-minute timeout from `WC_CONNECT_TIMEOUT_MS`). **Never run these commands with `run_in_background: true` and never kill the process while the user is mid-scan** — the on-chain transfer may have already been broadcast, leaving funds in the local wallet that the user paid for but didn't get credited toward generation. Recovery: run `agentos wallet` to check, then re-run the same command without forcing another top-up.

### Key Architectural Concepts

**Session Key Model**: A randomly generated private key stored locally acts as a "session key." The user's main wallet (MetaMask, etc.) funds this key via WalletConnect. The session key then signs x402 payments (gasless EIP-712) for image generation.

**x402 Payment Flow**: `GET /open/ai/x402/skillBoss/create?body=<urlencoded JSON> (decoded { model, inputs: { prompt, aspect_ratio, output_format } }) → HTTP 402 + requirements → client EIP-712 sign → retry same URL with PAYMENT-SIGNATURE → HTTP 200 + { transaction, data: { images: [{url}] } } → CLI downloads & parses meta`. Server endpoint is Spring `@GetMapping("/create") create(@RequestParam String body, ...)`.

**Gas Model**: One-time `approve` tx requires BNB (~0.0003) and is broadcast by the session key during `prepare` (or, as a fallback, lazily by the SDK on the first `create-image` call). Each subsequent generation is gasless (server-paid via x402 facilitator with EIP-712 signature). Withdrawal requires BNB for direct on-chain transfer.

**Pricing Model**: Per-call USDT amount is decided by the server in the 402 response, not hardcoded client-side. The wallet is charged exactly that amount. Top-up amount is user-selected from `[5, 20, 50]` USDT or a custom value, with a floor of `max(MIN_TOPUP_USDT, ceil(requiredUsdt))` USDT (= 5 today, since per-call ≪ 5; auto-rises if a future capability ever costs more). The trigger threshold (when `prepare` *asks* for a top-up) is the separate `LOW_BALANCE_THRESHOLD = 1` USDT — see "Top-up amount selection" above for the 3-way branching by `--topup-amount` flag / TTY presence.

## Key Dependencies
- `viem` — EVM client (balance queries, contract reads)
- `@walletconnect/sign-client` — Wallet connection protocol
- `@aeon-ai-pay/axios` / `@aeon-ai-pay/evm` — Custom x402 protocol wrappers
- `commander` — CLI framework

---

## Development Conventions for AI Contributors (Required Reading)

This section is a **hard contract** for any AI agent (or human) modifying this repo. Skipping any step below is treated as an incomplete change — even if tests pass.

The single most common mistake in this codebase is **doc/code drift**: code is updated, but `SKILL.md` / `README.md` / `references/*.md` still describe the old behavior. The agent (which reads SKILL.md verbatim) then renders stale output, and users see commands that no longer exist or thresholds that don't match. Treat doc updates as part of the code change, not as follow-up work.

### Doc/code sync rule

If a change touches **any** of: command names · CLI flags · default values · exit codes · stdout JSON shape · stderr error codes · numeric thresholds · user-visible strings · verbatim templates → update **every** file in this list within the same change set:

| Layer | File | What to update |
| --- | --- | --- |
| Code | `bin/cli.mjs`, `src/**/*.mjs` | The actual change |
| Project intro | `README.md` | Command examples, "How It Works", Pricing, Prerequisites |
| Project intro (this file) | `CLAUDE.md` | Architecture / Core Modules / Command list / model descriptions |
| Skill spec | `skills/agentos/SKILL.md` | Command Overview, Step 1 / 1.5 / 2 / 3, Decision Routing, Copy Consistency Constraints (Line-Level Templates, Key Phrases) |
| Skill references | `skills/agentos/references/create-image.md` | If `create-image` flags / output JSON / pricing change |
| Skill references | `skills/agentos/references/wallet-ops.md` | If `wallet` / `prepare --topup-amount` / `withdraw` / `gas` change |
| Skill references | `skills/agentos/references/error-handling.md` | If a new error code or error string is introduced |
| Skill references | `skills/agentos/references/copy-constraints.md` | If a new `{placeholder}` is introduced |
| Skill references | `skills/agentos/references/x402-protocol.md` | Only for x402-spec-level (rare) |
| Versioning | `skills/agentos/SKILL.md` frontmatter `metadata.version` **and** `package.json` `version` | Bump together to the same value on every release |

### Architectural rules of thumb

- **Single source of truth per fact.** Numeric constants like `MIN_TOPUP_USDT = 5` and `LOW_BALANCE_THRESHOLD = 1` live in `src/funding.mjs`; docs reference them by *both* name and value so a grep on either lands in the same line.
- **Verbatim templates stay in `SKILL.md`.** Anything the agent must reproduce literally (e.g. `✅ Generated`, `✅ Wallet prepared`, `> Reclaiming funds...`, `> Pre-check in progress...`) lives in `SKILL.md`. Details, edge cases, full field tables go in `references/*.md`. Never split a verbatim block across files.
- **Stdout = JSON, stderr = human.** Every command's stdout must be a single parseable JSON object on the success path; stderr carries progress/diagnostic messages and may be free-form. Do not interleave free-form text into stdout — pipes break.
- **References must resolve.** Every `[label](references/foo.md)` link in `SKILL.md` must point to a real file. Every `../SKILL.md#anchor` from a `references/*.md` must hit a real heading. The pre-merge check below verifies this.
- **No silent renames or removals.** Renaming a command, removing a flag, or changing a default is a breaking change for both users and agents reading old transcripts. Document the prior name as removed in this CLAUDE.md *and* update SKILL.md Command Overview / Decision Routing in the same commit.
- **Foreground over background for risky ops.** Anything that touches WalletConnect or `npm install` runs in the foreground (synchronous), never `spawn(..., { detached: true })` — otherwise mid-operation state inconsistencies bite users (e.g. half-replaced npm package after a backgrounded upgrade — see `update-check.mjs` for the cautionary tale).
- **Carry the user's intent, not yours.** When a user requests a change, prefer modifying existing code/templates rather than introducing a parallel mechanism. Adding a new "v2" of something while keeping "v1" untouched almost always produces drift.

### Pre-merge self-check (run these before declaring done)

```bash
# 1. All CLI commands are syntactically valid and parse correctly
for f in bin/cli.mjs src/**/*.mjs; do node --check "$f" || echo "SYNTAX FAIL: $f"; done
node bin/cli.mjs --help                # confirm the command list matches expectation

# 2. Every reference link in SKILL.md still resolves
cd skills/agentos
grep -oE "references/[a-z-]+\.md" SKILL.md | sort -u | while read f; do
  [ -f "$f" ] && echo "OK   $f" || echo "MISS $f"
done

# 3. No stale references to renamed/removed commands (exclude this CLAUDE.md to avoid self-match
#    on the literal string used in the check itself)
grep -rnH --exclude=CLAUDE.md "agentos topup\|agentos.*--old-flag" --include="*.md" --include="*.mjs" .

# 4. Version numbers in SKILL.md frontmatter and package.json match
node -e 'const fs = require("fs"); const sk = fs.readFileSync("skills/agentos/SKILL.md", "utf8").match(/version:\s*"([^"]+)"/)[1]; const pk = require("./package.json").version; console.log(sk === pk ? "OK version " + sk : "MISMATCH skill="+sk+" pkg="+pk);'
```

If any of the four checks fails, the change is not ready.

### When the contract conflicts with the code

If you find behavior in the code that contradicts what this `CLAUDE.md` describes, the code is wrong by default — surface the conflict to the user rather than silently changing one side. The user gets to decide which is canonical.
