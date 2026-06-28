// Cloudflare Worker for Investment Health Card manual trade cloud sync.
// Secrets / variables required:
// GITHUB_TOKEN: fine-grained GitHub token with Contents read/write on this repo
// GITHUB_OWNER: your GitHub username or organization
// GITHUB_REPO: repository name, for example investment-card
// GITHUB_BRANCH: main (optional, default main)
// SYNC_PIN: a private PIN you type in the website before submitting a trade
// ALLOWED_ORIGIN: optional, for example https://yourname.github.io

const MANUAL_TRADES_PATH = "data/manual-trades.json";

function jsonResponse(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

function normalizeAction(value) {
  const action = String(value || "").trim().toLowerCase();
  if (["buy", "b", "买", "买入"].includes(action)) return "buy";
  if (["sell", "s", "卖", "卖出"].includes(action)) return "sell";
  return action;
}

function validateTrade(raw) {
  const action = normalizeAction(raw?.action);
  const symbol = String(raw?.symbol || "").trim().toUpperCase();
  const quantity = Number(raw?.quantity || 0);
  const price = Number(raw?.price || 0);
  const fee = Math.max(0, Number(raw?.fee || 0));
  const cashSymbol = String(raw?.cashSymbol || "USDT").trim().toUpperCase();
  const tradedAt = raw?.tradedAt || new Date().toISOString();
  const note = String(raw?.note || "").slice(0, 200);
  const id = String(raw?.id || `${tradedAt}-${action}-${symbol}-${quantity}-${price}-${fee}`).replace(/\s+/g, "-");

  if (!["buy", "sell"].includes(action)) throw new Error("action must be buy or sell");
  if (!/^[A-Z0-9.]{2,12}$/.test(symbol)) throw new Error("invalid symbol");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be greater than 0");
  if (!Number.isFinite(price) || price <= 0) throw new Error("price must be greater than 0");
  if (!/^[A-Z0-9.]{2,12}$/.test(cashSymbol)) throw new Error("invalid cashSymbol");

  return { id, action, symbol, quantity, price, fee, cashSymbol, tradedAt, note };
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value || "");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubFetch(env, path, options = {}) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${options.query || `?ref=${branch}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "user-agent": "investment-card-manual-sync-worker",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text}`);
  }
  return res.json();
}

async function readManualTrades(env) {
  try {
    const file = await githubFetch(env, MANUAL_TRADES_PATH);
    const content = JSON.parse(base64ToUtf8(file.content));
    return { content: { updatedAt: content.updatedAt, trades: Array.isArray(content.trades) ? content.trades : [] }, sha: file.sha };
  } catch (error) {
    if (String(error.message).includes("GitHub 404")) return { content: { updatedAt: new Date().toISOString(), trades: [] }, sha: null };
    throw error;
  }
}

async function writeManualTrades(env, content, sha) {
  const branch = env.GITHUB_BRANCH || "main";
  const body = {
    message: `Add manual trade ${content.trades.at(-1)?.symbol || ""}`.trim(),
    content: utf8ToBase64(`${JSON.stringify(content, null, 2)}\n`),
    branch
  };
  if (sha) body.sha = sha;
  return githubFetch(env, MANUAL_TRADES_PATH, {
    method: "PUT",
    query: "",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    if (request.method === "OPTIONS") return jsonResponse({ ok: true }, 200, origin);
    if (request.method === "GET") return jsonResponse({ ok: true, service: "investment-card-manual-sync" }, 200, origin);
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "method not allowed" }, 405, origin);

    try {
      if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO || !env.SYNC_PIN) {
        return jsonResponse({ ok: false, error: "worker is not configured" }, 500, origin);
      }
      const payload = await request.json();
      if (String(payload.pin || "") !== String(env.SYNC_PIN)) {
        return jsonResponse({ ok: false, error: "invalid PIN" }, 401, origin);
      }

      const trade = validateTrade(payload.trade || payload);
      const { content, sha } = await readManualTrades(env);
      if (!content.trades.some((item) => item.id === trade.id)) content.trades.push(trade);
      content.updatedAt = new Date().toISOString();
      await writeManualTrades(env, content, sha);
      return jsonResponse({ ok: true, trade, count: content.trades.length }, 200, origin);
    } catch (error) {
      return jsonResponse({ ok: false, error: error.message }, 400, origin);
    }
  }
};
