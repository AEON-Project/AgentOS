# AEON AgentOS

AEON AgentOS 是一个面向 AI Agent 的平台级执行系统，连接技能调用、任务执行、授权支付与结算网络。它让 Agent 不只是理解用户意图，而是可以在用户授权范围内调用不同的技能，并通过 wallet、Card 等支付能力完成真实世界的服务购买、内容生成、数据调用、订阅、预订和交易执行。

**当前开放技能**：AI 图片生成 — 通过 [x402 协议](https://www.x402.org/)，以 USDT（BSC）按次付费生成 AI 图片。

## Install Skill

```bash
# Install to all detected agents (Claude Code, Cursor, Codex, OpenClaw, Gemini CLI, etc.)
npx skills add AEON-Project/agentos -g -y

# Install to specific agents
npx skills add AEON-Project/agentos -a claude-code -a cursor -a codex -g -y
```

Supported agents: Claude Code, Cursor, Codex, OpenClaw, Gemini CLI, GitHub Copilot, Windsurf, Roo Code, and [39+ more](https://agentskills.io).

## CLI Usage

```bash
# First run: auto-create local wallet (private key generated locally, never uploaded)
npx @aeon-ai-pay/agentos setup --check

# Generate an image (auto-funds via WalletConnect when balance is insufficient)
# On success, every image in the response is downloaded to ~/agentos-images/
npx @aeon-ai-pay/agentos generate --prompt "a cyberpunk fox under neon rain"

# Choose aspect ratio / output format / model (defaults shown)
npx @aeon-ai-pay/agentos generate \
  --prompt "An orange tabby cat playing in the snow, cinematic lighting" \
  --aspect-ratio 16:9 \
  --output-format png \
  --model replicate/black-forest-labs/flux-schnell

# Save downloads to a custom directory
npx @aeon-ai-pay/agentos generate --prompt "..." --output ./out

# Check wallet balance (BNB + USDT)
npx @aeon-ai-pay/agentos wallet

# Manually top up USDT to local wallet
npx @aeon-ai-pay/agentos topup --amount 1

# Top up BNB gas for local wallet
npx @aeon-ai-pay/agentos gas --amount 0.001

# Withdraw remaining funds (USDT + BNB) back to main wallet
npx @aeon-ai-pay/agentos withdraw

# Show current configuration
npx @aeon-ai-pay/agentos setup --show

# Uninstall skill and clear cache
npx @aeon-ai-pay/agentos clean
```

## Prerequisites

- Node.js >= 18
- A mobile wallet app with WalletConnect support (MetaMask, OKX Wallet, Trust Wallet, etc.)
- USDT (BEP-20) on BSC for image-generation payments
- A small amount of BNB for approve gas (~$0.002/tx, only needed on first authorization)

## How It Works

```
1. CLI auto-generates a session key (disposable wallet) locally
2. On generate, if balance is insufficient, auto-funds via WalletConnect QR scan (USDT + BNB gas)
   - Top-up amount = exactly the shortfall (requiredUsdt - currentBalance)
3. First use requires a one-time approve authorization (unlimited allowance, no repeat needed)
4. Session key auto-signs the x402 payment — no manual confirmation required
5. Server returns the generated image (URLs); CLI downloads each, reads dimensions/size

Agent flow:
  User prompt -> Agent activates skill -> x402 two-phase protocol:
    1. GET /open/ai/x402/skillBoss/create?body=<urlencoded JSON>
       (decoded: { model, inputs: { prompt, aspect_ratio, output_format } })
                                              -> HTTP 402 + payment requirements
    2. Session key EIP-712 signature, retry same URL with PAYMENT-SIGNATURE header
                                              -> HTTP 200, { transaction, data: { images } }
    3. CLI downloads each images[].url to ~/agentos-images/, parses
       PNG/JPEG/WebP headers for width × height, fs.stat for size
```

## Pricing

- Per-call USDT amount is **decided by the server** in the 402 response — not hardcoded client-side.
- The wallet is charged exactly that amount. Top-up covers exactly the shortfall (`requiredUsdt - currentBalance`).

## Configuration

Config is stored in `~/.agentos/config.json` (file permissions 600).

Run `setup --check` to auto-generate a local wallet. The main wallet private key is **never** stored locally — only the session key (a locally generated disposable wallet) is saved. Funding is done via WalletConnect QR scan.

Override the default service URL (optional):
```bash
npx @aeon-ai-pay/agentos setup --service-url https://custom-api.example.com
```

## License

MIT
