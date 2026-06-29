import fs from "node:fs/promises";
import {
  calculateHealthScore,
  calculateAssetLayers,
  generateAllowedActions,
  generateForbiddenActions,
  checkDataFreshness
} from "../src/lib/investmentHealth.mjs";
import { bitgetReadonlyEnabled, hasBitgetReadonlyCredentials, getBitgetSyncSymbols } from "./bitget-readonly.mjs";

const [snapshotRaw, rulesRaw, indexHtml, serviceWorkerSource, holdingsRaw] = await Promise.all([
  fs.readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../config/rules.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../config/holdings.json", import.meta.url), "utf8")
]);

const snapshot = JSON.parse(snapshotRaw);
const rules = JSON.parse(rulesRaw);
const holdings = JSON.parse(holdingsRaw);

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
assert(score.reasons.length >= 0, "健康评分必须返回扣分原因数组");
const stableMissing = clone(snapshot);
setWeight(stableMissing, "VOO", 0);
setWeight(stableMissing, "XAUT", 0);
const stableMissingScore = calculateHealthScore(stableMissing, rules);
assert(stableMissingScore.reasons.some((reason) => reason.includes("VOO 为 0")), "VOO = 0 时必须提示长期稳定资产缺位");
assert(stableMissingScore.reasons.some((reason) => reason.includes("XAUT 为 0")), "XAUT = 0 时必须提示黄金稳定层缺位");

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

assert(indexHtml.includes("config/holdings.json"), "前端必须明确显示 config/holdings.json 为仓位来源");
assert(indexHtml.includes("holdings-json-only"), "前端必须使用 holdings-json-only 模式标记");
assert(!indexHtml.includes("id=\"manualTradeCard\""), "前端不得保留手动买入/卖出入口");
assert(!indexHtml.includes("id=\"syncEndpoint\""), "前端不得保留云端同步设置");
assert(!indexHtml.includes("id=\"editor\""), "前端不得保留手动更新仓位编辑器");
assert(!indexHtml.includes("manual-trades.json"), "前端不得再依赖 manual-trades.json");
assert(serviceWorkerSource.includes("investment-card-github-pages-v512"), "Service Worker 缓存版本必须升级到 v512");
assert(Array.isArray(holdings.cash) && Array.isArray(holdings.positions), "config/holdings.json 必须包含 cash 和 positions 数组");
assert(holdings.positions.some((item) => item.symbol === "MU"), "holdings.json 必须保留 MU");
assert(holdings.positions.some((item) => item.symbol === "WDC"), "holdings.json 必须保留 WDC");

console.log(JSON.stringify({ ok: true, score: score.total, grade: score.grade, mode: "holdings-json-only" }, null, 2));
