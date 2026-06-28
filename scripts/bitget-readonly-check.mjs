import { bitgetReadonlyEnabled, hasBitgetReadonlyCredentials, fetchBitgetSpotAssets, getBitgetSyncSymbols } from "./bitget-readonly.mjs";

async function main() {
  const enabled = bitgetReadonlyEnabled();
  const hasCredentials = hasBitgetReadonlyCredentials();
  const syncSymbols = getBitgetSyncSymbols();

  console.log(JSON.stringify({ enabled, hasCredentials, syncSymbols }, null, 2));

  if (!enabled) {
    console.log("Bitget readonly sync is disabled. Set BITGET_READONLY_ENABLED=true to enable it.");
    return;
  }
  if (!hasCredentials) {
    throw new Error("Missing Bitget credentials. Required: BITGET_API_KEY, BITGET_PASSPHRASE, and BITGET_RSA_PRIVATE_KEY_BASE64 or BITGET_RSA_PRIVATE_KEY.");
  }

  const assets = await fetchBitgetSpotAssets();
  const filtered = assets.filter((asset) => syncSymbols.includes(asset.symbol));
  console.log(JSON.stringify({ fetched: assets.length, filtered }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
