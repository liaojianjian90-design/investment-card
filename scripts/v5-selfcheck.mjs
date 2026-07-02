import fs from "node:fs/promises";
import {
  calculateHealthScore,
  calculateAssetLayers,
  getV4Rules
} from "../src/lib/investmentHealth.mjs";

const [snapshotRaw, rulesRaw, holdingsRaw, indexHtml, serviceWorkerSource, workflowSource] = await Promise.all([
  fs.readFile(new URL("../data/snapshot.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../config/rules.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../config/holdings.json", import.meta.url), "utf8"),
  fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../.github/workflows/monitor.yml", import.meta.url), "utf8")
]);

const snapshot = JSON.parse(snapshotRaw);
const rules = JSON.parse(rulesRaw);
const holdings = JSON.parse(holdingsRaw);
const v = getV4Rules(rules);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(rules.systemVersion === "5.4.2", "系统版本必须为 5.4.2");
assert(rules.positionDashboardOnly === true, "5.4.2 必须启用仓位体检模式");
assert(rules.v5Rules?.positionDashboardOnly?.enabled === true, "v5Rules 必须启用仓位体检模式");
assert(rules.aiIntradayDropOpportunityRules?.enabled === false, "5.4.2 必须关闭 AI 急跌自动买入日志");
assert(rules.lowFrequencyExecutionPolicy?.enabled === false, "5.4.2 必须关闭低频执行摘要");

assert(v.themeLayer.name === "AI抽水机主攻仓", "主题层名称应保留 AI抽水机主攻仓");
assert(holdings.positions.some((item) => item.symbol === "CRCL"), "holdings.json 必须包含 CRCL");
assert(holdings.positions.some((item) => item.symbol === "RAM"), "holdings.json 必须包含 RAM");
assert(v.speculativeLayer.symbols.includes("RAM"), "RAM 必须进入投机清理层统计");
assert(rules.targets?.RAM?.stopAddPct === 1.5, "RAM 单仓 1.5% 必须停止新增");
assert(!v.speculativeLayer.symbols.includes("CRCL"), "CRCL 不应进入 DOGE/BGB 投机仓统计");
assert(v.cryptoFinanceLayer?.symbols?.includes("CRCL"), "CRCL 必须进入独立的加密金融基础设施卫星仓");
assert(rules.targets?.CRCL?.stopAddPct === 4.5, "CRCL 单仓 4.5% 必须停止新增");

const score = calculateHealthScore(snapshot, rules);
assert(Number.isFinite(score.total), "健康评分必须是数字");
assert(score.total >= 0 && score.total <= 100, "健康评分必须在 0-100 之间");
assert(calculateAssetLayers(snapshot, rules).some((layer) => layer.name.includes("AI抽水机")), "资产分层必须显示 AI抽水机仓");
assert(calculateAssetLayers(snapshot, rules).some((layer) => layer.name.includes("加密金融基础设施")), "资产分层必须显示 CRCL 独立卫星仓");

assert(indexHtml.includes("仓位体检版"), "首页必须显示仓位体检版定位");
assert(indexHtml.includes("网站只做体检和预警"), "首页必须明确不自动给交易指令");
assert(indexHtml.includes("操作前人工复核流程"), "首页必须显示操作前人工复核流程");
assert(indexHtml.includes("账户总盈亏"), "首页必须显示账户总盈亏模块");
assert(indexHtml.includes("以 16,000 USDT 为基准"), "首页必须显示 16000 USDT 盈亏基准");
assert(rules.performanceBaseline?.amount === 16000, "总盈亏基准必须为 16000 USDT");
assert(indexHtml.indexOf("<h2>账户快照</h2>") < indexHtml.indexOf("<h2>持仓与盈亏</h2>"), "持仓与盈亏必须放在账户快照下方");
assert(indexHtml.indexOf("<h2>持仓与盈亏</h2>") < indexHtml.indexOf("<h2>资产仓位结构 + CRCL卫星仓</h2>"), "持仓与盈亏必须放在资产结构上方");
assert(indexHtml.includes("默认按当前持仓市值 / 仓位占比从高到低排序"), "持仓与盈亏必须说明默认排序规则");
assert(indexHtml.includes("const sortedPositions ="), "持仓列表必须按仓位大小排序后再展示");
assert(rules.dashboardLayout?.defaultPositionSort === "weightPctDesc", "规则文件必须记录持仓默认按仓位占比降序排序");
assert(!indexHtml.includes("id=\"executionLogSection\""), "5.4.2 前端不应再展示执行纪律日志模块");
assert(!indexHtml.includes("<h3>八、AI主攻仓急跌机会捕捉</h3>"), "5.4.2 前端不应再展示自动急跌买入模块");
assert(!indexHtml.includes("手动买入 / 卖出入口"), "前端必须移除手动买入/卖出入口");
assert(!indexHtml.includes("云端同步设置"), "前端必须移除云端同步设置");

assert(serviceWorkerSource.includes("investment-card-github-pages-v527"), "Service Worker 缓存版本必须升级到 v526");
assert(serviceWorkerSource.includes("investmentHealth.mjs?v=527"), "investmentHealth 模块引用必须升级到 v526");
assert(workflowSource.includes("POSITION_DASHBOARD_ONLY"), "GitHub Actions 必须传入 POSITION_DASHBOARD_ONLY");
assert(workflowSource.includes('cron: "17,47 13-22 * * 1-5"'), "5.4.2 默认应降频到每 30 分钟刷新");

console.log(JSON.stringify({
  ok: true,
  score: score.total,
  grade: score.grade,
  version: "5.4.2",
  mode: "position-dashboard-only",
  crclLayer: "independent"
}, null, 2));
