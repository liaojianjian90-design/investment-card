import fs from "node:fs/promises";
import {
  calculateHealthScore,
  calculateAssetLayers,
  generateAllowedActions,
  generateForbiddenActions,
  getV4Rules
} from "../src/lib/investmentHealth.mjs";

const [snapshotRaw, rulesRaw, holdingsRaw, indexHtml, serviceWorkerSource] = await Promise.all([
  fs.readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../config/rules.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../config/holdings.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../service-worker.js", import.meta.url), "utf8")
]);

const snapshot = JSON.parse(snapshotRaw);
const rules = JSON.parse(rulesRaw);
const holdings = JSON.parse(holdingsRaw);
const v = getV4Rules(rules);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function setWeight(target, symbol, weight) {
  const row = target.positions.find((item) => item.symbol === symbol);
  if (!row) return;
  row.weightPct = weight;
  row.value = target.totalValue * weight / 100;
}
function recalcCash(target, cashPct) {
  target.cashPct = cashPct;
  target.cashValue = target.totalValue * cashPct / 100;
}

assert(v.themeLayer.name === "AI抽水机主攻仓", "主题层名称必须升级为 AI抽水机主攻仓");
assert(Math.abs(v.themeLayer.targetMax - 0.35) < 1e-9, "AI抽水机仓目标上限应为 35%");
assert(Math.abs(v.themeLayer.hardMax - 0.40) < 1e-9, "AI抽水机仓硬上限应为 40%");
assert(v.themeLayer.prioritySymbols.includes("GLW"), "GLW 必须进入 AI抽水机核心优先标的");
assert(v.themeLayer.prioritySymbols.includes("MU") && v.themeLayer.prioritySymbols.includes("DRAM") && v.themeLayer.prioritySymbols.includes("SMH"), "MU/DRAM/SMH 必须保留核心优先级");
assert(holdings.positions.some((item) => item.symbol === "GLW"), "holdings.json 必须包含 GLW");
assert(holdings.positions.some((item) => item.symbol === "CRCL"), "holdings.json 必须包含 CRCL");
assert(!v.speculativeLayer.symbols.includes("CRCL"), "CRCL 不应进入 DOGE/BGB 投机仓统计");
assert(v.cryptoFinanceLayer?.symbols?.includes("CRCL"), "CRCL 必须进入独立的加密金融基础设施卫星仓");
assert(rules.targets?.CRCL?.stopAddPct === 4.5, "CRCL 单仓 4.5% 必须停止新增");
assert(v.effectivePositionRules?.mainAttackMinBuyUSDT === 500, "主攻仓单笔买入下限必须升级到 500 USDT");
assert(Math.abs(v.speculativeLayer.noNewBuyAbove - 0.045) < 1e-9, "DOGE+BGB 禁止新增阈值应升级到 4.5%");
assert(Math.abs(v.speculativeLayer.reduceOnlyAbove - 0.05) < 1e-9, "DOGE+BGB 只减不补阈值应升级到 5%");
assert(rules.aiIntradayDropOpportunityRules?.enabled === true, "必须启用 AI主攻仓急跌机会捕捉规则");
assert(rules.aiIntradayDropOpportunityRules?.primarySymbols?.includes("GLW"), "AI急跌机会捕捉必须包含 GLW");
assert(rules.aiIntradayDropOpportunityRules?.singleSymbolAmountMin >= 500, "AI急跌单标的买入下限必须不低于 500 USDT");


const score = calculateHealthScore(snapshot, rules);
assert(Number.isFinite(score.total), "健康评分必须是数字");
assert(score.total >= 0 && score.total <= 100, "健康评分必须在 0-100 之间");
assert(calculateAssetLayers(snapshot, rules).some((layer) => layer.name.includes("AI抽水机")), "资产分层必须显示 AI抽水机仓");

const coreSkew = clone(snapshot);
setWeight(coreSkew, "BTC", 7.5);
setWeight(coreSkew, "ETH", 2.5);
const coreSkewLayer = calculateAssetLayers(coreSkew, rules).find((layer) => layer.id === "core");
assert(coreSkewLayer?.status?.label === "核心偏科", "BTC/ETH 合计达标但 ETH 偏低时，应显示核心偏科，不应显示核心不足");
assert(coreSkewLayer?.advice?.includes("不影响 AI 主攻仓优先级"), "核心偏科必须明确不影响 AI 主攻仓优先级");

const highTheme = clone(snapshot);
setWeight(highTheme, "MU", 12);
setWeight(highTheme, "DRAM", 10);
setWeight(highTheme, "GLW", 10);
assert(generateForbiddenActions(highTheme, rules).some((item) => item.includes("AI抽水机") || item.includes("AI/半导体")), "AI抽水机仓超过 30% 时必须禁止新增");

const lowCash = clone(snapshot);
lowCash.isDataBlocked = false;
lowCash.isStale = false;
lowCash.dataAgeMinutes = 0;
for (const row of lowCash.positions || []) { row.isDataBlocked = false; row.isStale = false; }
recalcCash(lowCash, 29);
assert(generateAllowedActions(lowCash, rules)[0].includes("不允许新增买入"), "现金 <30% 时必须停止新增买入");

assert(!indexHtml.includes("手动买入 / 卖出入口"), "前端必须移除手动买入/卖出入口");
assert(!indexHtml.includes("云端同步设置"), "前端必须移除云端同步设置");
assert(!indexHtml.includes("手动更新仓位"), "前端必须移除手动更新仓位模块");
assert(!indexHtml.includes("manual-trades.json"), "页面不应再提示 manual-trades.json");
assert(serviceWorkerSource.includes("investment-card-github-pages-v523"), "Service Worker 缓存版本必须升级到 v523");
assert(rules.trendPriorityPolicy?.enabled === true, "必须启用趋势优先策略");
assert(rules.trendPriorityPolicy?.aiPriorityTargetMinPct === 25, "AI新增资金优先目标下限应为 25%");
assert((rules.dipBuyRules || []).find((rule) => rule.id === "dip-btc-58000")?.enabled === false, "BTC 58000 档必须在 5.3.6 中禁用");
assert((rules.watchBuyRules || []).find((rule) => rule.id === "watch-xaut-3850")?.amount === 500, "XAUT 3850 档应调整为 500 USDT");

console.log(JSON.stringify({ ok: true, score: score.total, grade: score.grade, themeLayer: v.themeLayer.name, version: "5.3.6", holdingsMode: "holdings-json-only" }, null, 2));
