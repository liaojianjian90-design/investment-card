import fs from "node:fs/promises";
import { applyManualTrades } from "./manual-trades.mjs";
import {
  calculateHealthScore,
  calculateAssetLayers,
  generateAllowedActions,
  generateForbiddenActions,
  checkDataFreshness
} from "../src/lib/investmentHealth.mjs";
import { bitgetReadonlyEnabled, hasBitgetReadonlyCredentials, getBitgetSyncSymbols } from "./bitget-readonly.mjs";

const [snapshotRaw, rulesRaw, indexHtml, workerSource, serviceWorkerSource, manualTradesRaw] = await Promise.all([
  fs.readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../config/rules.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../cloudflare-worker/manual-sync-worker.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../data/manual-trades.json", import.meta.url), "utf8")
]);

const snapshot = JSON.parse(snapshotRaw);
const rules = JSON.parse(rulesRaw);
const manualTrades = JSON.parse(manualTradesRaw);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setWeight(target, symbol, weight) {
  const row = target.positions.find((item) => item.symbol === symbol);
  if (!row) return;
  row.weightPct = weight;
  row.value = target.totalValue * weight / 100;
}

function recalcCash(target, cashPct) {
  target.cashPct = cashPct;
  target.cashValue = target.totalValue * cashPct / 100;
  const usdt = target.positions.find((item) => item.symbol === "USDT");
  const usdgo = target.positions.find((item) => item.symbol === "USDGO");
  if (usdt) {
    usdt.weightPct = cashPct;
    usdt.value = target.cashValue;
  }
  if (usdgo) {
    usdgo.weightPct = 0;
    usdgo.value = 0;
  }
}

const score = calculateHealthScore(snapshot, rules);
assert(Number.isFinite(score.total), "健康评分必须是数字");
assert(score.total >= 0 && score.total <= 100, "健康评分必须在 0-100 之间");
assert(score.reasons.some((reason) => reason.includes("现金超过 80%")), "现金 > 80% 时必须扣分并提示现金过高");
assert(score.reasons.some((reason) => reason.includes("VOO 为 0")), "VOO = 0 时必须提示长期稳定资产缺位");
assert(score.reasons.some((reason) => reason.includes("XAUT 为 0")), "XAUT = 0 时必须提示黄金稳定层缺位");

const noNewSpec = clone(snapshot);
setWeight(noNewSpec, "DOGE", 2.5);
setWeight(noNewSpec, "BGB", 0.1);
assert(generateForbiddenActions(noNewSpec, rules).some((item) => item.includes("不要补 DOGE")), "DOGE+BGB >= 2.5% 时必须禁止新增 DOGE");
assert(generateForbiddenActions(noNewSpec, rules).some((item) => item.includes("不要补 BGB")), "DOGE+BGB >= 2.5% 时必须禁止新增 BGB");

const reduceOnly = clone(snapshot);
setWeight(reduceOnly, "DOGE", 3.1);
assert(generateForbiddenActions(reduceOnly, rules).some((item) => item.includes("只减不补")), "DOGE+BGB >= 3% 时必须只允许减仓");

const stale = clone(snapshot);
stale.dataAgeMinutes = 31;
stale.isDataBlocked = true;
assert(checkDataFreshness(stale, rules).isBlocked, "数据过期时必须阻止交易判断");
assert(generateAllowedActions(stale, rules)[0].includes("等待数据刷新"), "数据过期时只允许等待刷新");

const lowCash = clone(snapshot);
recalcCash(lowCash, 34);
assert(generateAllowedActions(lowCash, rules)[0].includes("不允许新增买入"), "现金 < 35% 时必须停止新增买入");

const coreMissing = clone(snapshot);
recalcCash(coreMissing, 80);
setWeight(coreMissing, "BTC", 7);
setWeight(coreMissing, "ETH", 2);
assert(generateAllowedActions(coreMissing, rules).some((item) => item.includes("补 BTC/ETH")), "核心仓不足且现金 >= 75% 时必须提示补核心仓");

const themeHigh = clone(snapshot);
setWeight(themeHigh, "MU", 16);
assert(generateForbiddenActions(themeHigh, rules).some((item) => item.includes("AI/半导体/存储/光通信")), "主题仓超过 15% 时必须禁止新增主题仓");

const missingAsset = clone(snapshot);
missingAsset.positions = missingAsset.positions.filter((item) => item.symbol !== "XAUT");
assert(calculateAssetLayers(missingAsset, rules).length === 5, "缺失某个资产时五层计算不能崩溃");

assert(bitgetReadonlyEnabled() === false || hasBitgetReadonlyCredentials(), "Bitget 同步开启时必须配置完整凭据");
assert(getBitgetSyncSymbols().includes("BTC"), "Bitget 默认同步列表必须包含 BTC");

assert(indexHtml.includes("function normalizeSyncEndpoint("), "前端必须定义 normalizeSyncEndpoint，避免云端按钮静默报错");
assert(indexHtml.includes("function setCloudStatus("), "前端必须定义 setCloudStatus，保证云端同步有中文状态反馈");
assert(indexHtml.includes("id=\"cloudDebug\""), "前端必须包含云端调试信息区域");
assert(indexHtml.includes("postCloudJson(\"/test\""), "测试云端连接必须请求 Worker /test");
assert(indexHtml.includes("postCloudJson(\"/trades\""), "提交云端交易必须请求 Worker /trades");

[
  "invalid_pin",
  "missing_env",
  "github_token_invalid",
  "github_repo_not_found",
  "github_branch_not_found",
  "github_file_read_failed",
  "github_file_write_failed",
  "invalid_payload",
  "cors_not_allowed",
  "method_not_allowed",
  "unknown_error"
].forEach((code) => {
  assert(workerSource.includes(code), `Worker 必须包含错误码 ${code}`);
});
assert(workerSource.includes('route === "/test"'), "Worker 必须显式支持 POST /test");
assert(workerSource.includes('route === "/trades"'), "Worker 必须显式支持 POST /trades");
assert(workerSource.includes("access-control-allow-origin"), "Worker 必须返回 CORS 响应头");
assert(serviceWorkerSource.includes("investment-card-github-pages-v511"), "Service Worker 缓存版本必须升级到 v511+");
assert(Array.isArray(manualTrades.trades), "data/manual-trades.json 必须包含 trades 数组");

const tradeApplied = applyManualTrades({
  baseCurrency: "USDT",
  cash: [{ symbol: "USDT", quantity: 1000, cost: 1, type: "cash" }],
  positions: [{ symbol: "BTC", quantity: 0, cost: 0, type: "crypto" }]
}, {
  trades: [{ id: "selfcheck-buy-btc", action: "buy", symbol: "BTC", quantity: 0.01, price: 60000, fee: 1, cashSymbol: "USDT", tradedAt: "2026-06-29T00:00:00Z" }]
});
const tradeBtc = tradeApplied.holdings.positions.find((item) => item.symbol === "BTC");
const tradeCash = tradeApplied.holdings.cash.find((item) => item.symbol === "USDT");
assert(Math.abs(tradeBtc.quantity - 0.01) < 1e-12, "手动买入交易必须增加 BTC 数量");
assert(Math.abs(tradeCash.quantity - 399) < 1e-12, "手动买入交易必须扣减现金和手续费");

console.log(JSON.stringify({ ok: true, score: score.total, grade: score.grade }, null, 2));
