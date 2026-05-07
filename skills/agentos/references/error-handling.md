# Error Handling — `create-image` Scenario Branches

This file documents the non-success branches of [Step 2.2 in SKILL.md](../SKILL.md#22-scenario-branches). The success path (Case A) and the user-interactive top-up flow (Case B.3) stay in `SKILL.md` because they contain verbatim copy templates that the agent must reproduce literally; everything else is here.

> See also: [`create-image.md`](./create-image.md) for full field-level documentation of the `create-image` JSON shape, CLI flags, and pricing model.

---

## Case B — Funding Signature Timeout (5 minutes)

CLI returns:

```json
{"error":"Payment approval timed out. Please try again."}
```

**Action**: Relay the error to the user verbatim and ask whether they want to retry. **Do not auto-retry.**

---

## Case B.1 — User Rejected Signature

CLI returns:

```json
{"error":"Payment approval was rejected. Please try again if you'd like to proceed."}
```

**Action**: Relay the error to the user verbatim. **Do not auto-retry.**

---

## Case B.2 — Insufficient Balance After Funding

CLI returns the error string `Still insufficient USDT after funding`. Typically means the user's main wallet did not actually send enough USDT (e.g. confirmed transaction was for less than expected, or the network rolled back).

**Action**: Relay the error to the user. They can either rerun `agentos prepare --topup-amount <usdt>` to add more or run `agentos wallet` to confirm the actual on-chain balance.

---

## Case C — Server Network/Call Failure

CLI returns `success: false` with a non-2xx HTTP status. Stdout is empty; stderr contains the JSON error payload.

```json
{
  "success": false,
  "status": 502,
  "data": { /* server response or null */ },
  "error": "Request failed with status code 502"
}
```

**Action**: Show the raw error to the user. Suggest they retry shortly or check `serviceUrl` (override via `agentos setup --service-url <url>` if a custom backend is in use).

---

## Case D — Empty / Invalid Prompt

CLI returns:

```json
{"error":"Missing --prompt. Provide a non-empty image prompt."}
```

**Action**: Ask the user to supply a prompt. **Never invent a prompt** on their behalf — see *Global Prohibited Behaviors* in `SKILL.md`.

---

## Routing Notes

- **Case B.3 (TOPUP_REQUIRED — agent must ask user to choose amount)** is documented in `SKILL.md` itself (Step 2.2 → Case B.3 and Step 1.5.B), because it includes a verbatim copy template that the agent must reproduce literally.
- **WalletConnect backgrounding recovery** ("paid but not detected" because the process was killed mid-scan) is documented in `SKILL.md` Step 2.1.
- **Prepare-flow errors** (1.5.B headless top-up required, 1.5.C funding rejected/timed out) reuse the same handling rules as Cases B / B.1 / B.3 above; see Step 1.5 in `SKILL.md` for the routing.
