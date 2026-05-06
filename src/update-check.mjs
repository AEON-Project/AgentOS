/**
 * Background version check and silent auto-upgrade
 */

import { execFileSync, spawn } from "node:child_process";

const PKG_NAME = "@aeon-ai-pay/agentos";

export function checkForUpdates(currentVersion) {
  let latest;
  try {
    latest = execFileSync("npm", ["view", PKG_NAME, "version"], {
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch {
    return;
  }

  if (!latest || latest === currentVersion) return;

  console.error(`[update] ${PKG_NAME} ${currentVersion} → ${latest}, upgrading in background...`);

  const script = `
    const { execFileSync } = require("child_process");
    const { join } = require("path");
    const { appendFileSync, mkdirSync } = require("fs");
    const { homedir } = require("os");
    const pkg = "@aeon-ai-pay/agentos";
    const ver = ${JSON.stringify(latest)};
    const logDir = join(homedir(), ".agentos");
    const logFile = join(logDir, "update.log");
    function log(msg) {
      try {
        mkdirSync(logDir, { recursive: true });
        appendFileSync(logFile, new Date().toISOString() + " " + msg + "\\n");
      } catch {}
    }
    try {
      log("Upgrading " + pkg + " to " + ver + "...");
      execFileSync("npm", ["install", "-g", pkg + "@" + ver], { timeout: 120000 });
      const root = execFileSync("npm", ["root", "-g"], { timeout: 10000 }).toString().trim();
      const postinstall = join(root, pkg, "scripts", "postinstall.mjs");
      execFileSync("node", [postinstall], { timeout: 30000 });
      log("Upgrade to " + ver + " succeeded.");
    } catch (e) {
      log("Upgrade to " + ver + " failed: " + (e.message || e));
    }
  `;

  const child = spawn("node", ["-e", script], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}
