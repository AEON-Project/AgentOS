# Wallet Operations — Reference

This file documents the wallet-management commands referenced from [Step 3 in SKILL.md](../SKILL.md#step-3-wallet-management):

- [`agentos wallet`](#1-check-local-wallet-balance) — read-only balance/address query
- [`agentos prepare --topup-amount <usdt>`](#2-add-more-usdt) — add more USDT (also documented in Step 1.5 of SKILL.md)
- [`agentos withdraw`](#3-withdraw-funds-to-main-wallet) — reclaim USDT from session key back to main wallet
- [`agentos gas`](#4-top-up-gas-for-local-wallet-bnb) — transfer BNB only (typically used before `withdraw`)

These flows are only needed when the user explicitly asks about balance, top-up, withdraw, or gas. The image-generation main path lives in SKILL.md.

---

## 1. Check Local Wallet Balance

```bash
agentos wallet
```

Shows local wallet USDT balance and address. If `prepare` (or any earlier WalletConnect funding flow) has connected the main wallet at least once, the main wallet balance is displayed too.

---

## 2. Add More USDT

```bash
agentos prepare --topup-amount <usdt>          # Force a transfer (>= 5 USDT) even if already prepared
```

`prepare` is the only way the CLI moves USDT from the main wallet into the session key. Without `--topup-amount`, it's a pre-flight that exits immediately when the wallet is already ready. With `--topup-amount` it always opens a WalletConnect QR and transfers the specified amount.

> 💡 No need to top up BNB separately — `prepare` auto-requests 0.0003 BNB when it detects no allowance and no BNB.

For the success display template (`✅ Wallet prepared` with Top-up / Approve / Balance / Address rows), see SKILL.md Step 1.5.D.

---

## 3. Withdraw Funds to Main Wallet

```bash
agentos withdraw                                  # Withdraw all USDT to recorded mainWallet
agentos withdraw --amount <usdt>                  # Specify amount
agentos withdraw --to 0xMainWallet                # Specify destination address
agentos withdraw --to 0xMainWallet --amount <usdt>
```

> ⚠️ **Withdraw requires BNB for gas**:
> Unlike x402 generation (gasless), `withdraw` is a **direct on-chain ERC20 transfer** from the local wallet,
> which must pay BNB gas itself (recommended >= 0.0005 BNB).
> Users need to transfer a small amount of BNB to the local wallet address from an exchange or their own wallet.

### Destination Address Resolution Priority

1. CLI argument `--to <address>`
2. `mainWallet` in `~/.agentos/config.json` (**only available after `prepare` (or any other WalletConnect flow) has connected the main wallet at least once**)

### Output Template (**copy must be verbatim**, variable substitution only)

```
> Reclaiming funds...

From: 0x0...{session_last4}
To: main wallet (0x0...{main_last4})

Amount: {amount} USDT
Status: completed
```

> The literal "main wallet" label is a spec requirement — **do not omit it**; the address in parentheses lets the user confirm the transfer target.

### Edge Cases

| Error | Meaning | Action |
| --- | --- | --- |
| `No main wallet address found. Use --to <address>` | No mainWallet in config and no `--to` provided | Ask user to provide destination address |
| `No USDT to withdraw.` | Local wallet USDT balance is 0 | Inform user nothing to withdraw, suggest `prepare` first |
| `No BNB for gas. ...` | Local wallet has no BNB, cannot pay gas | Prompt user to run `agentos gas` to top up BNB via WalletConnect; see section 4 below |
| `Requested X USDT but only Y available` | `--amount` exceeds actual balance | Show actual balance, ask user to confirm a new amount |
| `Withdraw failed: ...` | On-chain transaction failed | Show raw error, suggest retrying later |

---

## 4. Top Up Gas for Local Wallet (BNB)

When `withdraw` reports `No BNB for gas` or additional BNB is needed, use the dedicated `gas` subcommand to transfer a small amount of BNB from the main wallet via WalletConnect.

```bash
agentos gas                    # Default 0.001 BNB
agentos gas --amount 0.002     # Custom amount
```

⚠️ **This command uses an interactive WalletConnect flow** (same mechanism as `prepare`):
- Terminal prints QR code + `wc:` URI
- User scans with wallet app to connect main wallet
- Confirms 1 BNB transfer in wallet (amount = `<amount>`, target = local wallet)
- Maximum wait 5 minutes, **must not run in background**

On success, `mainWallet` is automatically saved to config (so subsequent `withdraw` can omit `--to`).

### Output Template

```
> Topping up gas...
Initializing WalletConnect session...
Waiting for wallet confirmation...
BNB transfer confirmed.

Local wallet: 0x0...{last4}
Balance: {bnb} BNB
```

### Edge Cases

| Error | Action |
| --- | --- |
| `Transaction rejected in wallet.` | Inform user it was cancelled, ask if they want to retry. **Do not auto-retry** |
| `BNB transfer failed: ...` | Main wallet BNB insufficient or on-chain revert; prompt user to prepare BNB in main wallet first |
| WalletConnect 5-minute timeout | Inform user of timeout, suggest re-running `gas` |
