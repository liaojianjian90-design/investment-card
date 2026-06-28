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

const [snapshotRaw, rulesRaw] = await Promise.all([
  fs.readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../config/rules.json", import.meta.url), "utf8")
]);

const snapshot = JSON.parse(snapshotRaw);
const rules = JSON.parse(rulesRaw);

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

console.log(JSON.stringify({ ok: true, score: score.total, grade: score.grade }, null, 2));
