import crypto from "node:crypto";
import fs from "node:fs/promises";

const BITGET_BASE_URL = process.env.BITGET_BASE_URL || "https://api.bitget.com";
const SPOT_ASSETS_PATH = "/api/v2/spot/account/assets";
const DEFAULT_SYNC_SYMBOLS = ["USDT", "USDGO", "BTC", "ETH", "DOGE", "BGB", "XAUT"];

export function bitgetReadonlyEnabled() {
  return String(process.env.BITGET_READONLY_ENABLED || "").toLowerCase() === "true";
}

export function hasBitgetReadonlyCredentials() {
  return Boolean(
    process.env.BITGET_API_KEY &&
    process.env.BITGET_PASSPHRASE &&
    (process.env.BITGET_RSA_PRIVATE_KEY || process.env.BITGET_RSA_PRIVATE_KEY_BASE64 || process.env.BITGET_RSA_PRIVATE_KEY_PATH)
  );
}

export function getBitgetSyncSymbols() {
  const raw = process.env.BITGET_SYNC_SYMBOLS;
  if (!raw) return DEFAULT_SYNC_SYMBOLS;
  return raw.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
}

export async function loadBitgetPrivateKey() {
  if (process.env.BITGET_RSA_PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.BITGET_RSA_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }
  if (process.env.BITGET_RSA_PRIVATE_KEY) {
    return process.env.BITGET_RSA_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (process.env.BITGET_RSA_PRIVATE_KEY_PATH) {
    return fs.readFile(process.env.BITGET_RSA_PRIVATE_KEY_PATH, "utf8");
  }
  throw new Error("Missing Bitget RSA private key. Set BITGET_RSA_PRIVATE_KEY_BASE64, BITGET_RSA_PRIVATE_KEY, or BITGET_RSA_PRIVATE_KEY_PATH.");
}

function buildQuery(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return "";
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export async function signBitgetRequest({ timestamp, method, requestPath, queryString = "", body = "" }) {
  const privateKey = await loadBitgetPrivateKey();
  const payload = `${timestamp}${method.toUpperCase()}${requestPath}${queryString ? `?${queryString}` : ""}${body}`;
  return crypto.sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64");
}

export async function bitgetRequest(requestPath, { method = "GET", query = {}, body = "" } = {}) {
  const apiKey = process.env.BITGET_API_KEY;
  const passphrase = process.env.BITGET_PASSPHRASE;
  if (!apiKey || !passphrase) throw new Error("Missing BITGET_API_KEY or BITGET_PASSPHRASE.");

  const upperMethod = method.toUpperCase();
  const queryString = buildQuery(query);
  const timestamp = String(Date.now());
  const sign = await signBitgetRequest({ timestamp, method: upperMethod, requestPath, queryString, body });
  const url = `${BITGET_BASE_URL}${requestPath}${queryString ? `?${queryString}` : ""}`;

  const res = await fetch(url, {
    method: upperMethod,
    headers: {
      "ACCESS-KEY": apiKey,
      "ACCESS-SIGN": sign,
      "ACCESS-PASSPHRASE": passphrase,
      "ACCESS-TIMESTAMP": timestamp,
      "Content-Type": "application/json",
      "locale": "zh-CN",
      "user-agent": "investment-health-card/5.0-readonly"
    },
    body: upperMethod === "GET" ? undefined : body
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) throw new Error(`Bitget HTTP ${res.status}: ${text}`);
  if (data && data.code && data.code !== "00000") {
    throw new Error(`Bitget API error ${data.code}: ${data.msg || text}`);
  }
  return data;
}

export async function fetchBitgetSpotAssets() {
  const data = await bitgetRequest(SPOT_ASSETS_PATH);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((row) => {
    const available = Number(row.available || 0);
    const frozen = Number(row.frozen || 0);
    const locked = Number(row.locked || 0);
    const total = Number(row.total || available + frozen + locked);
    return {
      symbol: String(row.coin || "").toUpperCase(),
      available: Number.isFinite(available) ? available : 0,
      frozen: Number.isFinite(frozen) ? frozen : 0,
      locked: Number.isFinite(locked) ? locked : 0,
      total: Number.isFinite(total) ? total : 0
    };
  }).filter((row) => row.symbol);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function updateAssetQuantity(asset, total) {
  return { ...asset, quantity: total };
}

export async function syncHoldingsFromBitget(holdings) {
  if (!bitgetReadonlyEnabled()) {
    return { holdings, meta: { enabled: false, used: false, reason: "BITGET_READONLY_ENABLED is not true" } };
  }
  if (!hasBitgetReadonlyCredentials()) {
    throw new Error("Bitget readonly sync is enabled, but credentials are incomplete. Required: BITGET_API_KEY, BITGET_PASSPHRASE, and BITGET_RSA_PRIVATE_KEY_BASE64 or BITGET_RSA_PRIVATE_KEY.");
  }

  const syncSymbols = new Set(getBitgetSyncSymbols());
  const assets = await fetchBitgetSpotAssets();
  const totals = new Map(assets.map((asset) => [asset.symbol, asset.total]));
  const next = cloneJson(holdings);
  let updatedCount = 0;
  const updatedSymbols = [];

  for (const bucket of ["cash", "positions"]) {
    next[bucket] = (next[bucket] || []).map((asset) => {
      const symbol = String(asset.symbol || "").toUpperCase();
      if (!syncSymbols.has(symbol) || !totals.has(symbol)) return asset;
      const total = Number(totals.get(symbol));
      if (!Number.isFinite(total)) return asset;
      updatedCount += 1;
      updatedSymbols.push(symbol);
      return updateAssetQuantity(asset, total);
    });
  }

  return {
    holdings: next,
    meta: {
      enabled: true,
      used: true,
      source: "bitget-readonly-spot-assets",
      updatedAt: new Date().toISOString(),
      endpoint: SPOT_ASSETS_PATH,
      syncedSymbols: updatedSymbols,
      syncedCount: updatedCount,
      availableSymbols: assets.map((asset) => asset.symbol),
      note: "Only quantities are synced. Cost basis is preserved from config/holdings.json and must be maintained manually."
    }
  };
}
