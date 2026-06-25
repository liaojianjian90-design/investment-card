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
  if (!alerts.length || missing.length || isDryRun) return { sent: false, missing };

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const subject = `Investment alert: ${alerts.map((a) => a.symbol).join(", ")}`;
  const text = [
    `Checked at: ${snapshot.updatedAt}`,
    `Total value: ${snapshot.totalValue.toFixed(2)} USDT`,
    `Cash ratio: ${snapshot.cashPct.toFixed(1)}%`,
    `Drawdown: ${(snapshot.drawdownPct || 0).toFixed(1)}%`,
    "",
    ...alerts.map((a) => `[${a.type}] ${a.symbol}\n${a.message}\n${a.action}`)
  ].join("\n\n");

  await transporter.sendMail({
    from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject,
    text
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
      message: "Manual test email triggered from GitHub Actions.",
      action: "If you received this email, SMTP settings are working."
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
