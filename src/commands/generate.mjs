import { createX402Api, decodePaymentResponse, fetchPaymentRequirements } from "../x402.mjs";
import { resolve } from "../config.mjs";
import { getWalletBalance, getAllowance } from "../balance.mjs";
import axios from "axios";
import { BSC_RPC_URL, USDT_BSC } from "../constants.mjs";
import {
  withWallet,
  requestERC20Transfer,
  requestNativeTransfer,
  setStatus,
} from "../walletconnect.mjs";
import { mkdirSync, createWriteStream, existsSync, unlinkSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";
import { URL } from "node:url";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

const AUTO_GAS_BNB = "0.0003";
const DEFAULT_IMAGE_DIR = join(homedir(), "agentos-images");
const DEFAULT_MODEL = "replicate/black-forest-labs/flux-schnell";

export async function generate(opts) {
  console.error("Generating image...");
  const serviceUrl = resolve(opts.serviceUrl, "AGENTOS_SERVICE_URL", "serviceUrl");
  const privateKey = resolve(opts.privateKey, "EVM_PRIVATE_KEY", "privateKey");
  const { prompt } = opts;
  const aspectRatio = opts.aspectRatio || "16:9";
  const outputFormat = (opts.outputFormat || "png").toLowerCase();
  const model = opts.model || DEFAULT_MODEL;

  if (!serviceUrl) {
    console.error(JSON.stringify({ error: "Missing service URL. Run: agentos setup --service-url <url> to override." }));
    process.exit(1);
  }
  if (!privateKey) {
    console.error(JSON.stringify({ error: "Wallet not configured. Run: agentos setup --check" }));
    process.exit(1);
  }
  if (!prompt || !prompt.trim()) {
    console.error(JSON.stringify({ error: "Missing --prompt. Provide a non-empty image prompt." }));
    process.exit(1);
  }

  const bodyPayload = {
    model,
    inputs: {
      prompt,
      aspect_ratio: aspectRatio,
      output_format: outputFormat,
    },
  };
  const bodyParam = encodeURIComponent(JSON.stringify(bodyPayload));
  const url = `${serviceUrl}/open/ai/x402/skillBoss/create?body=${bodyParam}`;

  console.error("Fetching payment requirements...");
  let requiredUsdt;
  let paymentReq;
  try {
    paymentReq = await fetchPaymentRequirements(url);
    requiredUsdt = paymentReq.amountUsdt;
    console.error(`Required: ${requiredUsdt} USDT (pay to ${paymentReq.payToAddress})`);
  } catch (e) {
    console.error(JSON.stringify({ error: `Failed to fetch payment requirements: ${e.message}` }));
    process.exit(1);
  }

  console.error("Checking wallet...");
  let needTopup = false;
  let needGas = false;
  let sessionAddress;
  let topupAmount = null;

  try {
    const { address, usdt, bnb, bnbRaw } = await getWalletBalance(privateKey);
    sessionAddress = address;
    const usdtNum = parseFloat(usdt);

    console.error(`Wallet: ${address}`);
    console.error(`Balance: ${usdt} USDT, ${bnb} BNB`);

    const allowance = await getAllowance(address);
    const requiredWei = BigInt(paymentReq.amountWei);
    if (requiredWei === 0n) {
      console.error(JSON.stringify({ error: "Server returned invalid payment amount (0). Please retry later." }));
      process.exit(1);
    }
    if (allowance >= requiredWei) {
      console.error("Allowance sufficient, no approve needed.");
    } else {
      console.error(`Approve authorization insufficient (allowance ${allowance} < required ${requiredWei}), need approve.`);
      if (bnbRaw === 0n) {
        needGas = true;
        console.error("No BNB for approve gas, will request BNB transfer.");
      }
    }

    if (usdtNum < requiredUsdt) {
      needTopup = true;
      const shortfall = requiredUsdt - usdtNum;
      topupAmount = shortfall.toFixed(6);
      console.error(`USDT insufficient: have ${usdtNum}, need ${requiredUsdt}, shortfall ${topupAmount}`);
    }
  } catch (e) {
    console.error(JSON.stringify({ error: `Balance check failed: ${e.message}` }));
    process.exit(1);
  }

  if (needTopup || needGas) {
    console.error("Funding flow triggered...");
    await inlineWalletConnectTopup({
      sessionAddress,
      amount: needTopup ? topupAmount : null,
      needGas,
    });

    console.error("Re-checking wallet balance...");
    try {
      const { usdt, bnbRaw } = await getWalletBalance(privateKey);
      const usdtNum = parseFloat(usdt);

      if (needGas && bnbRaw === 0n) {
        console.error(JSON.stringify({
          error: "No BNB for approve transaction after funding. Run 'agentos gas' to add BNB manually.",
          address: sessionAddress,
        }));
        process.exit(1);
      }
      if (usdtNum < requiredUsdt) {
        console.error(JSON.stringify({
          error: "Still insufficient USDT after funding.",
          required: `${requiredUsdt} USDT`,
          available: `${usdt} USDT`,
          address: sessionAddress,
        }));
        process.exit(1);
      }
    } catch (e) {
      console.error(JSON.stringify({ error: `Balance re-check failed: ${e.message}` }));
      process.exit(1);
    }
  }

  const { client } = createX402Api(privateKey);

  console.error(`Submitting payment & request: ${url}`);

  try {
    const { x402HTTPClient } = await import("@aeon-ai-pay/core/client");
    const httpClient = new x402HTTPClient(client);

    const raw402 = paymentReq.raw402Response;
    const getHeader = (name) => {
      const value = raw402.headers[name] ?? raw402.headers[name.toLowerCase()];
      return typeof value === "string" ? value : undefined;
    };
    const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, raw402.data);

    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    const response = await axios.get(url, {
      headers: {
        ...paymentHeaders,
        "Access-Control-Expose-Headers": "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE",
      },
    });
    const paymentResponse = decodePaymentResponse(response.headers);

    const transaction = response.data?.transaction || paymentResponse?.txHash || null;
    const images = Array.isArray(response.data?.data?.images) ? response.data.data.images : [];

    const outputDir = opts.output || DEFAULT_IMAGE_DIR;
    const downloaded = [];
    if (images.length > 0) {
      mkdirSync(outputDir, { recursive: true });
      for (const img of images) {
        const imgUrl = img?.url;
        if (!imgUrl) continue;
        try {
          const localPath = await downloadImage(imgUrl, outputDir);
          const meta = readImageMeta(localPath);
          downloaded.push({
            url: imgUrl,
            localPath,
            format: meta.format,
            width: meta.width,
            height: meta.height,
            sizeBytes: meta.sizeBytes,
            sizeHuman: meta.sizeHuman,
          });
          console.error(`Saved: ${localPath} (${meta.format || "?"}, ${meta.width || "?"}×${meta.height || "?"}, ${meta.sizeHuman})`);
        } catch (e) {
          console.error(`Failed to download ${imgUrl}: ${e.message}`);
          downloaded.push({ url: imgUrl, error: e.message });
        }
      }
    }

    const result = {
      success: true,
      prompt,
      aspectRatio,
      outputFormat,
      model,
      transaction,
      images: downloaded,
      data: response.data,
      paymentResponse,
    };

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    const result = {
      success: false,
      status: error.response?.status,
      data: error.response?.data,
      error: error.message,
    };
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

async function inlineWalletConnectTopup({ sessionAddress, amount, needGas }) {
  const pageAmount = amount || (needGas ? AUTO_GAS_BNB : null);
  const pageToken = amount ? "USDT" : "BNB";
  const pageGasAmount = (needGas && amount) ? AUTO_GAS_BNB : null;
  await withWallet({ amount: pageAmount, token: pageToken, gasAmount: pageGasAmount }, async ({ signClient, session, peerAddress }) => {
    const { createPublicClient, http } = await import("viem");
    const { bsc } = await import("viem/chains");
    const publicClient = createPublicClient({
      chain: bsc,
      transport: http(BSC_RPC_URL, { timeout: 15000, retryCount: 2 }),
    });

    if (amount) {
      setStatus("signing", { amount, token: "USDT", to: sessionAddress });
      console.error(`\nRequesting USDT transfer: ${amount} USDT → ${sessionAddress}`);
      console.error("Please confirm the transaction in your wallet app...");

      const usdtTxHash = await requestERC20Transfer(signClient, session, {
        from: peerAddress,
        to: sessionAddress,
        token: USDT_BSC,
        amount,
        decimals: 18,
      });
      setStatus("tx_submitted", { txHash: usdtTxHash, amount, token: "USDT" });
      console.error(`USDT transfer submitted: ${usdtTxHash}`);
      console.error("Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: usdtTxHash,
        timeout: 60_000,
      });
      if (receipt.status !== "success") {
        throw new Error("USDT transfer transaction reverted");
      }
      console.error("USDT transfer confirmed.");
    }

    if (needGas) {
      try {
        const activeSessions = signClient.session.getAll();
        const sessionAlive = activeSessions.some(s => s.topic === session.topic);
        if (!sessionAlive) {
          throw new Error("WalletConnect session expired between USDT and BNB transfers. Run 'agentos gas' to add BNB manually.");
        }
      } catch (e) {
        if (e.message.includes("session expired")) throw e;
      }

      setStatus("signing", { amount: AUTO_GAS_BNB, token: "BNB", to: sessionAddress });
      console.error(`\nRequesting BNB transfer: ${AUTO_GAS_BNB} BNB → ${sessionAddress} (for approve gas)`);
      console.error("Please confirm the transaction in your wallet app...");
      const bnbTxHash = await requestNativeTransfer(signClient, session, {
        from: peerAddress,
        to: sessionAddress,
        value: AUTO_GAS_BNB,
      });
      setStatus("tx_submitted", { txHash: bnbTxHash, amount: AUTO_GAS_BNB, token: "BNB" });
      console.error(`BNB transfer submitted: ${bnbTxHash}`);
      const bnbReceipt = await publicClient.waitForTransactionReceipt({
        hash: bnbTxHash,
        timeout: 60_000,
      });
      if (bnbReceipt.status !== "success") {
        throw new Error("BNB transfer reverted");
      }
      console.error("BNB transfer confirmed.");
    }

    setStatus("confirmed", { token: amount ? "USDT" : "BNB" });
  });
}

function readImageMeta(filePath) {
  const sizeBytes = statSync(filePath).size;
  const sizeHuman = humanSize(sizeBytes);

  let format = null;
  let width = null;
  let height = null;

  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const len = readSync(fd, buf, 0, buf.length, 0);

    if (len >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      format = "png";
      width = buf.readUInt32BE(16);
      height = buf.readUInt32BE(20);
    } else if (len >= 4 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      format = "jpeg";
      let i = 2;
      while (i + 9 < len) {
        if (buf[i] !== 0xFF) { i++; continue; }
        while (i < len && buf[i] === 0xFF) i++;
        const marker = buf[i];
        i++;
        if (marker === 0xD8 || marker === 0xD9) continue;
        const segLen = buf.readUInt16BE(i);
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          height = buf.readUInt16BE(i + 3);
          width = buf.readUInt16BE(i + 5);
          break;
        }
        i += segLen;
      }
    } else if (len >= 30 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
      format = "webp";
      const fourCC = buf.slice(12, 16).toString("ascii");
      if (fourCC === "VP8 ") {
        width = buf.readUInt16LE(26) & 0x3FFF;
        height = buf.readUInt16LE(28) & 0x3FFF;
      } else if (fourCC === "VP8L") {
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
        width = ((b1 & 0x3F) << 8 | b0) + 1;
        height = ((b3 & 0x0F) << 10 | b2 << 2 | (b1 & 0xC0) >> 6) + 1;
      } else if (fourCC === "VP8X") {
        width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
        height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
      }
    }
  } catch {
    // 解析失败保持 null
  } finally {
    closeSync(fd);
  }

  return { format, width, height, sizeBytes, sizeHuman };
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function downloadImage(imgUrl, outputDir, { maxRedirects = 5, timeoutMs = 60_000 } = {}) {
  let filename;
  try {
    filename = basename(new URL(imgUrl).pathname) || `image-${Date.now()}.png`;
  } catch {
    filename = `image-${Date.now()}.png`;
  }
  if (!extname(filename)) filename += ".png";

  let target = join(outputDir, filename);
  if (existsSync(target)) {
    const ext = extname(filename);
    const stem = filename.slice(0, filename.length - ext.length);
    let i = 1;
    while (existsSync(join(outputDir, `${stem}-${i}${ext}`))) i++;
    target = join(outputDir, `${stem}-${i}${ext}`);
  }

  return new Promise((resolve, reject) => {
    const fetchOnce = (currentUrl, redirectsLeft) => {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (e) {
        return reject(new Error(`Invalid URL: ${currentUrl}`));
      }
      const httpModule = parsed.protocol === "http:" ? httpGet : httpsGet;

      const req = httpModule(currentUrl, { timeout: timeoutMs }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          return fetchOnce(nextUrl, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${currentUrl}`));
        }

        const file = createWriteStream(target);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(target)));
        file.on("error", (err) => {
          try { unlinkSync(target); } catch {}
          reject(err);
        });
        res.on("error", (err) => {
          file.destroy();
          try { unlinkSync(target); } catch {}
          reject(err);
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
      });
    };

    fetchOnce(imgUrl, maxRedirects);
  });
}
