import { loadConfig, saveConfig, getConfigPath } from "../config.mjs";

export async function setup(opts) {
  const config = loadConfig();
  let changed = false;

  if (opts.serviceUrl) {
    config.serviceUrl = opts.serviceUrl.replace(/\/+$/, "");
    changed = true;
  }

  if (opts.check) {
    let created = false;

    if (!config.privateKey) {
      const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
      const newKey = generatePrivateKey();
      const account = privateKeyToAccount(newKey);
      config.privateKey = newKey;
      config.address = account.address;
      config.mode = "private-key";
      created = true;
    }

    if (created || changed) {
      saveConfig(config);
    }

    const ready = !!(config.serviceUrl && config.privateKey);
    const result = {
      ready,
      created,
      mode: config.mode || null,
      address: config.address || null,
      mainWallet: config.mainWallet || null,
      serviceUrl: config.serviceUrl || null,
    };
    console.log(JSON.stringify(result));
    process.exit(ready ? 0 : 1);
  }

  if (opts.show) {
    const display = { ...config };
    if (display.privateKey) {
      display.privateKey = `${display.privateKey.slice(0, 6)}...${display.privateKey.slice(-4)}`;
    }
    display._configPath = getConfigPath();
    console.log(JSON.stringify(display, null, 2));
    return;
  }

  if (!changed) {
    console.error("Usage:");
    console.error("  agentos setup --check                  (auto-create local wallet if missing)");
    console.error("  agentos setup --show                   (show current config)");
    console.error("  agentos setup --service-url <url>      (override service URL)");
    console.error(`\nConfig file: ${getConfigPath()}`);
    process.exit(1);
  }

  saveConfig(config);
  console.log(JSON.stringify({
    success: true,
    configPath: getConfigPath(),
    serviceUrl: config.serviceUrl || null,
    address: config.address || null,
  }, null, 2));
}
