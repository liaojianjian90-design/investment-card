import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const isDryRun = process.argv.includes("--dry-run");
const mockArg = process.argv.find((arg) => arg.startsWith("--mock-prices="));
const mockPrices = process.env.MOCK_PRICES
  ? JSON.parse(process.env.MOCK_PRICES)
  : mockArg
    ? JSON.parse(mockArg.slice("--mock-prices=".length))
    : null;
const failSymbols = new Set((process.env.FAIL_SYMBOLS || "").split(",").map((item) => item.trim()).filter(Boolean));

const files = {
  holdings: path.join(root, "config", "holdings.json"),
  rules: path.join(root, "config", "rules.json"),
  snapshot: path.join(root, "data", "snapshot.json"),
  alerts: path.join(root, "data", "alerts.json"),
  alertState: path.join(root, "data", "alert-state.json")
};

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function allAssets(holdings) {
  return [...(holdings.cash || []), ...(holdings.positions || [])];
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "user-agent": "investment-monitor-card/2.0" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function tryQuote(symbol, sources) {
  const errors = [];
  for (const source of sources) {
    try {
      const price = await source();
      if (!Number.isFinite(price)) throw new Error("invalid price");
      return price;
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join(" | "));
}

async function quote(symbol) {
  if (failSymbols.has(symbol)) throw new Error(`forced test failure for ${symbol}`);
  if (mockPrices && Number.isFinite(Number(mockPrices[symbol]))) return Number(mockPrices[symbol]);
  if (symbol === "USDT" || symbol === "USDGO") return 1;

  const coingeckoIds = { BTC: "bitcoin", ETH: "ethereum", DOGE: "dogecoin" };
  const yahooCrypto = { BTC: "BTC-USD", ETH: "ETH-USD", DOGE: "DOGE-USD" };

  if (coingeckoIds[symbol]) {
    return tryQuote(symbol, [
      async () => {
        const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds[symbol]}&vs_currencies=usd`);
        return Number(data[coingeckoIds[symbol]]?.usd);
      },
      async () => {
        const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooCrypto[symbol]}?range=1d&interval=1m`);
        return Number(data.chart?.result?.[0]?.meta?.regularMarketPrice);
      },
      async () => {
        const data = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
        return Number(data.price);
      }
    ]);
  }

  if (symbol === "BGB") {
    return tryQuote(symbol, [
      async () => {
        const data = await fetchJson("https://api.bitget.com/api/v2/spot/market/tickers?symbol=BGBUSDT");
        return Number(data.data?.[0]?.lastPr);
      }
    ]);
  }

  if (["CRCL", "MSTR", "ITOT", "SPY"].includes(symbol)) {
    return tryQuote(symbol, [
      async () => {
        const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`);
        return Number(data.chart?.result?.[0]?.meta?.regularMarketPrice);
      }
    ]);
  }

  throw new Error(`No quote source for ${symbol}`);
}

async function loadPrices(symbols) {
  const entries = await Promise.all(symbols.map(async (symbol) => {
    try {
      const price = await quote(symbol);
      if (!Number.isFinite(price)) throw new Error("invalid price");
      return [symbol, price, null];
    } catch (error) {
      return [symbol, null, error.message];
    }
  }));

  const prices = {};
  const errors = {};
  for (const [symbol, price, error] of entries) {
    if (error) errors[symbol] = error;
    else prices[symbol] = price;
  }
  return { prices, errors };
}

function buildSnapshot(holdings, prices, priceErrors) {
  const rows = allAssets(holdings).map((asset) => {
    const price = prices[asset.symbol];
    const priceOk = Number.isFinite(price);
    const valuePrice = priceOk ? price : Number(asset.cost || 0);
    const value = Number(asset.quantity) * valuePrice;
    const costValue = Number(asset.quantity) * Number(asset.cost || 0);
    const pnl = value - costValue;
    return {
      symbol: asset.symbol,
      type: asset.type,
      quantity: Number(asset.quantity),
      cost: Number(asset.cost || 0),
      price: priceOk ? price : null,
      priceOk,
      priceError: priceErrors[asset.symbol] || null,
      value,
      pnl,
      pnlPct: costValue > 0 ? pnl / costValue * 100 : 0,
      weightPct: 0
    };
  });

  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  const cashValue = rows.filter((row) => row.type === "cash").reduce((sum, row) => sum + row.value, 0);
  for (const row of rows) row.weightPct = totalValue > 0 ? row.value / totalValue * 100 : 0;

  const weights = Object.fromEntries(rows.map((row) => [row.symbol, row.weightPct]));

  return {
    updatedAt: new Date().toISOString(),
    source: "github-actions",
    totalValue,
    cashValue,
    cashPct: totalValue > 0 ? cashValue / totalValue * 100 : 0,
    weights,
    priceErrors,
    positions: rows
  };
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-${String(Math.ceil((((d - yearStart) / 86400000) + 1) / 7)).padStart(2, "0")}`;
}

function addAlert(alerts, alertState, rules, alert) {
  const repeatHours = Number(rules.repeatAlertHours || 24);
  const last = alertState.lastAlerts?.[alert.id];
  if (last && Date.now() - Date.parse(last) <= repeatHours * 60 * 60 * 1000) return;
  const createdAt = new Date().toISOString();
  alertState.lastAlerts ||= {};
  alertState.lastAlerts[alert.id] = createdAt;
  alerts.push({ ...alert, createdAt });
}

function position(snapshot, symbol) {
  return snapshot.positions.find((row) => row.symbol === symbol);
}

function combinedWeight(snapshot, symbols) {
  return symbols.reduce((sum, symbol) => sum + (position(snapshot, symbol)?.weightPct || 0), 0);
}

function updateRiskState(snapshot, rules, alertState) {
  alertState.highWatermark = Math.max(Number(alertState.highWatermark || 0), snapshot.totalValue);
  snapshot.highWatermark = alertState.highWatermark;
  snapshot.drawdownPct = alertState.highWatermark > 0
    ? Math.max(0, (alertState.highWatermark - snapshot.totalValue) / alertState.highWatermark * 100)
    : 0;

  const btc = position(snapshot, "BTC");
  const week = isoWeek(new Date());
  alertState.weeklyReference ||= {};
  if (alertState.weeklyReference.week !== week || !Number.isFinite(Number(alertState.weeklyReference.btcPrice))) {
    alertState.weeklyReference = { week, btcPrice: btc?.price || null };
  }
  snapshot.btcWeeklyGainPct = btc?.price && alertState.weeklyReference.btcPrice
    ? (btc.price - Number(alertState.weeklyReference.btcPrice)) / Number(alertState.weeklyReference.btcPrice) * 100
    : 0;

  const pauseRule = (rules.drawdownRules || []).find((rule) => rule.pauseDays && snapshot.drawdownPct >= Number(rule.drawdownPct));
  if (pauseRule) {
    const until = new Date(Date.now() + Number(pauseRule.pauseDays) * 86400000).toISOString();
    if (!alertState.buyPauseUntil || Date.parse(alertState.buyPauseUntil) < Date.now()) alertState.buyPauseUntil = until;
  }
  snapshot.buyPauseUntil = alertState.buyPauseUntil || null;
  snapshot.buyPaused = snapshot.buyPauseUntil ? Date.parse(snapshot.buyPauseUntil) > Date.now() : false;
}

function dipAlreadyTriggered(alertState, id) {
  return Boolean(alertState.triggeredLevels?.[id]);
}

function markDipTriggered(alertState, rule, price) {
  alertState.triggeredLevels ||= {};
  alertState.triggeredLevels[rule.id] = { triggeredAt: new Date().toISOString(), triggerPrice: price, resetAbove: rule.resetAbove };
}

function resetDipLevels(alertState, rules, btcPrice, ethPrice) {
  alertState.triggeredLevels ||= {};
  for (const rule of rules.dipBuyRules || []) {
    if (Number.isFinite(btcPrice) && Number.isFinite(Number(rule.resetAbove)) && btcPrice >= Number(rule.resetAbove)) {
      delete alertState.triggeredLevels[rule.id];
    }
  }
  for (const rule of rules.ethDipRules || []) {
    if (Number.isFinite(ethPrice) && Number.isFinite(Number(rule.resetAbove)) && ethPrice >= Number(rule.resetAbove)) {
      delete alertState.triggeredLevels[rule.id];
    }
  }
}

function canBuy(snapshot) {
  return snapshot.cashPct >= 35 && !snapshot.buyPaused;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatPrice(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (!Number.isFinite(Number(value))) return "-";
  if (Math.abs(Number(value)) < 1) return Number(value).toFixed(5);
  if (Math.abs(Number(value)) < 100) return Number(value).toFixed(2);
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDateCn(iso) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

function uniqueSymbols(alerts) {
  return [...new Set(alerts.flatMap((alert) => String(alert.symbol || "").split(/[+/]/)).filter(Boolean))];
}

function alertTypeLabel(type) {
  return {
    "data-risk": "数据异常",
    "risk": "现金风控",
    "drawdown-risk": "回撤风控",
    "cap-risk": "组合上限",
    "weight-risk": "仓位超限",
    "fixed-dca": "固定定投",
    "dip-buy": "下跌加仓",
    "risk-pause": "暂停买入",
    "trend-pause": "禁止追涨",
    "trend-follow": "上涨追随",
    "sell": "止盈/减仓",
    "test-email": "邮件测试"
  }[type] || "规则提醒";
}

function severityLabel(severity) {
  return {
    high: "高优先级",
    medium: "中优先级",
    low: "观察"
  }[severity] || "普通";
}

function alertTitle(alert) {
  if (alert.type === "test-email") return "邮件通道测试成功";
  if (alert.type === "data-risk") return "行情数据异常，禁止按信号买入";
  if (alert.type === "risk") return "现金底线触发，停止新增买入";
  if (alert.type === "drawdown-risk") return "账户回撤风控触发";
  if (alert.type === "cap-risk") return "组合相关性或总仓位超限";
  if (alert.type === "weight-risk") return `${alert.symbol} 仓位超过目标上限`;
  if (alert.type === "fixed-dca") return "固定定投提醒";
  if (alert.type === "dip-buy") return `${alert.symbol} 下跌加仓价位触发`;
  if (alert.type === "risk-pause") return "极端下跌区间，暂停主动买入";
  if (alert.type === "trend-pause") return "上涨过快，暂不追涨";
  if (alert.type === "trend-follow") return `${alert.symbol} 上涨追随待确认`;
  if (alert.type === "sell") return `${alert.symbol} 止盈或减仓规则触发`;
  return `${alert.symbol || "组合"} 规则提醒`;
}

function positionSummary(snapshot, symbol) {
  const row = position(snapshot, symbol);
  if (!row) return null;
  const price = row.priceOk ? formatPrice(row.price) : "价格失败";
  return `${symbol}: 现价 ${price} | 仓位 ${formatPct(row.weightPct)} | 盈亏 ${formatMoney(row.pnl)} (${formatPct(row.pnlPct)})`;
}

function extractFirstNumber(text, regex) {
  const match = String(text || "").match(regex);
  return match ? match[1] : null;
}

function chineseAlertDetail(alert, snapshot) {
  const message = String(alert.message || "");
  const action = String(alert.action || "");
  const details = [];

  if (alert.type === "test-email") {
    return [
      "触发规则：手动测试邮件。",
      "建议动作：不用交易。收到这封邮件，说明 SMTP 邮件链路正常。",
      "纪律提醒：正式提醒仍只在规则触发时发送。"
    ];
  }

  if (alert.type === "data-risk") {
    const symbols = message.replace("Price source failed for:", "").replace(".", "").trim() || "部分标的";
    return [
      `触发规则：${symbols} 行情价格获取失败。`,
      "建议动作：今天不按系统买入提醒操作，等待下一次刷新。",
      "纪律提醒：价格源异常时，宁可错过一次，也不要靠猜测下单。"
    ];
  }

  if (alert.type === "risk") {
    return [
      `触发规则：现金比例低于底线。当前现金比例 ${formatPct(snapshot.cashPct)}。`,
      "建议动作：停止所有新增买入，优先恢复现金仓。",
      "纪律提醒：现金仓是二次进攻权，不能被情绪交易消耗掉。"
    ];
  }

  if (alert.type === "drawdown-risk") {
    return [
      `触发规则：账户从高点回撤达到风控线。当前回撤 ${formatPct(snapshot.drawdownPct || 0)}。`,
      `建议动作：${message}`,
      "纪律提醒：回撤扩大时，先控制风险，再讨论抄底。"
    ];
  }

  if (alert.type === "cap-risk") {
    const weight = extractFirstNumber(message, /Current combined weight: ([\d.]+)%/);
    return [
      `触发规则：${alert.symbol} 组合仓位超过上限${weight ? `，当前约 ${weight}%` : ""}。`,
      "建议动作：停止给这个组合继续加仓；如果继续上涨或波动放大，考虑分批降仓。",
      "纪律提醒：MSTR、CRCL、BTC 不是完全独立分散，相关性会在极端行情里一起放大。"
    ];
  }

  if (alert.type === "weight-risk") {
    const weight = extractFirstNumber(message, /weight is ([\d.]+)%/);
    return [
      `触发规则：${alert.symbol} 单项仓位超过目标上限${weight ? `，当前约 ${weight}%` : ""}。`,
      "建议动作：暂停加仓；只有明显超过硬上限时再考虑减仓。",
      "纪律提醒：看好不等于无限加仓，仓位上限就是防情绪的边界。"
    ];
  }

  if (alert.type === "fixed-dca") {
    const btcAmount = extractFirstNumber(message, /BTC ([\d.]+) USDT/);
    const ethAmount = extractFirstNumber(message, /ETH ([\d.]+) USDT/);
    return [
      "触发规则：固定定投日到达，且现金比例满足要求。",
      `建议动作：买入 BTC ${btcAmount || "-"} USDT，买入 ETH ${ethAmount || "-"} USDT。`,
      "纪律提醒：定投是纪律动作；但现金低于 40% 或回撤风控触发时，以风控优先。"
    ];
  }

  if (alert.type === "dip-buy") {
    const btcPrice = extractFirstNumber(message, /BTC level hit: ([\d.]+)/);
    const btcLevel = extractFirstNumber(message, /<= ([\d.]+)/);
    const ethPrice = extractFirstNumber(message, /ETH level hit: ([\d.]+)/);
    const ethLevel = extractFirstNumber(message, /<= ([\d.]+)/);
    const btcAmount = extractFirstNumber(action, /BTC ([\d.]+) USDT/);
    const ethAmount = extractFirstNumber(action, /ETH ([\d.]+) USDT/);
    const buyAmount = extractFirstNumber(action, /Buy ([\d.]+) USDT/);
    const btcReset = extractFirstNumber(action, /BTC > ([\d.]+)/);
    const ethReset = extractFirstNumber(action, /ETH > ([\d.]+)/);

    if (alert.symbol === "BTC/ETH" || btcPrice) {
      return [
        `触发规则：BTC 现价 ${formatPrice(btcPrice)} <= ${formatPrice(btcLevel)}。`,
        `建议动作：买入 BTC ${btcAmount || "-"} USDT，买入 ETH ${ethAmount || "-"} USDT。`,
        `纪律提醒：该价位只触发一次，BTC 重新站上 ${formatPrice(btcReset)} 前不重复提醒。`
      ];
    }
    return [
      `触发规则：ETH 现价 ${formatPrice(ethPrice)} <= ${formatPrice(ethLevel)}。`,
      `建议动作：买入 ETH ${buyAmount || "-"} USDT。`,
      `纪律提醒：该价位只触发一次，ETH 重新站上 ${formatPrice(ethReset)} 前不重复提醒。`
    ];
  }

  if (alert.type === "risk-pause") {
    const btcPrice = extractFirstNumber(message, /BTC level hit: ([\d.]+)/);
    const btcLevel = extractFirstNumber(message, /<= ([\d.]+)/);
    const reset = extractFirstNumber(action, /BTC > ([\d.]+)/);
    return [
      `触发规则：BTC 进入极端下跌区间，现价 ${formatPrice(btcPrice)} <= ${formatPrice(btcLevel)}。`,
      "建议动作：暂停主动买入 2-3 天，只观察结构是否企稳。",
      `纪律提醒：BTC 重新站上 ${formatPrice(reset)} 前，不做新的下跌加仓。`
    ];
  }

  if (alert.type === "trend-pause") {
    const gain = extractFirstNumber(message, /weekly gain is ([\d.]+)%/);
    return [
      `触发规则：BTC 单周涨幅过快${gain ? `，当前约 ${gain}%` : ""}。`,
      "建议动作：不追涨，等待回调或至少 2 日站稳确认。",
      "纪律提醒：上涨追随不是看到大阳线就买，而是确认趋势后小额跟随。"
    ];
  }

  if (alert.type === "trend-follow") {
    const btcPrice = extractFirstNumber(message, /BTC price ([\d.]+)/);
    const level = extractFirstNumber(message, />= ([\d.]+)/);
    return [
      `触发规则：BTC 现价 ${formatPrice(btcPrice)} >= ${formatPrice(level)}，进入上涨追随观察区。`,
      `建议动作：${action.replace("Manual confirmation required: BTC should hold above the level for 2 days.", "必须人工确认 BTC 连续 2 日站稳后再执行。")}`,
      "纪律提醒：若 BTC 单周涨幅超过 15%，宁可不追。"
    ];
  }

  if (alert.type === "sell") {
    const price = extractFirstNumber(message, /Price ([\d.]+)/);
    const weight = extractFirstNumber(message, /weight ([\d.]+)%/);
    const sellPct = extractFirstNumber(action, /Suggested sell ratio: ([\d.]+)%/);
    return [
      `触发规则：${alert.symbol} 达到止盈或仓位上限。现价 ${formatPrice(price)}，仓位约 ${weight || "-"}%。`,
      `建议动作：卖出或减仓约 ${sellPct || "-"}%。`,
      "纪律提醒：止盈不是看空，是把过热仓位换回现金，保留下一次进攻权。"
    ];
  }

  return [
    `触发规则：${message}`,
    `建议动作：${action || "打开监控卡复核。"}`,
    "纪律提醒：执行前再次确认平台实时价格、仓位和现金比例。"
  ];
}

function buildEmailContent(alerts, snapshot) {
  const symbols = uniqueSymbols(alerts);
  const hasHigh = alerts.some((alert) => alert.severity === "high");
  const subjectPrefix = hasHigh ? "【投资风控提醒】" : "【投资监控提醒】";
  const subjectSymbols = symbols.slice(0, 4).join("、") || "组合";
  const subject = `${subjectPrefix}${subjectSymbols}｜${alerts.length}条信号`;

  const header = [
    subjectPrefix.replace(/[【】]/g, ""),
    "",
    `触发数量：${alerts.length} 条`,
    `检查时间：${formatDateCn(snapshot.updatedAt)}（北京时间）`,
    `总资产：${formatMoney(snapshot.totalValue)}`,
    `现金比例：${formatPct(snapshot.cashPct)}`,
    `账户回撤：${formatPct(snapshot.drawdownPct || 0)}`,
    Number.isFinite(Number(snapshot.btcWeeklyGainPct)) ? `BTC周涨幅：${formatPct(snapshot.btcWeeklyGainPct)}` : null
  ].filter(Boolean);

  const alertBlocks = alerts.map((alert, index) => {
    const details = chineseAlertDetail(alert, snapshot);
    const relatedSymbols = String(alert.symbol || "").split(/[+/]/).filter(Boolean);
    const positionLines = relatedSymbols
      .map((symbol) => positionSummary(snapshot, symbol))
      .filter(Boolean);

    return [
      `—— 信号 ${index + 1}/${alerts.length}：${alertTitle(alert)} ——`,
      `类型：${alertTypeLabel(alert.type)}｜级别：${severityLabel(alert.severity)}`,
      ...details,
      positionLines.length ? `持仓状态：${positionLines.join("；")}` : null
    ].filter(Boolean).join("\n");
  });

  const footer = [
    "—— 执行前检查 ——",
    "1. 这不是自动下单，只是纪律提醒。",
    "2. 下单前确认平台实时价格、可用现金和交易后仓位。",
    "3. 若现金低于 35%，任何买入提醒都不执行。",
    "4. 情绪上头时，先等下一次 10 分钟刷新。"
  ];

  return {
    subject,
    text: [...header, "", ...alertBlocks, "", ...footer].join("\n")
  };
}

function evaluateRules(snapshot, rules, alertState) {
  const alerts = [];
  const btc = position(snapshot, "BTC");
  const eth = position(snapshot, "ETH");
  const anyCorePriceError = !Number.isFinite(btc?.price) || !Number.isFinite(eth?.price);
  updateRiskState(snapshot, rules, alertState);
  resetDipLevels(alertState, rules, btc?.price, eth?.price);

  if (Object.keys(snapshot.priceErrors || {}).length) {
    addAlert(alerts, alertState, rules, {
      id: "price-source-error",
      symbol: "DATA",
      type: "data-risk",
      severity: "high",
      message: `Price source failed for: ${Object.keys(snapshot.priceErrors).join(", ")}.`,
      action: "No buy alert should be executed while key prices are missing."
    });
  }

  if (snapshot.cashPct < Number(rules.cashMinPct || 35)) {
    addAlert(alerts, alertState, rules, {
      id: "cash-below-min",
      symbol: "CASH",
      type: "risk",
      severity: "high",
      message: `Cash ratio is ${snapshot.cashPct.toFixed(1)}%, below the ${rules.cashMinPct}% floor.`,
      action: "Stop all buying and rebuild cash."
    });
  }

  for (const rule of rules.drawdownRules || []) {
    if (snapshot.drawdownPct >= Number(rule.drawdownPct)) {
      addAlert(alerts, alertState, rules, {
        id: rule.id,
        symbol: "PORTFOLIO",
        type: "drawdown-risk",
        severity: snapshot.drawdownPct >= 20 ? "high" : "medium",
        message: rule.message,
        action: `Current drawdown: ${snapshot.drawdownPct.toFixed(1)}%.`
      });
    }
  }

  for (const cap of rules.portfolioCaps || []) {
    const weight = combinedWeight(snapshot, cap.symbols);
    if (weight > Number(cap.maxPct)) {
      addAlert(alerts, alertState, rules, {
        id: cap.id,
        symbol: cap.symbols.join("+"),
        type: "cap-risk",
        severity: "medium",
        message: `${cap.message} Current combined weight: ${weight.toFixed(1)}%.`,
        action: "Stop adding this basket; consider trimming if it keeps rising."
      });
    }
  }

  for (const [symbol, target] of Object.entries(rules.targets || {})) {
    const row = position(snapshot, symbol);
    if (!row) continue;
    if (row.weightPct > Number(target.maxPct)) {
      addAlert(alerts, alertState, rules, {
        id: `${symbol.toLowerCase()}-above-target`,
        symbol,
        type: "weight-risk",
        severity: "medium",
        message: `${symbol} weight is ${row.weightPct.toFixed(1)}%, above the ${target.maxPct}% cap.`,
        action: "Stop adding. Consider trimming if it keeps rising."
      });
    }
  }

  if (canBuy(snapshot) && !anyCorePriceError) {
    const now = new Date();
    const dca = rules.fixedDca;
    if (dca?.enabled && now.getUTCDay() === Number(dca.weekdayUtc) && snapshot.cashPct >= Number(dca.requireCashPct)) {
      const halfSize = snapshot.drawdownPct >= Number(dca.halfSizeDrawdownPct || 999);
      const btcAmount = halfSize ? Number(dca.btcAmount) / 2 : Number(dca.btcAmount);
      const ethAmount = halfSize ? Number(dca.ethAmount) / 2 : Number(dca.ethAmount);
      addAlert(alerts, alertState, rules, {
        id: `fixed-dca-${isoWeek(now)}`,
        symbol: "BTC/ETH",
        type: "fixed-dca",
        severity: "low",
        message: `Weekly DCA triggered. Buy BTC ${btcAmount} USDT and ETH ${ethAmount} USDT.`,
        action: halfSize ? "Half-size DCA because drawdown is elevated." : "Execute only if cash ratio remains above 40%."
      });
    }

    for (const rule of rules.dipBuyRules || []) {
      if (!Number.isFinite(btc?.price)) continue;
      if (btc.price <= Number(rule.btcPriceBelow) && snapshot.cashPct >= Number(rule.requireCashPct) && !dipAlreadyTriggered(alertState, rule.id)) {
        markDipTriggered(alertState, rule, btc.price);
        addAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol: "BTC/ETH",
          type: Number(rule.btcAmount) > 0 ? "dip-buy" : "risk-pause",
          severity: Number(rule.btcAmount) > 0 ? "medium" : "high",
          message: `BTC level hit: ${btc.price.toFixed(2)} <= ${rule.btcPriceBelow}.`,
          action: Number(rule.btcAmount) > 0
            ? `Plan: BTC ${rule.btcAmount} USDT, ETH ${rule.ethAmount} USDT. Reset only after BTC > ${rule.resetAbove}.`
            : `${rule.note} Reset only after BTC > ${rule.resetAbove}.`
        });
      }
    }

    for (const rule of rules.ethDipRules || []) {
      if (!Number.isFinite(eth?.price)) continue;
      if (eth.price <= Number(rule.priceBelow) && !dipAlreadyTriggered(alertState, rule.id)) {
        markDipTriggered(alertState, rule, eth.price);
        addAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol: "ETH",
          type: "dip-buy",
          severity: "medium",
          message: `ETH level hit: ${eth.price.toFixed(2)} <= ${rule.priceBelow}.`,
          action: `${rule.message} Reset only after ETH > ${rule.resetAbove}.`
        });
      }
    }

    for (const rule of rules.trendFollowRules || []) {
      if (!Number.isFinite(btc?.price) || btc.price < Number(rule.btcPriceAbove)) continue;
      if (snapshot.btcWeeklyGainPct > Number(rule.maxWeeklyGainPct || 999)) {
        addAlert(alerts, alertState, rules, {
          id: `${rule.id}-pause-fast-rise`,
          symbol: rule.symbol || "BTC",
          type: "trend-pause",
          severity: "medium",
          message: `BTC weekly gain is ${snapshot.btcWeeklyGainPct.toFixed(1)}%, above ${rule.maxWeeklyGainPct}%.`,
          action: "Do not chase. Wait for pullback or confirmation."
        });
        continue;
      }
      if (rule.onlyIfBelowWeightPct) {
        const row = position(snapshot, rule.symbol);
        if (!row || row.weightPct >= Number(rule.onlyIfBelowWeightPct)) continue;
      }
      addAlert(alerts, alertState, rules, {
        id: rule.id,
        symbol: rule.symbol || "BTC",
        type: "trend-follow",
        severity: "low",
        message: `Trend-follow level hit. BTC price ${btc.price.toFixed(2)} >= ${rule.btcPriceAbove}.`,
        action: `${rule.action} Manual confirmation required: BTC should hold above the level for 2 days.`
      });
    }
  }

  for (const [symbol, sellRules] of Object.entries(rules.sellRules || {})) {
    const row = position(snapshot, symbol);
    if (!row) continue;
    for (const rule of sellRules) {
      const priceHit = Number.isFinite(Number(rule.priceAbove)) && Number.isFinite(row.price) && row.price >= Number(rule.priceAbove);
      const weightHit = Number.isFinite(Number(rule.weightAbovePct)) && row.weightPct >= Number(rule.weightAbovePct);
      if (priceHit || weightHit) {
        addAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol,
          type: "sell",
          severity: "medium",
          message: `${symbol} sell/reduce rule hit. Price ${Number.isFinite(row.price) ? row.price.toFixed(4) : "N/A"}, weight ${row.weightPct.toFixed(1)}%.`,
          action: `Suggested sell ratio: ${rule.sellPct || 0}%. ${rule.message || ""}`
        });
      }
    }
  }

  return alerts;
}

async function sendEmail(alerts, snapshot) {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "ALERT_EMAIL_TO"];
  const missing = required.filter((key) => !process.env[key]);
  if (!alerts.length) return { sent: false, missing };

  const emailContent = buildEmailContent(alerts, snapshot);
  if (process.env.PRINT_EMAIL_PREVIEW === "true") {
    console.log("\n--- EMAIL PREVIEW START ---");
    console.log(`Subject: ${emailContent.subject}`);
    console.log(emailContent.text);
    console.log("--- EMAIL PREVIEW END ---\n");
  }

  if (missing.length || isDryRun) return { sent: false, missing };

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  await transporter.sendMail({
    from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject: emailContent.subject,
    text: emailContent.text
  });
  return { sent: true, missing: [] };
}

async function main() {
  const holdings = await readJson(files.holdings);
  const rules = await readJson(files.rules);
  const alertState = await readJson(files.alertState, {});
  if (!holdings || !rules) throw new Error("Missing config files");

  const symbols = [...new Set(allAssets(holdings).map((asset) => asset.symbol))];
  const { prices, errors } = await loadPrices(symbols);
  const snapshot = buildSnapshot(holdings, prices, errors);
  const alerts = evaluateRules(snapshot, rules, alertState);
  if (process.env.TEST_EMAIL === "true") {
    addAlert(alerts, alertState, rules, {
      id: `manual-test-email-${Date.now()}`,
      symbol: "TEST",
      type: "test-email",
      severity: "low",
      message: "手动测试邮件已触发。",
      action: "如果你收到这封邮件，说明 SMTP 邮件链路正常。"
    });
  }
  const email = await sendEmail(alerts, snapshot);

  await writeJson(files.snapshot, snapshot);
  await writeJson(files.alerts, { updatedAt: snapshot.updatedAt, email, alerts });
  await writeJson(files.alertState, alertState);

  console.log(JSON.stringify({
    totalValue: snapshot.totalValue,
    cashPct: snapshot.cashPct,
    drawdownPct: snapshot.drawdownPct,
    alerts: alerts.length,
    email,
    priceErrors: errors
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
