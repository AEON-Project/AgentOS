# AEON AgentOS

AEON AgentOS is a platform-level execution system for AI Agents. It connects skill invocation, task execution, authorized payment and settlement networks — enabling Agents to not only understand user intent, but to call different skills within the user's authorization scope and complete real-world purchases, content generation, data calls, subscriptions, bookings and transaction execution via wallet and Card payment capabilities.

**Currently open skill**: AI image generation — generate images from a text prompt, paying per request with USDT on BSC via the [x402 protocol](https://www.x402.org/).

## Install Skill

```bash
# Install to all detected agents (Claude Code, Cursor, Codex, OpenClaw, Gemini CLI, etc.)
npx skills add AEON-Project/AgentOS -g -y

# Install to specific agents
npx skills add AEON-Project/AgentOS -a claude-code -a cursor -a codex -g -y
```

Supported agents: Claude Code, Cursor, Codex, OpenClaw, Gemini CLI, GitHub Copilot, Windsurf, Roo Code, and [39+ more](https://agentskills.io).

## CLI Usage

```bash
# First run: auto-create local wallet (private key generated locally, never uploaded)
npx @aeon-ai-pay/agentos setup --check

# Generate an image (auto-funds via WalletConnect when balance is insufficient)
# On success, every image in the response is downloaded to ~/agentos-images/
npx @aeon-ai-pay/agentos create-image --prompt "a cyberpunk fox under neon rain"

# Choose aspect ratio / output format / model (defaults shown)
npx @aeon-ai-pay/agentos create-image \
  --prompt "An orange tabby cat playing in the snow, cinematic lighting" \
  --aspect-ratio 16:9 \
  --output-format png \
  --model replicate/black-forest-labs/flux-schnell

# Save downloads to a custom directory
npx @aeon-ai-pay/agentos create-image --prompt "..." --output ./out

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
