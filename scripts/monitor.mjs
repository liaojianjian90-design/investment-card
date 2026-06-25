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
  const res = await fetch(url, { headers: { "user-agent": "investment-monitor-card/1.0" } });
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
      errors.push(`${symbol}: ${error.message}`);
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
    const data = await fetchJson("https://api.bitget.com/api/v2/spot/market/tickers?symbol=BGBUSDT");
    return Number(data.data?.[0]?.lastPr);
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
    const displayPrice = priceOk ? price : null;
    const valuePrice = priceOk ? price : Number(asset.cost || 0);
    const value = Number(asset.quantity) * valuePrice;
    const costValue = Number(asset.quantity) * Number(asset.cost || 0);
    const pnl = value - costValue;
    return {
      symbol: asset.symbol,
      type: asset.type,
      quantity: Number(asset.quantity),
      cost: Number(asset.cost || 0),
      price: displayPrice,
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

  return {
    updatedAt: new Date().toISOString(),
    source: "github-actions",
    totalValue,
    cashValue,
    cashPct: totalValue > 0 ? cashValue / totalValue * 100 : 0,
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

function shouldRepeat(id, alertState, repeatHours) {
  const last = alertState[id];
  if (!last) return true;
  return Date.now() - Date.parse(last) > repeatHours * 60 * 60 * 1000;
}

function addAlert(alerts, alertState, repeatHours, alert) {
  if (!shouldRepeat(alert.id, alertState, repeatHours)) return;
  const createdAt = new Date().toISOString();
  alerts.push({ ...alert, createdAt });
  alertState[alert.id] = createdAt;
}

function position(snapshot, symbol) {
  return snapshot.positions.find((row) => row.symbol === symbol);
}

function evaluateRules(snapshot, rules, alertState) {
  const alerts = [];
  const repeatHours = Number(rules.repeatAlertHours || 24);
  const btc = position(snapshot, "BTC");
  const eth = position(snapshot, "ETH");

  if (snapshot.cashPct < Number(rules.cashMinPct || 35)) {
    addAlert(alerts, alertState, repeatHours, {
      id: "cash-below-min",
      symbol: "CASH",
      type: "risk",
      severity: "high",
      message: `Cash ratio is ${snapshot.cashPct.toFixed(1)}%, below the ${rules.cashMinPct}% floor. Stop all buy alerts.`,
      action: "Do not add risk. Rebuild cash first."
    });
    return alerts;
  }

  const now = new Date();
  const dca = rules.fixedDca;
  if (dca?.enabled && now.getUTCDay() === Number(dca.weekdayUtc) && snapshot.cashPct >= Number(dca.requireCashPct)) {
    const id = `fixed-dca-${isoWeek(now)}`;
    addAlert(alerts, alertState, repeatHours, {
      id,
      symbol: "BTC/ETH",
      type: "fixed-dca",
      severity: "low",
      message: `Weekly DCA triggered. Buy BTC ${dca.btcAmount} USDT and ETH ${dca.ethAmount} USDT.`,
      action: `Execute only if cash ratio remains above ${dca.requireCashPct}%.`
    });
  }

  for (const rule of rules.dipBuyRules || []) {
    if (btc && Number.isFinite(btc.price) && btc.price <= Number(rule.btcPriceBelow) && snapshot.cashPct >= Number(rule.requireCashPct)) {
      addAlert(alerts, alertState, repeatHours, {
        id: rule.id,
        symbol: "BTC/ETH",
        type: "dip-buy",
        severity: "medium",
        message: `Dip-buy level hit. BTC price ${btc.price.toFixed(2)} <= ${rule.btcPriceBelow}.`,
        action: `Plan: BTC ${rule.btcAmount} USDT, ETH ${rule.ethAmount} USDT. ${rule.note || ""}`
      });
    }
  }

  for (const rule of rules.trendFollowRules || []) {
    if (rule.pauseIfWeeklyGainAbovePct) continue;
    if (btc && Number.isFinite(btc.price) && btc.price >= Number(rule.btcPriceAbove)) {
      const extra = rule.requireManualConfirmation ? "Manual confirmation required: price should hold for the required period." : "";
      addAlert(alerts, alertState, repeatHours, {
        id: rule.id,
        symbol: rule.symbol || "BTC",
        type: "trend-follow",
        severity: "low",
        message: `Trend-follow level hit. BTC price ${btc.price.toFixed(2)} >= ${rule.btcPriceAbove}. ${extra}`,
        action: rule.action
      });
    }
  }

  if (eth && Number.isFinite(eth.price) && eth.price <= 1500 && snapshot.cashPct >= 35) {
    addAlert(alerts, alertState, repeatHours, {
      id: "eth-1500",
      symbol: "ETH",
      type: "dip-buy",
      severity: "medium",
      message: `ETH price ${eth.price.toFixed(2)} <= 1500.`,
      action: "Plan: buy ETH 300 USDT."
    });
  }
  if (eth && Number.isFinite(eth.price) && eth.price <= 1350 && snapshot.cashPct >= 35) {
    addAlert(alerts, alertState, repeatHours, {
      id: "eth-1350",
      symbol: "ETH",
      type: "dip-buy",
      severity: "medium",
      message: `ETH price ${eth.price.toFixed(2)} <= 1350.`,
      action: "Plan: buy ETH 500 USDT."
    });
  }

  for (const [symbol, sellRules] of Object.entries(rules.sellRules || {})) {
    const row = position(snapshot, symbol);
    if (!row) continue;
    for (const rule of sellRules) {
      const priceHit = Number.isFinite(Number(rule.priceAbove)) && row.price >= Number(rule.priceAbove);
      const weightHit = Number.isFinite(Number(rule.weightAbovePct)) && row.weightPct >= Number(rule.weightAbovePct);
      if (priceHit || weightHit) {
        addAlert(alerts, alertState, repeatHours, {
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

  for (const [symbol, target] of Object.entries(rules.targets || {})) {
    const row = position(snapshot, symbol);
    if (row && row.weightPct > Number(target.maxPct)) {
      addAlert(alerts, alertState, repeatHours, {
        id: `${symbol.toLowerCase()}-above-target`,
        symbol,
        type: "risk",
        severity: "medium",
        message: `${symbol} weight is ${row.weightPct.toFixed(1)}%, above the ${target.maxPct}% cap.`,
        action: "Stop adding. Consider trimming if it keeps rising."
      });
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
  const email = await sendEmail(alerts, snapshot);

  await writeJson(files.snapshot, snapshot);
  await writeJson(files.alerts, { updatedAt: snapshot.updatedAt, email, alerts });
  await writeJson(files.alertState, alertState);

  console.log(JSON.stringify({
    totalValue: snapshot.totalValue,
    cashPct: snapshot.cashPct,
    alerts: alerts.length,
    email,
    priceErrors: errors
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
