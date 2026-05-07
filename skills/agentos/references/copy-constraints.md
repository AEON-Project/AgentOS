# Copy Consistency Constraints — Variable Mapping

This file backs the [Copy Consistency Constraints section in SKILL.md](../SKILL.md#copy-consistency-constraints-required-reading). The Line-Level Templates table, Key Phrases list, and Prohibited Deviations rules stay in SKILL.md (they're short, agent-critical regression guardrails). The detailed Variable Mapping table — the single source of truth for which JSON field each `{placeholder}` resolves to — lives here for full lookup.

---

## Variable Mapping (full)

| Placeholder | Source |
| --- | --- |
| `{last4}` | Last 4 characters of `address` from `setup --check` / `wallet` / `withdraw` output |
| `{prompt}` | `prompt` field from `create-image` output |
| `{localPath}` | `images[].localPath` from `create-image` output |
| `{format}` | `images[].format` (uppercase when displayed) |
| `{width}` / `{height}` | `images[].width` / `images[].height` |
| `{sizeHuman}` | `images[].sizeHuman` |
| `{transaction}` | top-level `transaction` field |
| `{charged}` | `balance.charged` from `create-image` output (USDT deducted this call) |
| `{topup}` | `balance.topup` from `create-image` (or top-level `topup` from `prepare`) — USDT funded this call; `null` ⇒ skip Top-up row |
| `{initial}` | `balance.initial` from `create-image` (wallet USDT before any top-up this call) |
| `{before}` / `{after}` | `balance.before` (USDT before the on-chain charge = after any top-up) / `balance.after` (USDT after the on-chain charge). Should satisfy `before − charged ≈ after`. |
| `{initialUsdt}` | top-level `initialUsdt` from `prepare` output (wallet USDT before any funding this run; `prepare`-only) |
| `{approveTx}` | top-level `approveTx` from `prepare` output (the on-chain approve tx hash; `null` ⇒ skip Approve row) |
| `{amount}` | `withdrawn` field from `withdraw` output |
| `{minTopup}` | top-level `minTopup` from a `TOPUP_REQUIRED` stderr JSON (= `max(5, requiredUsdt)` USDT) |
| `{currentBalance}` | top-level `currentBalance` from a `TOPUP_REQUIRED` stderr JSON |
| `{presets}` | top-level `presets` array from a `TOPUP_REQUIRED` stderr JSON (e.g. `[5, 20, 50]`); render joined by ` / ` |

---

## Cross-References

- Line-Level Templates table — see SKILL.md → Copy Consistency Constraints → Line-Level Templates.
- Key Phrases list — see SKILL.md → Copy Consistency Constraints → Key Phrases.
- Prohibited Deviations — see SKILL.md → Copy Consistency Constraints → Prohibited Deviations.
- The `✅ Generated` template (Case A) and its row rules — SKILL.md Step 2.2 → Case A.
- The `✅ Wallet prepared` template (1.5.D) and its row rules — SKILL.md Step 1.5 → 1.5.D.
- The `💸 Top up required (...)` user-prompt template (B.3) and its rules — SKILL.md Step 2.2 → Case B.3.
