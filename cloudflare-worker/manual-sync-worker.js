// Cloudflare Worker for Investment Health Card manual trade cloud sync.
// Secrets / variables required:
// GITHUB_TOKEN: fine-grained GitHub token with Contents read/write on this repo
// GITHUB_OWNER: your GitHub username or organization
// GITHUB_REPO: repository name, for example investment-card
// GITHUB_BRANCH: main (optional, default main)
// SYNC_PIN: a private PIN you type in the website before submitting a trade
// ALLOWED_ORIGIN: optional, for example https://yourname.github.io/investment-card/

const MANUAL_TRADES_PATH = "data/manual-trades.json";
const SERVICE_NAME = "investment-card-manual-sync";

class SyncError extends Error {
  constructor(code, message, status = 400, meta = {}) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "*") return "*";
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function corsInfo(request, env) {
  const requestOrigin = request.headers.get("origin") || "";
  const configured = String(env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  if (!configured.length || configured.includes("*")) {
    return { allowed: true, origin: "*", requestOrigin };
  }
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (configured.includes(normalizedRequestOrigin)) {
    return { allowed: true, origin: normalizedRequestOrigin, requestOrigin };
  }
  return { allowed: false, origin: requestOrigin || configured[0] || "*", requestOrigin };
}

function jsonResponse(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-requested-with",
      "access-control-max-age": "86400"
    }
  });
}

function errorResponse(error, origin) {
  const code = error?.code || "unknown_error";
  const status = error?.status || 500;
  return jsonResponse({
    ok: false,
    code,
    error: code,
    message: error?.message || "unknown error",
    meta: error?.meta || {}
  }, status, origin);
}

function requireEnv(env) {
  const missing = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "SYNC_PIN"]
    .filter((key) => !String(env[key] || "").trim());
  if (missing.length) {
    throw new SyncError("missing_env", `Missing Worker env: ${missing.join(", ")}`, 500, { missing });
  }
}

function requirePin(payload, env) {
  if (String(payload?.pin || "") !== String(env.SYNC_PIN || "")) {
    throw new SyncError("invalid_pin", "Invalid sync PIN.", 401);
  }
}

function normalizeAction(value) {
  const action = String(value || "").trim().toLowerCase();
  if (["buy", "b", "买", "买入"].includes(action)) return "buy";
  if (["sell", "s", "卖", "卖出"].includes(action)) return "sell";
  return action;
}

function validateTrade(raw) {
  const action = normalizeAction(raw?.action || raw?.side || raw?.type);
  const symbol = String(raw?.symbol || "").trim().toUpperCase();
  const quantity = Number(raw?.quantity ?? raw?.amount ?? 0);
  const price = Number(raw?.price ?? 0);
  const fee = Math.max(0, Number(raw?.fee ?? 0));
  const cashSymbol = String(raw?.cashSymbol || raw?.cashAccount || "USDT").trim().toUpperCase();
  const tradedAt = raw?.tradedAt || raw?.time || new Date().toISOString();
  const note = String(raw?.note || "").slice(0, 200);
  const id = String(raw?.id || `${tradedAt}-${action}-${symbol}-${quantity}-${price}-${fee}`).replace(/\s+/g, "-");

  if (!["buy", "sell"].includes(action)) {
    throw new SyncError("invalid_payload", "Trade action must be buy or sell.", 400, { field: "action" });
  }
  if (!/^[A-Z0-9.]{2,12}$/.test(symbol)) {
    throw new SyncError("invalid_payload", "Invalid trade symbol.", 400, { field: "symbol" });
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new SyncError("invalid_payload", "Trade quantity must be greater than 0.", 400, { field: "quantity" });
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new SyncError("invalid_payload", "Trade price must be greater than 0.", 400, { field: "price" });
  }
  if (!/^[A-Z0-9.]{2,12}$/.test(cashSymbol)) {
    throw new SyncError("invalid_payload", "Invalid cash symbol.", 400, { field: "cashSymbol" });
  }

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

async function githubApi(env, endpoint, options = {}, codeMap = {}) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
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
    const text = await res.text().catch(() => "");
    let code = codeMap[res.status] || "unknown_error";
    if (res.status === 401 || res.status === 403) code = "github_token_invalid";
    throw new SyncError(code, `GitHub ${res.status}: ${text.slice(0, 300)}`, code === "github_token_invalid" ? 502 : 500, {
      githubStatus: res.status
    });
  }
  return res.status === 204 ? null : res.json();
}

function repoPath(env, suffix = "") {
  return `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${suffix}`;
}

async function checkGithubAccess(env) {
  const branch = env.GITHUB_BRANCH || "main";
  await githubApi(env, repoPath(env), {}, { 404: "github_repo_not_found" });
  await githubApi(env, repoPath(env, `/branches/${encodeURIComponent(branch)}`), {}, { 404: "github_branch_not_found" });
}

async function readManualTrades(env) {
  const branch = env.GITHUB_BRANCH || "main";
  const endpoint = `${repoPath(env, `/contents/${MANUAL_TRADES_PATH}`)}?ref=${encodeURIComponent(branch)}`;
  const file = await githubApi(env, endpoint, {}, { 404: "github_file_read_failed" });
  try {
    const content = JSON.parse(base64ToUtf8(file.content));
    if (!Array.isArray(content.trades)) {
      throw new Error("trades must be an array");
    }
    return {
      content: {
        version: Number(content.version || 1),
        updatedAt: content.updatedAt || new Date().toISOString(),
        trades: content.trades
      },
      sha: file.sha
    };
  } catch (error) {
    throw new SyncError("github_file_read_failed", `Invalid ${MANUAL_TRADES_PATH}: ${error.message}`, 500);
  }
}

async function writeManualTrades(env, content, sha) {
  const branch = env.GITHUB_BRANCH || "main";
  const body = {
    message: `Add manual trade ${content.trades.at(-1)?.symbol || ""}`.trim(),
    content: utf8ToBase64(`${JSON.stringify(content, null, 2)}\n`),
    branch,
    sha
  };
  const endpoint = repoPath(env, `/contents/${MANUAL_TRADES_PATH}`);
  return githubApi(env, endpoint, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  }, { 404: "github_file_write_failed", 409: "github_file_write_failed" });
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw new SyncError("invalid_payload", "Request body must be JSON.", 400);
  }
}

async function handleTest(request, env, origin) {
  requireEnv(env);
  const payload = await parseJsonBody(request);
  requirePin(payload, env);
  await checkGithubAccess(env);
  const { content } = await readManualTrades(env);
  return jsonResponse({
    ok: true,
    service: SERVICE_NAME,
    branch: env.GITHUB_BRANCH || "main",
    path: MANUAL_TRADES_PATH,
    count: content.trades.length,
    updatedAt: content.updatedAt
  }, 200, origin);
}

async function handleTrades(request, env, origin) {
  requireEnv(env);
  const payload = await parseJsonBody(request);
  requirePin(payload, env);
  const trade = validateTrade(payload.trade || payload);
  const { content, sha } = await readManualTrades(env);
  const exists = content.trades.some((item) => item.id === trade.id);
  if (!exists) content.trades.push(trade);
  content.version = Number(content.version || 1);
  content.updatedAt = new Date().toISOString();

  try {
    await writeManualTrades(env, content, sha);
  } catch (error) {
    if (error?.meta?.githubStatus !== 409) throw error;
    const latest = await readManualTrades(env);
    if (!latest.content.trades.some((item) => item.id === trade.id)) {
      latest.content.trades.push(trade);
    }
    latest.content.version = Number(latest.content.version || 1);
    latest.content.updatedAt = new Date().toISOString();
    await writeManualTrades(env, latest.content, latest.sha);
    return jsonResponse({ ok: true, trade, count: latest.content.trades.length, retried: true }, 200, origin);
  }

  return jsonResponse({ ok: true, trade, count: content.trades.length, duplicated: exists }, 200, origin);
}

function routePath(pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (path === "/") return "/";
  if (path.endsWith("/test")) return "/test";
  if (path.endsWith("/trades")) return "/trades";
  return path;
}

export default {
  async fetch(request, env) {
    const cors = corsInfo(request, env);
    const url = new URL(request.url);
    const route = routePath(url.pathname);

    if (request.method === "OPTIONS") {
      return jsonResponse({ ok: true, service: SERVICE_NAME }, 200, cors.origin);
    }
    if (!cors.allowed) {
      return errorResponse(new SyncError("cors_not_allowed", "Request origin is not allowed.", 403, {
        requestOrigin: cors.requestOrigin,
        allowedOrigin: env.ALLOWED_ORIGIN || "*"
      }), cors.origin);
    }

    try {
      if (request.method === "GET" && route === "/") {
        return jsonResponse({ ok: true, service: SERVICE_NAME }, 200, cors.origin);
      }
      if (request.method !== "POST") {
        throw new SyncError("method_not_allowed", "Only GET /, POST /test and POST /trades are supported.", 405);
      }
      if (route === "/test") return handleTest(request, env, cors.origin);
      if (route === "/trades") return handleTrades(request, env, cors.origin);
      throw new SyncError("method_not_allowed", `Unsupported path: ${url.pathname}`, 404);
    } catch (error) {
      return errorResponse(error instanceof SyncError ? error : new SyncError("unknown_error", error.message, 500), cors.origin);
    }
  }
};
