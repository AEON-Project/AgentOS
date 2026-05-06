import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

export async function clean() {
  const home = homedir();

  try {
    execFileSync("npx", ["skills", "remove", "agentos", "-g", "-y"], {
      stdio: "inherit",
      timeout: 30000,
    });
    console.error("Removed agentos skill via skills CLI");
  } catch {
    const skillDir = join(home, ".claude", "skills", "agentos");
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true });
      console.error("Removed skill:", skillDir);
    }
  }

  try {
    execFileSync("npm", ["uninstall", "-g", "@aeon-ai-pay/agentos"], {
      stdio: "inherit",
      timeout: 30000,
    });
    console.error("Uninstalled @aeon-ai-pay/agentos globally");
  } catch {
    console.error("Global package not installed, skipping uninstall");
  }

  try {
    execFileSync("npm", ["cache", "clean", "--force"], {
      stdio: "inherit",
      timeout: 30000,
    });
    console.error("npm cache cleaned");
  } catch {
    console.error("Failed to clean npm cache, skipping");
  }

  const npxCache = join(home, ".npm", "_npx");
  if (existsSync(npxCache)) {
    rmSync(npxCache, { recursive: true, force: true });
    console.error("Removed npx cache:", npxCache);
  }

  console.error("\nClean complete. Reinstall with:");
  console.error("  npm install -g @aeon-ai-pay/agentos@latest");
}
