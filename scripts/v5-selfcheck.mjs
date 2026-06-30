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
assert(Math.abs(v.themeLayer.targetMax - 0.30) < 1e-9, "AI抽水机仓目标上限应为 30%");
assert(Math.abs(v.themeLayer.hardMax - 0.30) < 1e-9, "AI抽水机仓硬上限应为 30%");
assert(v.themeLayer.prioritySymbols.includes("GLW"), "GLW 必须进入 AI抽水机核心优先标的");
assert(v.themeLayer.prioritySymbols.includes("MU") && v.themeLayer.prioritySymbols.includes("DRAM"), "MU/DRAM 必须保留核心优先级");
assert(holdings.positions.some((item) => item.symbol === "GLW"), "holdings.json 必须包含 GLW");

const score = calculateHealthScore(snapshot, rules);
assert(Number.isFinite(score.total), "健康评分必须是数字");
assert(score.total >= 0 && score.total <= 100, "健康评分必须在 0-100 之间");
assert(calculateAssetLayers(snapshot, rules).some((layer) => layer.name.includes("AI抽水机")), "资产分层必须显示 AI抽水机仓");

const highTheme = clone(snapshot);
setWeight(highTheme, "MU", 12);
setWeight(highTheme, "DRAM", 10);
setWeight(highTheme, "GLW", 10);
assert(generateForbiddenActions(highTheme, rules).some((item) => item.includes("AI抽水机") || item.includes("AI/半导体")), "AI抽水机仓超过 25% 时必须禁止新增");

const lowCash = clone(snapshot);
recalcCash(lowCash, 34);
assert(generateAllowedActions(lowCash, rules)[0].includes("不允许新增买入"), "现金 <35% 时必须停止新增买入");

assert(!indexHtml.includes("手动买入 / 卖出入口"), "前端必须移除手动买入/卖出入口");
assert(!indexHtml.includes("云端同步设置"), "前端必须移除云端同步设置");
assert(!indexHtml.includes("手动更新仓位"), "前端必须移除手动更新仓位模块");
assert(!indexHtml.includes("manual-trades.json"), "页面不应再提示 manual-trades.json");
assert(serviceWorkerSource.includes("investment-card-github-pages-v514"), "Service Worker 缓存版本必须升级到 v514");

console.log(JSON.stringify({ ok: true, score: score.total, grade: score.grade, themeLayer: v.themeLayer.name, version: "5.2", holdingsMode: "holdings-json-only" }, null, 2));
