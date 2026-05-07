/**
 * Synchronous version check + foreground upgrade.
 *
 * Why foreground: a backgrounded `npm install -g` mid-command leaves the
 * globally installed package in a half-replaced state — bin/cli.mjs may
 * already be the new version while src/commands/* is still the old one (or
 * vice versa), causing ERR_MODULE_NOT_FOUND on the very next invocation.
 * Synchronous upgrade keeps the package consistent: either the upgrade
 * succeeds and we exit telling the caller to rerun, or it fails and we
 * continue on the current version.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const PKG_NAME = "@aeon-ai-pay/agentos";

export function checkForUpdates(currentVersion) {
  let latest;
  try {
    latest = execFileSync("npm", ["view", PKG_NAME, "version"], {
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch {
    return; // no network / npm unavailable — silently keep going
  }

  if (!latest || latest === currentVersion) return;

  console.error(`[update] ${PKG_NAME} ${currentVersion} → ${latest}, upgrading (foreground)...`);

  try {
    execFileSync("npm", ["install", "-g", `${PKG_NAME}@${latest}`], {
      timeout: 120000,
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch (e) {
    console.error(`[update] Upgrade failed: ${(e && e.message) || e}. Continuing on ${currentVersion}.`);
    return;
  }

  // Run the new version's postinstall so the skill files in ~/.claude/skills/
  // (or wherever the agent host installed them) are refreshed too.
  try {
    const root = execFileSync("npm", ["root", "-g"], {
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    const postinstall = join(root, PKG_NAME, "scripts", "postinstall.mjs");
    execFileSync("node", [postinstall], { timeout: 30000, stdio: ["ignore", "inherit", "inherit"] });
  } catch (e) {
    console.error(`[update] postinstall failed: ${(e && e.message) || e}`);
  }

  console.error(`[update] Upgraded to ${latest}. Please rerun the previous command on the new version.`);
  console.error(JSON.stringify({
    error: `Upgraded ${PKG_NAME} ${currentVersion} → ${latest}. Rerun the previous command.`,
    code: "UPDATE_APPLIED",
    from: currentVersion,
    to: latest,
  }));
  process.exit(2);
}
