/**
 * prepare: pre-flight check before any image generation.
 *
 * Ensures the local session key has:
 *   - >= LOW_BALANCE_THRESHOLD (1) USDT balance — the trigger; above this we
 *     leave the wallet alone instead of pestering for refunds.
 *   - an unlimited approve to the x402 facilitator (so the SDK never has to
 *     do a lazy approve at payment time).
 *
 * Triggers a WalletConnect funding flow when either is missing. When the user
 * is asked to fund, the floor is MIN_TOPUP_USDT (5 USDT) per top-up so a single
 * funding lasts a long time. An explicit --topup-amount <usdt> always forces a
 * transfer regardless of the trigger threshold.
 */
import { resolve } from "../config.mjs";
import { getWalletBalance, getAllowance } from "../balance.mjs";
import {
  fundSessionKey,
  approveFacilitator,
  promptTopupAmount,
  LOW_BALANCE_THRESHOLD,
  MIN_TOPUP_USDT,
  TOPUP_PRESETS,
} from "../funding.mjs";

export async function prepare(opts) {
  console.error("Pre-flight: verifying wallet readiness...");
  const privateKey = resolve(opts.privateKey, "EVM_PRIVATE_KEY", "privateKey");
  if (!privateKey) {
    console.error(JSON.stringify({ error: "Wallet not configured. Run: agentos setup --check" }));
    process.exit(1);
  }

  let address, usdt, bnb, bnbRaw;
  try {
    ({ address, usdt, bnb, bnbRaw } = await getWalletBalance(privateKey));
  } catch (e) {
    console.error(JSON.stringify({ error: `Balance check failed: ${e.message}` }));
    process.exit(1);
  }
  const usdtNum = parseFloat(usdt);
  console.error(`Wallet: ${address}`);
  console.error(`Balance: ${usdt} USDT, ${bnb} BNB`);

  console.error("Checking facilitator allowance...");
  let allowance;
  try {
    allowance = await getAllowance(address);
  } catch (e) {
    console.error(JSON.stringify({ error: `Allowance check failed: ${e.message}` }));
    process.exit(1);
  }
  console.error(`Allowance: ${allowance === 0n ? "0 (approve required)" : "already approved"}`);

  const explicitTopup = opts.topupAmount != null && String(opts.topupAmount).trim() !== "";
  // Trigger a top-up only when the wallet is genuinely running out (< 1 USDT,
  // ~50 image generations of headroom). Anything above that is left alone so
  // users aren't pestered to refund while they still have plenty of credits.
  const balanceLow = usdtNum < LOW_BALANCE_THRESHOLD;
  // Explicit --topup-amount forces a transfer even if already prepared, so users
  // (or agents) can deliberately add more funds without needing a separate command.
  const needTopup = balanceLow || explicitTopup;
  const needApprove = allowance === 0n;
  const needGas = needApprove && bnbRaw === 0n;

  if (!needTopup && !needApprove) {
    console.error("Wallet already prepared (balance ≥ minimum, facilitator approved).");
    console.log(JSON.stringify({
      ready: true,
      address,
      initialUsdt: usdt,
      usdt,
      bnb,
      allowance: allowance.toString(),
      topup: null,
      approveTx: null,
    }, null, 2));
    process.exit(0);
  }

  let topupAmount = null;
  if (needTopup) {
    if (balanceLow) {
      console.error(`USDT balance ${usdtNum} is below the ${LOW_BALANCE_THRESHOLD} USDT low-balance threshold; a top-up of ≥ ${MIN_TOPUP_USDT} USDT is required.`);
    } else {
      console.error(`Explicit top-up requested via --topup-amount (balance ${usdtNum} USDT already ≥ ${MIN_TOPUP_USDT}).`);
    }
    if (explicitTopup) {
      const amt = Number(opts.topupAmount);
      if (!Number.isFinite(amt) || amt <= 0) {
        console.error(JSON.stringify({ error: `Invalid --topup-amount: ${opts.topupAmount}` }));
        process.exit(1);
      }
      if (amt < MIN_TOPUP_USDT) {
        console.error(JSON.stringify({
          error: `--topup-amount ${amt} USDT is below the ${MIN_TOPUP_USDT} USDT minimum.`,
          code: "TOPUP_AMOUNT_TOO_SMALL",
          minTopup: MIN_TOPUP_USDT,
        }));
        process.exit(1);
      }
      topupAmount = String(opts.topupAmount);
      console.error(`Using --topup-amount: ${topupAmount} USDT`);
    } else if (process.stdin.isTTY) {
      topupAmount = await promptTopupAmount(MIN_TOPUP_USDT);
      console.error(`Selected top-up amount: ${topupAmount} USDT`);
    } else {
      console.error(JSON.stringify({
        error: `USDT balance ${usdt} is below the ${LOW_BALANCE_THRESHOLD} USDT low-balance threshold; a top-up of ≥ ${MIN_TOPUP_USDT} USDT is required. Choose an amount and rerun with --topup-amount <usdt>.`,
        code: "TOPUP_REQUIRED",
        threshold: LOW_BALANCE_THRESHOLD,
        minTopup: MIN_TOPUP_USDT,
        currentBalance: usdt,
        address,
        presets: TOPUP_PRESETS,
        hint: `Rerun: agentos prepare --topup-amount <usdt>`,
      }));
      process.exit(1);
    }
  }

  if (needTopup || needGas) {
    const willTransfer = [];
    if (needTopup) willTransfer.push(`${topupAmount} USDT`);
    if (needGas) willTransfer.push(`${"0.0003"} BNB (approve gas)`);
    console.error(`Funding flow triggered (${willTransfer.join(" + ")})...`);
    console.error("Opening WalletConnect QR — please scan with your wallet app.");
    try {
      await fundSessionKey({
        sessionAddress: address,
        usdtAmount: needTopup ? topupAmount : null,
        needGas,
      });
    } catch (e) {
      console.error(JSON.stringify({ error: `Funding failed: ${e.message}`, address }));
      process.exit(1);
    }
  }

  let approveTx = null;
  if (needApprove) {
    let postBnbRaw = bnbRaw;
    if (needGas) {
      try {
        const post = await getWalletBalance(privateKey);
        postBnbRaw = post.bnbRaw;
      } catch (e) {
        console.error(`Post-funding balance re-check failed: ${e.message}`);
      }
    }
    if (postBnbRaw === 0n) {
      console.error(JSON.stringify({
        error: "No BNB available for approve transaction. Run 'agentos gas' to add BNB manually.",
        address,
      }));
      process.exit(1);
    }
    try {
      approveTx = await approveFacilitator(privateKey);
    } catch (e) {
      console.error(JSON.stringify({ error: `Pre-authorize failed: ${e.message}`, address }));
      process.exit(1);
    }
  }

  let finalUsdt = usdt;
  let finalBnb = bnb;
  let finalAllowance = allowance;
  try {
    const final = await getWalletBalance(privateKey);
    finalUsdt = final.usdt;
    finalBnb = final.bnb;
    finalAllowance = await getAllowance(address);
  } catch (e) {
    console.error(`Final balance/allowance check failed: ${e.message}`);
  }

  console.log(JSON.stringify({
    ready: true,
    address,
    initialUsdt: usdt,
    usdt: finalUsdt,
    bnb: finalBnb,
    allowance: finalAllowance.toString(),
    topup: topupAmount,
    approveTx,
  }, null, 2));
  process.exit(0);
}
