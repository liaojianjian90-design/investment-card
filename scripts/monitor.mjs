import fs from "node:fs/promises";
import path from "node:path";
import { calculateHealthSummary, getV4Rules } from "../src/lib/investmentHealth.mjs";

const root = process.cwd();
const isDryRun = process.argv.includes("--dry-run");
const noWrite = process.env.NO_WRITE === "true" || process.argv.includes("--no-write");
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
  alertState: path.join(root, "data", "alert-state.json"),

  // 执行偏差追踪日志：记录系统触发过哪些可执行提醒，以及你后续有没有执行。
  executionLog: path.join(root, "data", "execution_log.json"),

  // 信号状态文件：记录某个信号组合当前是否仍处于触发状态，避免同一波急跌每次刷新重复写日志。
  executionSignalState: path.join(root, "data", "execution_signal_state.json")
};

const names = {
  USDT: "Tether",
  USDGO: "USDGO",
  BTC: "Bitcoin",
  ETH: "Ethereum",
  DOGE: "Dogecoin",
  BGB: "Bitget Token",
  VOO: "Vanguard S&P 500 ETF",
  XAUT: "Tether Gold",
  AVGO: "Broadcom",
  MRVL: "Marvell Technology",
  ANET: "Arista Networks",
  TSM: "Taiwan Semiconductor Manufacturing",
  ASML: "ASML Holding",
  SMH: "VanEck Semiconductor ETF",
  SOXX: "iShares Semiconductor ETF",
  FN: "Fabrinet",
  MU: "Micron",
  SNDK: "SanDisk",
  DRAM: "Roundhill Memory ETF",
  WDC: "Western Digital",
  ASX: "ASE Technology",
  AAOI: "Applied Optoelectronics",
  GLW: "Corning"
};

const bitgetSymbols = {
  BTC: ["BTCUSDT"],
  ETH: ["ETHUSDT"],
  DOGE: ["DOGEUSDT"],
  BGB: ["BGBUSDT"],
  XAUT: ["XAUTUSDT"],
  VOO: ["RVOOUSDT", "VOOUSDT"],
  AVGO: ["RAVGOUSDT", "AVGOUSDT"],
  MRVL: ["MRVLUSDT", "RMRVLUSDT"],
  ANET: ["RANETUSDT", "ANETUSDT"],
  TSM: ["RTSMUSDT", "TSMUSDT"],
  ASML: ["RASMLUSDT", "ASMLUSDT"],
  SMH: ["RSMHUSDT", "SMHUSDT"],
  SOXX: ["RSOXXUSDT", "SOXXUSDT"],
  FN: ["RFNUSDT", "FNUSDT"],
  MU: ["RMUUSDT", "MUUSDT"],
  SNDK: ["RSNDKUSDT", "SNDKUSDT"],
  DRAM: ["RDRAMUSDT", "DRAMUSDT"],
  WDC: ["RWDCUSDT", "WDCUSDT"],
  ASX: ["RASXUSDT", "ASXUSDT"],
  AAOI: ["RAAOIUSDT", "AAOIUSDT"],
  GLW: ["RGLWUSDT", "GLWUSDT"]
};

const yahooSymbols = {
  VOO: "VOO",
  AVGO: "AVGO",
  MRVL: "MRVL",
  ANET: "ANET",
  TSM: "TSM",
  ASML: "ASML",
  SMH: "SMH",
  SOXX: "SOXX",
  FN: "FN",
  MU: "MU",
  SNDK: "SNDK",
  DRAM: "DRAM",
  WDC: "WDC",
  ASX: "ASX",
  AAOI: "AAOI",
  GLW: "GLW"
};

const stooqSymbols = Object.fromEntries(Object.entries(yahooSymbols).map(([symbol, ticker]) => [symbol, `${ticker.toLowerCase()}.us`]));

const coingeckoIds = {
  BTC: "bitcoin",
  ETH: "ethereum",
  DOGE: "dogecoin"
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

function emptyExecutionLog() {
  return {
    schemaVersion: "1.0",
    updatedAt: null,
    records: []
  };
}

function emptyExecutionSignalState() {
  return {
    schemaVersion: "1.0",
    updatedAt: null,
    signals: {}
  };
}

function normalizeExecutionLog(raw) {
  const log = raw && typeof raw === "object" ? raw : emptyExecutionLog();
  log.schemaVersion ||= "1.0";
  if (!Array.isArray(log.records)) log.records = [];
  if (!Object.prototype.hasOwnProperty.call(log, "updatedAt")) log.updatedAt = null;
  return log;
}

function normalizeExecutionSignalState(raw) {
  const state = raw && typeof raw === "object" ? raw : emptyExecutionSignalState();
  state.schemaVersion ||= "1.0";
  if (!state.signals || typeof state.signals !== "object") state.signals = {};
  if (!Object.prototype.hasOwnProperty.call(state, "updatedAt")) state.updatedAt = null;
  return state;
}

// 只用于生成 id / dedupeKey / signalStateKey 的标准化标的顺序。
// 注意：这个排序不会影响 suggestedAllocation、邮件正文和前端展示顺序。
function executionSymbolsKey(symbols = []) {
  return [...new Set(symbols.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))]
    .sort()
    .join("-");
}

function beijingIsoString(date = new Date()) {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = beijing.getUTCFullYear();
  const mm = String(beijing.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(beijing.getUTCDate()).padStart(2, "0");
  const hh = String(beijing.getUTCHours()).padStart(2, "0");
  const mi = String(beijing.getUTCMinutes()).padStart(2, "0");
  const ss = String(beijing.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+08:00`;
}

function beijingCompactTimestamp(date = new Date()) {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = beijing.getUTCFullYear();
  const mm = String(beijing.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(beijing.getUTCDate()).padStart(2, "0");
  const hh = String(beijing.getUTCHours()).padStart(2, "0");
  const mi = String(beijing.getUTCMinutes()).padStart(2, "0");
  const ss = String(beijing.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}+0800`;
}

// id 的职责：让每一条执行日志记录唯一，不用于去重判断。
function buildExecutionRecordId({ createdAtDate, type, level, symbols }) {
  return `${beijingCompactTimestamp(createdAtDate)}-${type}-${level}-${executionSymbolsKey(symbols)}`;
}

// signalStateKey 的职责：追踪同一天同类型、同级别、同一标的组合是否仍处于触发状态。
function buildSignalStateKey({ tradingDate, type, level, symbols }) {
  return `${tradingDate}|${type}|${level}|${executionSymbolsKey(symbols)}`;
}

// dedupeKey 的职责：判断“这一波机会”是否已经写过日志。
// 同一天同组合如果解除后重新触发，会生成新的 episode 时间，因此 dedupeKey 不同。
function buildDedupeKey({ signalStateKey, episodeStartedAtDate }) {
  return `${signalStateKey}|episode=${beijingCompactTimestamp(episodeStartedAtDate)}`;
}

function executionLogHasDedupeKey(executionLog, dedupeKey) {
  return Array.isArray(executionLog?.records) && executionLog.records.some((record) => record.dedupeKey === dedupeKey);
}

function priceQualityOf(row) {
  if (row?.priceQuality) return String(row.priceQuality).toLowerCase();
  if (row?.quality) return String(row.quality).toLowerCase();
  if (row?.priceCachedFallback) return "delayed";
  return "realtime";
}

// 价格数据无效时，不能把 active 从 true 改成 false；否则会把价格源失败误判成信号解除。
function isExecutionSignalPriceReliable(rows = []) {
  if (!rows.length) return false;
  return rows.every((row) => {
    const quality = priceQualityOf(row);
    if (quality === "missing" || quality === "estimated") return false;
    if (!row.priceOk) return false;
    if (row.priceCachedFallback) return false;
    if (row.isDataBlocked) return false;
    return Number.isFinite(Number(row.price)) && Number(row.price) > 0;
  });
}

function buildSymbolMoves(rows = []) {
  return rows.map((row) => ({
    symbol: row.symbol,
    price: Number.isFinite(Number(row.price)) ? Number(row.price) : null,
    changePct: Number.isFinite(Number(row.dropPctFromPreviousClose))
      ? -Math.abs(Number(row.dropPctFromPreviousClose))
      : Number.isFinite(Number(row.intradayDropPctFromHigh))
        ? -Math.abs(Number(row.intradayDropPctFromHigh))
        : null,
    intradayDropPct: Number.isFinite(Number(aiDipDropPct(row))) ? -Math.abs(Number(aiDipDropPct(row))) : null,
    dayLowDropPct: Number.isFinite(Number(aiDayLowDropPct(row))) ? -Math.abs(Number(aiDayLowDropPct(row))) : null,
    priceQuality: priceQualityOf(row)
  }));
}

function tradeAlertBlockReason(alertState, rules, alert) {
  const today = beijingDateKey();
  if (rules.oneTradePerDay && alertState.lastActiveTradeDate === today) return "oneTradePerDay";
  const repeatHours = Number(rules.repeatAlertHours || 24);
  const last = alertState.lastAlerts?.[alert.id];
  if (last && Date.now() - Date.parse(last) <= repeatHours * 60 * 60 * 1000) return "repeatAlertHours";
  return null;
}

function tradeAlertBlockReasonText(reason) {
  if (reason === "oneTradePerDay") return "当天主动交易提醒频率限制生效，邮件未再次发出，但该信号仍已写入执行日志。";
  if (reason === "repeatAlertHours") return "重复提醒时间间隔限制生效，邮件未再次发出，但该信号仍已写入执行日志。";
  return "邮件提醒未新增，但该信号仍已写入执行日志。";
}

function clearExecutionSignalIfNeeded(signalState, signalStateKey, now, metrics = {}, dataReliable = true) {
  const entry = signalState.signals?.[signalStateKey];
  if (!entry || entry.active !== true) return false;

  if (!dataReliable) {
    entry.lastCheckedAt = beijingIsoString(now);
    entry.dataStatus = "price_unreliable_keep_active";
    entry.lastMetrics = metrics;
    signalState.updatedAt = beijingIsoString(now);
    return false;
  }

  entry.active = false;
  entry.lastClearedAt = beijingIsoString(now);
  entry.lastCheckedAt = beijingIsoString(now);
  entry.dataStatus = "cleared";
  entry.lastMetrics = metrics;
  signalState.updatedAt = beijingIsoString(now);
  return true;
}

function clearTodayAiDipSignals(signalState, tradingDate, now, metrics = {}, dataReliable = true) {
  for (const key of Object.keys(signalState.signals || {})) {
    if (!key.startsWith(`${tradingDate}|ai_dip_opportunity|`)) continue;
    clearExecutionSignalIfNeeded(signalState, key, now, metrics, dataReliable);
  }
}

function upsertExecutionSignal({
  executionLog,
  signalState,
  tradingDate,
  type,
  level,
  actionSide,
  symbols,
  triggerReason,
  triggerMetrics,
  suggestedAction,
  suggestedAmountMin,
  suggestedAmountMax,
  suggestedCurrency = "USDT",
  suggestedAllocation = [],
  systemNote = "系统自动生成，等待用户手动补充执行结果。"
}) {
  const now = new Date();
  const stateKey = buildSignalStateKey({ tradingDate, type, level, symbols });
  let entry = signalState.signals[stateKey];

  // 情况 B/C：第一次触发，或上一波已经解除后重新触发。
  if (!entry || entry.active === false) {
    const episodeStartedAtDate = now;
    const episodeSeq = Number(entry?.episodeSeq || 0) + 1;
    const dedupeKey = buildDedupeKey({ signalStateKey: stateKey, episodeStartedAtDate });

    if (!executionLogHasDedupeKey(executionLog, dedupeKey)) {
      executionLog.records.unshift({
        id: buildExecutionRecordId({ createdAtDate: now, type, level, symbols }),
        dedupeKey,
        createdAt: beijingIsoString(now),
        tradingDate,
        type,
        level,
        actionSide,
        symbols,
        triggerReason,
        triggerMetrics,
        suggestedAction,
        suggestedAmountMin,
        suggestedAmountMax,
        suggestedCurrency,
        suggestedAllocation,
        status: "pending",
        userDecision: {
          wasNoticed: null,
          executed: null,
          executedAt: null,
          actualAmount: null,
          actualCurrency: suggestedCurrency,
          actualSymbols: [],
          skipReason: "",
          reviewNote: "",
          updatedAt: null
        },
        systemNote
      });
      executionLog.updatedAt = beijingIsoString(now);
    }

    signalState.signals[stateKey] = {
      active: true,
      currentDedupeKey: dedupeKey,
      episodeStartedAt: beijingIsoString(episodeStartedAtDate),
      lastSatisfiedAt: beijingIsoString(now),
      lastClearedAt: null,
      lastCheckedAt: beijingIsoString(now),
      episodeSeq,
      dataStatus: "satisfied",
      lastMetrics: triggerMetrics
    };
    signalState.updatedAt = beijingIsoString(now);
    return { added: true, dedupeKey, signalStateKey: stateKey };
  }

  // 情况 D：同一波机会仍在持续，不重复写日志，只更新状态。
  const dedupeKey = entry.currentDedupeKey;
  if (!executionLogHasDedupeKey(executionLog, dedupeKey)) {
    executionLog.records.unshift({
      id: buildExecutionRecordId({ createdAtDate: now, type, level, symbols }),
      dedupeKey,
      createdAt: beijingIsoString(now),
      tradingDate,
      type,
      level,
      actionSide,
      symbols,
      triggerReason,
      triggerMetrics,
      suggestedAction,
      suggestedAmountMin,
      suggestedAmountMax,
      suggestedCurrency,
      suggestedAllocation,
      status: "pending",
      userDecision: {
        wasNoticed: null,
        executed: null,
        executedAt: null,
        actualAmount: null,
        actualCurrency: suggestedCurrency,
        actualSymbols: [],
        skipReason: "",
        reviewNote: "",
        updatedAt: null
      },
      systemNote: "状态文件显示这一波机会已存在，但日志缺失，系统自动补写。"
    });
    executionLog.updatedAt = beijingIsoString(now);
  }

  entry.lastSatisfiedAt = beijingIsoString(now);
  entry.lastCheckedAt = beijingIsoString(now);
  entry.dataStatus = "satisfied";
  entry.lastMetrics = triggerMetrics;
  signalState.updatedAt = beijingIsoString(now);

  return { added: false, dedupeKey, signalStateKey: stateKey };
}

function normalizePriceSourceLabel(source) {
  const raw = String(source || "").trim();
  if (!raw) return "GitHub快照";
  const parts = raw
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, arr) => arr.indexOf(part) === index);
  const cleaned = parts
    .filter((part) => !["零仓位观察备用", "前端快照备用", "GitHub快照备用"].includes(part))
    .join(" / ");
  return cleaned || parts[0] || "GitHub快照";
}

function quotesFromSnapshot(snapshot) {
  const quotes = {};
  if (!snapshot || !Array.isArray(snapshot.positions)) return quotes;
  for (const row of snapshot.positions) {
    const price = Number(row.price);
    if (row.symbol && Number.isFinite(price) && price > 0) {
      quotes[row.symbol] = {
        price,
        source: normalizePriceSourceLabel(row.priceSource || "GitHub快照"),
        updatedAt: row.priceUpdatedAt || snapshot.updatedAt || new Date().toISOString(),
        dayHigh: Number.isFinite(Number(row.dayHigh)) ? Number(row.dayHigh) : null,
        dayLow: Number.isFinite(Number(row.dayLow)) ? Number(row.dayLow) : null,
        previousClose: Number.isFinite(Number(row.previousClose)) ? Number(row.previousClose) : null,
        fromSnapshot: true
      };
    }
  }
  return quotes;
}

function allAssets(holdings) {
  return [...(holdings.cash || []), ...(holdings.positions || [])];
}

async function fetchJson(url) {
  const timeoutMs = Number(process.env.PRICE_FETCH_TIMEOUT_MS || 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "investment-monitor-card/5.3.3" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return await res.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`timeout after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function bitgetPairQuote(pair) {
  const data = await fetchJson(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${pair}`);
  const ticker = data.data?.[0] || {};
  const price = Number(ticker.lastPr);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`invalid Bitget price for ${pair}`);
  const dayHigh = Number(ticker.high24h ?? ticker.highUtc24h ?? ticker.high);
  const dayLow = Number(ticker.low24h ?? ticker.lowUtc24h ?? ticker.low);
  const previousClose = Number(ticker.openUtc ?? ticker.open24h ?? ticker.open);
  return {
    price,
    source: `Bitget ${pair}`,
    dayHigh: Number.isFinite(dayHigh) ? dayHigh : null,
    dayLow: Number.isFinite(dayLow) ? dayLow : null,
    previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null
  };
}

async function bitgetQuote(symbol) {
  const pairs = Array.isArray(bitgetSymbols[symbol]) ? bitgetSymbols[symbol] : [bitgetSymbols[symbol]].filter(Boolean);
  if (!pairs.length) throw new Error(`no Bitget symbol for ${symbol}`);
  const errors = [];
  for (const pair of pairs) {
    try {
      return await bitgetPairQuote(pair);
    } catch (error) {
      errors.push(`${pair}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function yahooQuote(symbol) {
  const ticker = yahooSymbols[symbol];
  if (!ticker) throw new Error(`no Yahoo symbol for ${symbol}`);
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=5m`);
  const result = data.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const closeValues = Array.isArray(quote.close) ? quote.close.map(Number).filter(Number.isFinite) : [];
  const highValues = Array.isArray(quote.high) ? quote.high.map(Number).filter(Number.isFinite) : [];
  const lowValues = Array.isArray(quote.low) ? quote.low.map(Number).filter(Number.isFinite) : [];
  const close = closeValues.at(-1);
  const price = Number(meta.regularMarketPrice ?? meta.postMarketPrice ?? meta.preMarketPrice ?? close ?? meta.previousClose ?? meta.chartPreviousClose);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`invalid Yahoo price for ${ticker}`);
  const dayHigh = highValues.length ? Math.max(...highValues) : Number(meta.regularMarketDayHigh);
  const dayLow = lowValues.length ? Math.min(...lowValues) : Number(meta.regularMarketDayLow);
  const previousClose = Number(meta.previousClose ?? meta.chartPreviousClose);
  return {
    price,
    source: `Yahoo Finance ${ticker}`,
    dayHigh: Number.isFinite(dayHigh) ? dayHigh : null,
    dayLow: Number.isFinite(dayLow) ? dayLow : null,
    previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null
  };
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += char;
  }
  out.push(cur);
  return out;
}

async function stooqQuote(symbol) {
  const ticker = stooqSymbols[symbol];
  if (!ticker) throw new Error(`no Stooq symbol for ${symbol}`);
  const timeoutMs = Number(process.env.PRICE_FETCH_TIMEOUT_MS || 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(ticker)}&f=sd2t2ohlcv&h&e=csv`, {
      headers: { "user-agent": "investment-monitor-card/5.3.3" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    const headers = parseCsvLine(lines[0] || "");
    const values = parseCsvLine(lines[1] || "");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const price = Number(row.Close);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`invalid Stooq price for ${ticker}`);
    const dayHigh = Number(row.High);
    const dayLow = Number(row.Low);
    const previousClose = Number(row.Open);
    return {
      price,
      source: `Stooq ${ticker.toUpperCase()}`,
      dayHigh: Number.isFinite(dayHigh) ? dayHigh : null,
      dayLow: Number.isFinite(dayLow) ? dayLow : null,
      previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`timeout after ${timeoutMs}ms: Stooq ${ticker}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function coingeckoQuote(symbol) {
  const id = coingeckoIds[symbol];
  if (!id) throw new Error(`no CoinGecko id for ${symbol}`);
  const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
  const price = Number(data[id]?.usd);
  if (!Number.isFinite(price)) throw new Error(`invalid CoinGecko price for ${symbol}`);
  return { price, source: "CoinGecko" };
}

async function binanceQuote(symbol) {
  const data = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
  const price = Number(data.price);
  if (!Number.isFinite(price)) throw new Error(`invalid Binance price for ${symbol}`);
  return { price, source: `Binance ${symbol}USDT` };
}

async function quote(symbol) {
  const now = new Date().toISOString();
  if (failSymbols.has(symbol)) throw new Error(`forced test failure for ${symbol}`);
  if (mockPrices && Number.isFinite(Number(mockPrices[symbol]))) {
    const dayHigh = mockNumber(`${symbol}_DAY_HIGH`, `${symbol}_HIGH`);
    const dayLow = mockNumber(`${symbol}_DAY_LOW`, `${symbol}_LOW`);
    const previousClose = mockNumber(`${symbol}_PREV_CLOSE`, `${symbol}_PREVIOUS_CLOSE`, `${symbol}_OPEN`);
    return {
      price: Number(mockPrices[symbol]),
      source: "Mock price",
      updatedAt: now,
      dayHigh: Number.isFinite(dayHigh) ? dayHigh : null,
      dayLow: Number.isFinite(dayLow) ? dayLow : null,
      previousClose: Number.isFinite(previousClose) ? previousClose : null
    };
  }
  if (symbol === "USDT" || symbol === "USDGO") return { price: 1, source: "Fixed 1 USDT", updatedAt: now };

  const errors = [];
  const sources = [];
  if (bitgetSymbols[symbol]) sources.push(() => bitgetQuote(symbol));
  if (yahooSymbols[symbol]) sources.push(() => yahooQuote(symbol), () => stooqQuote(symbol));
  if (coingeckoIds[symbol]) sources.push(() => coingeckoQuote(symbol), () => binanceQuote(symbol));

  for (const source of sources) {
    try {
      const result = await source();
      return { ...result, updatedAt: now };
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join(" | ") || `no price source for ${symbol}`);
}

async function loadPrices(assets, fallbackQuotes = {}, activeSymbols = new Set()) {
  const entries = await Promise.all(assets.map(async (asset) => {
    const symbol = asset.symbol;
    const quantity = Number(asset.quantity || 0);
    if (quantity <= 0 && symbol !== "USDT" && symbol !== "USDGO" && !activeSymbols.has(symbol)) {
      if (fallbackQuotes[symbol]) {
        return [symbol, {
          ...fallbackQuotes[symbol],
          source: normalizePriceSourceLabel(fallbackQuotes[symbol].source || "GitHub快照"),
          cachedFallback: true
        }, null, null];
      }
      return [symbol, null, null, null];
    }
    try {
      const result = await quote(symbol);
      return [symbol, result, null, null];
    } catch (error) {
      const message = error.message || "price source failed";
      if (fallbackQuotes[symbol]) {
        return [symbol, {
          ...fallbackQuotes[symbol],
          source: normalizePriceSourceLabel(fallbackQuotes[symbol].source || "GitHub快照"),
          cachedFallback: true,
          livePriceError: message
        }, null, message];
      }
      // 零仓位观察标的只用于观察池展示；没有价格时不应让手机端整页出现“价格源失败”。
      if (quantity <= 0) return [symbol, null, null, null];
      return [symbol, null, message, null];
    }
  }));

  const quotes = {};
  const errors = {};
  const warnings = {};
  for (const [symbol, result, error, warning] of entries) {
    if (result) quotes[symbol] = result;
    if (error) errors[symbol] = error;
    if (warning) warnings[symbol] = warning;
  }
  return { quotes, errors, warnings };
}

function mockNumber(...keys) {
  if (!mockPrices) return null;
  for (const key of keys) {
    const value = Number(mockPrices[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function activePriceSymbols(rules) {
  const symbols = new Set(["BTC", "ETH", "DOGE", "BGB", "XAUT"]);
  const aiDip = rules.aiIntradayDropOpportunityRules || rules.v5Rules?.aiIntradayDropOpportunityRules || {};
  for (const symbol of [...(aiDip.primarySymbols || []), ...(aiDip.secondarySymbols || []), ...(aiDip.supplementalSymbols || [])]) symbols.add(symbol);
  for (const rule of rules.watchBuyRules || []) if (rule.symbol) symbols.add(rule.symbol);
  for (const rule of rules.trendWatchRules || []) if (rule.symbol) symbols.add(rule.symbol);
  for (const rule of rules.trendFollowRules || []) if (rule.symbol) symbols.add(rule.symbol);
  for (const symbol of Object.keys(rules.sellRules || {})) symbols.add(symbol);
  return symbols;
}

async function loadBtcFiveMinuteChangePct() {
  const mocked = mockNumber("BTC_5M_CHANGE_PCT", "BTC_5MIN_CHANGE_PCT", "BTC_CHANGE_5M_PCT");
  if (mocked !== null) return mocked;

  try {
    const data = await fetchJson("https://api.bitget.com/api/v2/spot/market/candles?symbol=BTCUSDT&granularity=5min&limit=3");
    const candles = (data.data || [])
      .map((item) => ({
        time: Number(item[0]),
        open: Number(item[1]),
        close: Number(item[4])
      }))
      .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.open) && item.open > 0 && Number.isFinite(item.close))
      .sort((a, b) => a.time - b.time);
    const latest = candles.at(-1);
    if (!latest) return null;
    return (latest.close - latest.open) / latest.open * 100;
  } catch {
    return null;
  }
}

function buildSnapshot(holdings, quotes, priceErrors, rules, priceWarnings = {}) {
  const updatedAt = new Date().toISOString();
  const forcedAge = mockNumber("DATA_AGE_MINUTES", "SNAPSHOT_AGE_MINUTES");
  const dataAgeMinutes = Number.isFinite(forcedAge) ? forcedAge : 0;
  const staleWarn = Number(rules.dataStaleWarnMinutes || 10);
  const staleBlock = Number(rules.dataStaleBlockMinutes || 30);

  const rows = allAssets(holdings).map((asset) => {
    const quoteData = quotes[asset.symbol];
    const priceOk = Number.isFinite(Number(quoteData?.price));
    const valuePrice = priceOk ? Number(quoteData.price) : Number(asset.cost || 0);
    const quantity = Number(asset.quantity || 0);
    const cost = Number(asset.cost || 0);
    const value = quantity * valuePrice;
    const costValue = quantity * cost;
    const pnl = value - costValue;
    return {
      symbol: asset.symbol,
      name: names[asset.symbol] || asset.symbol,
      type: asset.type,
      quantity,
      cost,
      price: priceOk ? Number(quoteData.price) : null,
      priceOk,
      priceSource: quoteData?.source || null,
      priceUpdatedAt: quoteData?.updatedAt || null,
      priceCachedFallback: Boolean(quoteData?.cachedFallback),
      dayHigh: Number.isFinite(Number(quoteData?.dayHigh)) && Number(quoteData.dayHigh) > 0 ? Number(quoteData.dayHigh) : null,
      dayLow: Number.isFinite(Number(quoteData?.dayLow)) && Number(quoteData.dayLow) > 0 ? Number(quoteData.dayLow) : null,
      previousClose: Number.isFinite(Number(quoteData?.previousClose)) && Number(quoteData.previousClose) > 0 ? Number(quoteData.previousClose) : null,
      intradayDropPctFromHigh: Number.isFinite(Number(quoteData?.dayHigh)) && Number(quoteData.dayHigh) > 0 && priceOk ? (Number(quoteData.dayHigh) - Number(quoteData.price)) / Number(quoteData.dayHigh) * 100 : 0,
      dropPctFromPreviousClose: Number.isFinite(Number(quoteData?.previousClose)) && Number(quoteData.previousClose) > 0 && priceOk ? (Number(quoteData.previousClose) - Number(quoteData.price)) / Number(quoteData.previousClose) * 100 : 0,
      dayLowDropPctFromHigh: Number.isFinite(Number(quoteData?.dayHigh)) && Number(quoteData.dayHigh) > 0 && Number.isFinite(Number(quoteData?.dayLow)) && Number(quoteData.dayLow) > 0 ? (Number(quoteData.dayHigh) - Number(quoteData.dayLow)) / Number(quoteData.dayHigh) * 100 : 0,
      reboundPctFromDayLow: Number.isFinite(Number(quoteData?.dayLow)) && Number(quoteData.dayLow) > 0 && priceOk ? (Number(quoteData.price) - Number(quoteData.dayLow)) / Number(quoteData.dayLow) * 100 : 0,
      priceWarning: priceWarnings[asset.symbol] || quoteData?.livePriceError || null,
      priceError: priceErrors[asset.symbol] || null,
      dataAgeMinutes,
      isStale: dataAgeMinutes >= staleWarn,
      isDataBlocked: dataAgeMinutes >= staleBlock,
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
    updatedAt,
    source: "github-actions",
    totalValue,
    cashValue,
    cashPct: totalValue > 0 ? cashValue / totalValue * 100 : 0,
    dataAgeMinutes,
    isStale: dataAgeMinutes >= staleWarn,
    isDataBlocked: dataAgeMinutes >= staleBlock,
    weights: Object.fromEntries(rows.map((row) => [row.symbol, row.weightPct])),
    priceErrors,
    priceWarnings,
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

function beijingDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addAlert(alerts, alertState, rules, alert) {
  const repeatHours = Number(rules.repeatAlertHours || 24);
  const last = alertState.lastAlerts?.[alert.id];
  if (last && Date.now() - Date.parse(last) <= repeatHours * 60 * 60 * 1000) return false;
  const createdAt = new Date().toISOString();
  alertState.lastAlerts ||= {};
  alertState.lastAlerts[alert.id] = createdAt;
  alerts.push({ ...alert, createdAt });
  return true;
}

function addTradeAlert(alerts, alertState, rules, alert) {
  const today = beijingDateKey();
  if (rules.oneTradePerDay && alertState.lastActiveTradeDate === today) return false;
  const added = addAlert(alerts, alertState, rules, alert);
  if (added) alertState.lastActiveTradeDate = today;
  return added;
}

function addWeeklyAlert(alerts, alertState, rules, baseId, alert) {
  return addAlert(alerts, alertState, rules, { ...alert, id: `${baseId}-${isoWeek(new Date())}` });
}

function addLowFrequencyExecutionAlerts(alerts, alertState, rules, snapshot) {
  const policy = rules.lowFrequencyExecutionPolicy || rules.v5Rules?.lowFrequencyExecutionPolicy || {};
  if (policy.enabled === false) return;
  const v5 = getV4Rules(rules);
  const aiSymbols = v5.themeLayer?.symbols || [];
  const aiWeight = combinedWeight(snapshot, aiSymbols);
  const coreWeight = combinedWeight(snapshot, ["BTC", "ETH"]);
  const stableWeight = combinedWeight(snapshot, ["VOO", "XAUT"]);
  const today = beijingDateKey(new Date());
  if (policy.dailySummary !== false) {
    addAlert(alerts, alertState, rules, {
      id: `daily-exec-summary-${today}`,
      symbol: "PORTFOLIO",
      type: "daily-summary",
      severity: "low",
      title: "每日低频执行摘要",
      conclusion: "今天只看是否有A/S级AI急跌、风控、再平衡或预设价位；没有就不操作。",
      reason: `现金 ${formatPct(snapshot.cashPct)}；AI主攻仓 ${formatPct(aiWeight)}；BTC/ETH ${formatPct(coreWeight)}；VOO/XAUT ${formatPct(stableWeight)}。`,
      action: snapshot.cashPct > 70
        ? "现金偏高，但新增资金优先 AI 主攻仓；BTC/XAUT 只做底仓观察。"
        : "维持低频执行；上涨不追，AI急跌按规则买，BTC/XAUT 不机械补。",
      discipline: policy.principle || "平时少动；上涨不追；急跌敢买；单笔有效；仓位达标就停。"
    });
  }
  const reviewWeekday = Number(policy.weeklyReviewWeekdayUtc ?? 0);
  if (policy.weeklyReview !== false && new Date().getUTCDay() === reviewWeekday) {
    addWeeklyAlert(alerts, alertState, rules, "weekly-exec-review", {
      symbol: "PORTFOLIO",
      type: "weekly-review",
      severity: "low",
      title: "每周执行复盘",
      conclusion: "复盘本周是否过度看盘、是否错过A/S级机会、是否出现无效小单。",
      reason: `当前现金 ${formatPct(snapshot.cashPct)}，AI主攻仓 ${formatPct(aiWeight)}，目标 25%-35%，35% 后停止新增，40% 为硬上限。`,
      action: "下周只围绕 MU/DRAM/GLW/SMH 与 SMH 的有效价位执行；BTC/XAUT 只在深跌或趋势确认后补。",
      discipline: "系统目标不是让你更忙，而是只在值得花钱的时候打断你。"
    });
  }
}

function addV5StructuralAlerts(alerts, alertState, rules, snapshot) {
  const v5 = getV4Rules(rules);
  const emailPolicy = v5.emailPolicy || {};
  if (emailPolicy.enabled === false) return;

  const cashPct = Number(snapshot.cashPct || 0);
  const btcWeight = position(snapshot, "BTC")?.weightPct || 0;
  const ethWeight = position(snapshot, "ETH")?.weightPct || 0;
  const vooWeight = position(snapshot, "VOO")?.weightPct || 0;
  const xautWeight = position(snapshot, "XAUT")?.weightPct || 0;
  const specSymbols = v5.speculativeLayer?.symbols || ["DOGE", "BGB"];
  const themeSymbols = v5.themeLayer?.symbols || [];
  const specWeight = combinedWeight(snapshot, specSymbols);
  const themeWeight = combinedWeight(snapshot, themeSymbols);
  const corePlusStable = btcWeight + ethWeight + vooWeight + xautWeight;
  const cashStructurePct = Number(emailPolicy.sendStructureWhenCashAbovePct ?? 0.80) * 100;
  const coreCashPct = Number(emailPolicy.sendCoreMissingWhenCashAbovePct ?? 0.75) * 100;
  const stableCashPct = Number(emailPolicy.sendStableMissingWhenCashAbovePct ?? 0.75) * 100;
  const noNewSpecPct = Number(emailPolicy.sendSpeculativeNoNewBuyAbove ?? v5.speculativeLayer?.noNewBuyAbove ?? 0.025) * 100;
  const reduceOnlySpecPct = Number(emailPolicy.sendSpeculativeReduceOnlyAbove ?? v5.speculativeLayer?.reduceOnlyAbove ?? 0.03) * 100;

  if (cashPct > cashStructurePct) {
    addWeeklyAlert(alerts, alertState, rules, "v5-cash-high-structure", {
      symbol: "CASH",
      type: "structure",
      severity: "low",
      title: "现金过高，资金效率偏低",
      conclusion: "账户很安全，但长期资产配置不足。",
      reason: `当前现金比例 ${formatPct(cashPct)}，超过 ${formatPct(cashStructurePct)}。`,
      action: "不要一次性打光现金；当前新增资金优先 AI 主攻仓，BTC/XAUT 只保留底仓，不机械补。",
      discipline: "现金是防守和二次进攻权，但长期 70%+ 现金会降低资金效率；主升方向优先。"
    });
  }

  const coreDetails = coreStructureDetails(snapshot, rules);
  if (cashPct >= coreCashPct && !coreDetails.totalEnough) {
    addWeeklyAlert(alerts, alertState, rules, "v5-core-missing", {
      symbol: "BTC/ETH",
      type: "core-fill",
      severity: "low",
      title: "BTC/ETH 底仓总量偏低",
      conclusion: "BTC/ETH 总量还没到最低底仓线，但当前不机械占用 AI 新增资金。",
      reason: `当前 BTC/ETH 合计 ${formatPct(coreDetails.total)}，低于 ${formatPct(coreDetails.totalMin)}；BTC ${formatPct(btcWeight)}，ETH ${formatPct(ethWeight)}，现金 ${formatPct(cashPct)}。`,
      amountText: "BTC 仅在 56k/55k 或重新站稳 62k 后小额补；ETH 只在深跌价位补",
      action: "AI 主攻仓低于 25% 时，BTC/ETH 只做底仓观察。",
      discipline: "BTC/ETH 是加密底仓，但当前不抢 AI 主攻资金。"
    });
  } else if (cashPct >= coreCashPct && coreDetails.skewed) {
    addWeeklyAlert(alerts, alertState, rules, "v5-core-skew", {
      symbol: "BTC/ETH",
      type: "core-skew",
      severity: "low",
      title: "BTC/ETH 总量达标但结构偏科",
      conclusion: "核心增长层不是不足，而是单项结构不均衡。",
      reason: `当前 BTC/ETH 合计 ${formatPct(coreDetails.total)}，已达到 ${formatPct(coreDetails.totalMin)}-${formatPct(coreDetails.totalMax)} 目标区间；偏低项：${coreDetails.missing.join("、")}。`,
      amountText: "这只是结构提示，不触发机械买入",
      action: "新增资金仍优先 AI 主攻仓；BTC/ETH 只有深跌或趋势确认后再补。",
      discipline: "总量达标优先于单项完美；不要为了修正偏科而错过 AI 主升方向。"
    });
  }

  if (cashPct >= stableCashPct && (vooWeight <= 0 || xautWeight <= 0)) {
    addWeeklyAlert(alerts, alertState, rules, "v5-stable-missing", {
      symbol: "VOO/XAUT",
      type: "stable-build",
      severity: "low",
      title: "VOO/XAUT 防守底仓观察",
      conclusion: "稳定层不再抢当前主升方向资金。",
      reason: `当前 VOO ${formatPct(vooWeight)}，XAUT ${formatPct(xautWeight)}。`,
      amountText: "XAUT 3900 上方不补，3850 以下再补；VOO 只在大跌价位补",
      action: "AI 主攻仓低于 25% 时，VOO/XAUT 只保留底仓。",
      discipline: "VOO/XAUT 是保险层，不是当前收益主攻。"
    });
  }

  if (specWeight >= noNewSpecPct) {
    addAlert(alerts, alertState, rules, {
      id: "v5-spec-no-new-buy",
      symbol: specSymbols.join("+"),
      type: "spec-risk",
      severity: specWeight >= reduceOnlySpecPct ? "medium" : "medium",
      title: "DOGE/BGB 高弹性卫星仓达到上限",
      conclusion: specWeight >= reduceOnlySpecPct ? "已进入只减不补区。" : "已达到禁止新增区。",
      reason: `${specSymbols.join(" + ")} 当前合计仓位 ${formatPct(specWeight)}。`,
      action: "DOGE 只在 BTC 趋势确认且仓位未超上限时考虑；BGB 不放大。达到上限后以趋势止盈或反弹减仓为主。",
      discipline: "DOGE 可以做 BTC 放大器，但不能用下跌摊低成本的方式变成核心仓。"
    });
  }

  if (themeWeight >= Number(v5.themeLayer?.hardMax ?? 0.15) * 100) {
    addAlert(alerts, alertState, rules, {
      id: "v5-theme-hard-max",
      symbol: "AI",
      type: "theme-gate",
      severity: "high",
      title: "AI抽水机仓超过硬上限",
      conclusion: "停止新增 AI/半导体/存储/光通信仓位。",
      reason: `AI抽水机仓当前合计 ${formatPct(themeWeight)}，超过 35% 停止新增线。`,
      action: "只允许复盘或再平衡，不允许继续扩大AI抽水机仓。",
      discipline: "相关性高的 AI 资产不能当成真正分散。"
    });
  }

  if (v5.mrvlRule?.enabled) {
    const mrvlWeight = position(snapshot, "MRVL")?.weightPct || 0;
    if (mrvlWeight <= 0) {
      addWeeklyAlert(alerts, alertState, rules, "v5-mrvl-observe", {
        symbol: "MRVL",
        type: "theme-gate",
        severity: "low",
        title: "MRVL 加入 AI 观察池",
        conclusion: "MRVL 可作为 AI互联/定制芯片观察仓，但不触发优先买入。",
        reason: "MRVL 与 MU/WDC 不完全重复，可补充 AI 数据中心网络与定制芯片观察维度。",
        action: themeWeight < 25 ? "AI 主攻仓未到 25% 前，MRVL 只做第二梯队观察，不替代 MU/DRAM/GLW/SMH。" : "若 AI 主攻仓仍有空间，可考虑 0.5%-1% 小额试仓。",
        discipline: "MRVL 不是核心仓，单只 AI 股票不能替代 BTC/ETH/VOO/XAUT。"
      });
    } else if (mrvlWeight >= Number(v5.mrvlRule.hardMaxPct || 0.02) * 100) {
      addAlert(alerts, alertState, rules, {
        id: "v5-mrvl-hard-max",
        symbol: "MRVL",
        type: "theme-gate",
        severity: "medium",
        title: "MRVL 达到硬上限",
        conclusion: "MRVL 只允许持有或再平衡，不再新增。",
        reason: `MRVL 当前仓位 ${formatPct(mrvlWeight)}。`,
        action: "复核是否需要降低单一 AI 股票集中度。",
        discipline: "单只 AI 股票上限必须比主题总仓更严格。"
      });
    }
  }
}

function position(snapshot, symbol) {
  return snapshot.positions.find((row) => row.symbol === symbol);
}

function combinedWeight(snapshot, symbols) {
  return symbols.reduce((sum, symbol) => sum + (position(snapshot, symbol)?.weightPct || 0), 0);
}

function getTrendPriorityPolicy(rules) {
  return rules.trendPriorityPolicy || rules.v5Rules?.trendPriorityPolicy || {};
}

function currentAiWeight(snapshot, rules) {
  const v5 = getV4Rules(rules);
  return combinedWeight(snapshot, v5.themeLayer?.symbols || []);
}

function shouldDeferCoreStableBuy(snapshot, rules, symbol, row) {
  const policy = getTrendPriorityPolicy(rules);
  if (!policy.enabled) return false;
  const aiWeight = currentAiWeight(snapshot, rules);
  const deferBelow = Number(policy.deferCoreStableWhenAiBelowPct ?? 25);
  if (aiWeight >= deferBelow) return false;
  if (symbol === "XAUT") {
    const deep = Number(policy.xautDeepBuyBelow ?? 3850);
    return !Number.isFinite(row?.price) || Number(row.price) > deep;
  }
  if (symbol === "BTC") {
    const activeBelow = Number(policy.btcActiveBuyBelow ?? 56000);
    return !Number.isFinite(row?.price) || Number(row.price) > activeBelow;
  }
  return false;
}

function addTrendPriorityAlerts(alerts, alertState, rules, snapshot) {
  const policy = getTrendPriorityPolicy(rules);
  if (!policy.enabled) return;
  const v5 = getV4Rules(rules);
  const aiWeight = combinedWeight(snapshot, v5.themeLayer?.symbols || []);
  const coreWeight = combinedWeight(snapshot, ["BTC", "ETH"]);
  const stableWeight = combinedWeight(snapshot, ["VOO", "XAUT"]);
  const minAi = Number(policy.aiPriorityTargetMinPct ?? 25);
  if (snapshot.cashPct >= 45 && aiWeight < minAi) {
    addWeeklyAlert(alerts, alertState, rules, "trend-ai-priority", {
      symbol: "AI",
      type: "trend-priority",
      severity: "medium",
      title: "新增资金优先 AI 主攻仓",
      conclusion: "BTC/XAUT 当前只做底仓观察，不因目标不足机械补仓。",
      reason: `现金 ${formatPct(snapshot.cashPct)}；AI主攻仓 ${formatPct(aiWeight)}，低于 ${formatPct(minAi)}；BTC/ETH ${formatPct(coreWeight)}；VOO/XAUT ${formatPct(stableWeight)}。`,
      action: "新增资金优先等待 MU/DRAM/GLW/SMH 或 SMH 的 A/S 急跌与有效回调；BTC 只看 56k/55k 或 62k 重新确认，XAUT 只看 3850 以下。",
      discipline: policy.principle || "主升方向优先，防守底仓不抢新增资金。"
    });
  }
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

function alreadyTriggered(alertState, id) {
  return Boolean(alertState.triggeredLevels?.[id]);
}

function markTriggered(alertState, rule, details = {}) {
  alertState.triggeredLevels ||= {};
  alertState.triggeredLevels[rule.id] = { triggeredAt: new Date().toISOString(), ...details };
}

function projectedWeightPct(snapshot, symbol, addAmount) {
  const row = position(snapshot, symbol);
  if (!snapshot.totalValue) return 0;
  return ((row?.value || 0) + Number(addAmount || 0)) / snapshot.totalValue * 100;
}

function projectedCapBlock(snapshot, rules, symbol, addAmount) {
  for (const cap of rules.portfolioCaps || []) {
    if (!(cap.symbols || []).includes(symbol)) continue;
    const projected = combinedWeight(snapshot, cap.symbols) + (snapshot.totalValue > 0 ? Number(addAmount || 0) / snapshot.totalValue * 100 : 0);
    if (projected > Number(cap.maxPct)) return { ...cap, projected };
  }
  return null;
}

function resetLevels(alertState, rules, snapshot) {
  alertState.triggeredLevels ||= {};
  const btc = position(snapshot, "BTC");
  const eth = position(snapshot, "ETH");

  for (const rule of rules.dipBuyRules || []) {
    if (Number.isFinite(btc?.price) && Number.isFinite(Number(rule.resetAbove)) && btc.price >= Number(rule.resetAbove)) {
      delete alertState.triggeredLevels[rule.id];
    }
  }
  for (const rule of rules.ethDipRules || []) {
    if (Number.isFinite(eth?.price) && Number.isFinite(Number(rule.resetAbove)) && eth.price >= Number(rule.resetAbove)) {
      delete alertState.triggeredLevels[rule.id];
    }
  }
  for (const rule of rules.watchBuyRules || []) {
    const row = position(snapshot, rule.symbol);
    if (Number.isFinite(row?.price) && Number.isFinite(Number(rule.resetAbove)) && row.price >= Number(rule.resetAbove)) {
      delete alertState.triggeredLevels[rule.id];
    }
  }
  for (const rule of rules.trendWatchRules || []) {
    const row = position(snapshot, rule.symbol);
    if (Number.isFinite(row?.price) && Number.isFinite(Number(rule.resetBelow)) && row.price <= Number(rule.resetBelow)) {
      delete alertState.triggeredLevels[rule.id];
    }
  }
  for (const rule of rules.trendFollowRules || []) {
    if (Number.isFinite(btc?.price) && Number.isFinite(Number(rule.resetBelow)) && btc.price <= Number(rule.resetBelow)) {
      delete alertState.triggeredLevels[rule.id];
    }
  }
  const rapid = rules.rapidDropRules || {};
  if (Number.isFinite(btc?.price) && Number.isFinite(Number(rapid.resetAbove)) && btc.price >= Number(rapid.resetAbove)) {
    if (rapid.buyRuleId) delete alertState.triggeredLevels[rapid.buyRuleId];
  }
}

function canBuy(snapshot, rules) {
  return snapshot.cashPct >= Number(rules.cashMinPct || 35) && !snapshot.buyPaused && !snapshot.isDataBlocked;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function coreStructureDetails(snapshot, rules) {
  const v5 = getV4Rules(rules);
  const btcWeight = position(snapshot, "BTC")?.weightPct || 0;
  const ethWeight = position(snapshot, "ETH")?.weightPct || 0;
  const total = btcWeight + ethWeight;
  const totalMin = Number(v5.coreGrowthLayer?.btcEthTotalTargetMin ?? 0.08) * 100;
  const totalMax = Number(v5.coreGrowthLayer?.btcEthTotalTargetMax ?? 0.13) * 100;
  const btcMin = Number(v5.coreGrowthLayer?.btcFirstTargetMin ?? 0.05) * 100;
  const ethMin = Number(v5.coreGrowthLayer?.ethFirstTargetMin ?? 0.03) * 100;
  const missing = [];
  if (btcWeight < btcMin) missing.push("BTC");
  if (ethWeight < ethMin) missing.push("ETH");
  return {
    btcWeight,
    ethWeight,
    total,
    totalMin,
    totalMax,
    missing,
    totalEnough: total >= totalMin,
    skewed: total >= totalMin && total <= totalMax && missing.length > 0
  };
}

function safeMax(...values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : 0;
}

function aiDipDropPct(row) {
  if (!row || !row.priceOk || row.priceCachedFallback || row.isDataBlocked) return 0;
  return safeMax(row.intradayDropPctFromHigh, row.dropPctFromPreviousClose);
}

function aiDayLowDropPct(row) {
  if (!row || !row.priceOk || row.priceCachedFallback || row.isDataBlocked) return 0;
  return safeMax(row.dayLowDropPctFromHigh, row.intradayDropPctFromHigh, row.dropPctFromPreviousClose);
}

function formatSymbolDrop(row) {
  const current = aiDipDropPct(row);
  const low = aiDayLowDropPct(row);
  const lowText = low > current + 0.5 ? `，日内最大跌幅 ${formatPct(low)}` : "";
  return `${row.symbol} 当前跌幅 ${formatPct(current)}${lowText}`;
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

function dataStatus(snapshot) {
  if (snapshot.isDataBlocked) return `已过期 ${Number(snapshot.dataAgeMinutes).toFixed(0)} 分钟，禁止按信号买入`;
  if (snapshot.isStale) return `偏旧 ${Number(snapshot.dataAgeMinutes).toFixed(0)} 分钟，仅观察`;
  return "10 分钟内，正常";
}

function rowStatus(row) {
  if (!row) return "无持仓";
  if (row.type === "watch" && Number(row.quantity || 0) <= 0) return "观察池未建仓";
  if (!row.priceOk) return "价格源失败";
  if (row.isDataBlocked) return "数据过期";
  if (row.isStale) return "数据偏旧";
  return "正常";
}

function alertTypeLabel(type) {
  return {
    "data-risk": "数据异常",
    structure: "结构提醒",
    "core-fill": "核心底仓观察",
    "core-skew": "核心偏科",
    "stable-build": "稳定层底仓",
    "spec-risk": "投机仓风控",
    "theme-gate": "AI抽水机仓限制",
    risk: "现金风控",
    "drawdown-risk": "回撤风控",
    "cap-risk": "组合上限",
    "weight-risk": "仓位超限",
    "fixed-dca": "固定定投",
    "dip-buy": "下跌加仓",
    "rapid-drop-observe": "5分钟急跌观察",
    "rapid-drop-buy": "5分钟急跌试探",
    "ai-dip-opportunity": "AI急跌机会",
    "ai-dip-review": "错过机会复盘",
    "daily-summary": "每日摘要",
    "weekly-review": "周复盘",
    "risk-pause": "暂停买入",
    "trend-pause": "禁止追涨",
    "trend-follow": "BTC上涨追随",
    "trend-watch": "观察池上涨追随",
    "watch-buy": "观察池买点",
    sell: "止盈/再平衡",
    rebalance: "再平衡",
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
  if (alert.title) return alert.title;
  return `${alert.symbol || "组合"} ${alertTypeLabel(alert.type)}`;
}

function positionSummary(snapshot, symbol) {
  const row = position(snapshot, symbol);
  if (!row) return null;
  return `${symbol}: 现价 ${formatPrice(row.price)} | 来源 ${row.priceSource || "-"} | 仓位 ${formatPct(row.weightPct)} | 盈亏 ${formatMoney(row.pnl)} (${formatPct(row.pnlPct)})`;
}

function uniqueSymbols(alerts) {
  return [...new Set(alerts.flatMap((alert) => String(alert.symbol || "").split(/[+/]/)).filter(Boolean))];
}

function buildEmailContent(alerts, snapshot) {
  const symbols = uniqueSymbols(alerts);
  const hasHigh = alerts.some((alert) => alert.severity === "high");
  const hasSell = alerts.some((alert) => alert.type === "sell" || alert.type === "rebalance");
  const structureTypes = new Set(["structure", "core-fill", "stable-build", "spec-risk", "theme-gate"]);
  const hasStructure = alerts.some((alert) => structureTypes.has(alert.type));
  const subjectPrefix = hasHigh
    ? "【投资风控提醒】"
    : hasSell
      ? "【投资再平衡提醒】"
      : hasStructure
        ? "【投资结构提醒】"
        : "【投资监控提醒】";
  const subjectSymbols = symbols.slice(0, 4).join("、") || "组合";
  const subject = `${subjectPrefix}${subjectSymbols} ${alerts.length}条信号`;

  const header = [
    subjectPrefix.replace(/[【】]/g, ""),
    "",
    `检查时间：${formatDateCn(snapshot.updatedAt)} 北京时间`,
    `总资产：${formatMoney(snapshot.totalValue)}`,
    `现金比例：${formatPct(snapshot.cashPct)}`,
    `账户回撤：${formatPct(snapshot.drawdownPct || 0)}`,
    `数据状态：${dataStatus(snapshot)}`,
    Number.isFinite(Number(snapshot.btcFiveMinuteChangePct)) ? `BTC 5分钟涨跌：${formatPct(snapshot.btcFiveMinuteChangePct)}` : null,
    Number.isFinite(Number(snapshot.btcWeeklyGainPct)) ? `BTC 周涨幅：${formatPct(snapshot.btcWeeklyGainPct)}` : null
  ].filter(Boolean);

  const blocks = alerts.map((alert, index) => {
    const relatedSymbols = String(alert.symbol || "").split(/[+/]/).filter(Boolean);
    const positionLines = relatedSymbols.map((symbol) => positionSummary(snapshot, symbol)).filter(Boolean);
    const lines = [
      `【${index + 1}】${alertTitle(alert)}`,
      `级别：${severityLabel(alert.severity)} | 类型：${alertTypeLabel(alert.type)}`,
      `结论：${alert.conclusion || alert.message || "打开监控卡复核。"}`,
      alert.amountText ? `建议金额：${alert.amountText}` : null,
      alert.reason ? `触发原因：${alert.reason}` : null,
      alert.reset ? `重置条件：${alert.reset}` : null,
      alert.invalid ? `失效条件：${alert.invalid}` : null,
      alert.action ? `建议动作：${alert.action}` : null,
      alert.discipline ? `纪律提醒：${alert.discipline}` : "纪律提醒：这不是自动下单，执行前必须确认实时价格、现金比例和交易后仓位。",
      positionLines.length ? `相关持仓：${positionLines.join("；")}` : null
    ].filter(Boolean);
    return lines.join("\n");
  });

  const footer = [
    "执行前检查：",
    "1. 先确认这封邮件对应的是结构提醒、买点、风控，还是止盈/再平衡。",
    "2. 顺序必须是：数据有效 → 现金安全 → 回撤可控 → 冷却期通过 → 仓位合规 → 价格触发。",
    "3. 现金低于 35% 时，任何新增买入提醒都不执行；现金低于 40% 时暂停普通加仓。",
    "4. 当天已经执行过主动交易时，不再新增第二笔主动买入。",
    "5. AI抽水机仓只买 MU/DRAM/GLW/SMH 等主攻层，MRVL/ANET/AVGO 不替代核心配置。",
    "6. 5.3.3 低频执行原则：平时少动；上涨不追；急跌敢买；单笔有效；仓位达标就停。",
    "7. 如果只是因为情绪上头，默认不买，等下一次监控刷新。"
  ];

  return {
    subject,
    text: [...header, "", ...blocks, "", ...footer].join("\n")
  };
}

function aiDipDailyMaxPct(rules, snapshot) {
  const cfg = rules.aiIntradayDropOpportunityRules || rules.v5Rules?.aiIntradayDropOpportunityRules || {};
  if (snapshot.cashPct >= Number(cfg.superCashPct || 70)) return Number(cfg.maxDailyBuyPctWhenCash70 || 12);
  if (snapshot.cashPct >= Number(cfg.strongCashPct || 55)) return Number(cfg.maxDailyBuyPctWhenCash55 || 8);
  return Number(cfg.maxDailyBuyPctWhenCash45 || 5);
}

function addAiIntradayOpportunityAlerts(alerts, alertState, rules, snapshot, executionLog, signalState) {
  const cfg = rules.aiIntradayDropOpportunityRules || rules.v5Rules?.aiIntradayDropOpportunityRules || {};
  const dayKey = beijingDateKey(new Date());
  const now = new Date();

  if (cfg.enabled === false) return false;

  const primarySymbols = cfg.primarySymbols || ["MU", "DRAM", "GLW", "SMH"];
  const primaryRowsAll = primarySymbols.map((symbol) => position(snapshot, symbol)).filter(Boolean);
  const dataReliable = isExecutionSignalPriceReliable(primaryRowsAll.filter((row) => Number(row.quantity || 0) > 0 || row.symbol === "SMH" || primarySymbols.includes(row.symbol)));
  const clearMetrics = {
    cashPct: Number(snapshot.cashPct || 0),
    aiPrimaryPct: null,
    totalAssetValue: Number(snapshot.totalValue || 0),
    symbolMoves: buildSymbolMoves(primaryRowsAll)
  };

  if (!canBuy(snapshot, rules) || snapshot.cashPct < Number(cfg.minCashPct || 50)) {
    clearTodayAiDipSignals(signalState, dayKey, now, clearMetrics, dataReliable);
    return false;
  }

  const v5 = rules.v5Rules || {};
  const themeSymbols = v5.themeLayer?.symbols || cfg.primarySymbols || [];
  const aiWeight = combinedWeight(snapshot, themeSymbols);
  clearMetrics.aiPrimaryPct = Number(aiWeight || 0);

  if (aiWeight >= Number(cfg.ignoreWhenAiWeightAbovePct || 30)) {
    clearTodayAiDipSignals(signalState, dayKey, now, clearMetrics, dataReliable);
    return false;
  }

  const primaryRows = primarySymbols
    .map((symbol) => position(snapshot, symbol))
    .filter((row) => row && row.priceOk && !row.priceCachedFallback && !row.isDataBlocked);

  const primaryDropPct = Number(cfg.primaryCurrentDropPct || 5);
  const prevCloseDropPct = Number(cfg.primaryPrevCloseDropPct || 6);
  const multiDropPct = Number(cfg.multiSymbolDropPct || 4);
  const multiCount = Number(cfg.multiSymbolCount || 2);
  const smhConfirmDropPct = Number(cfg.smhConfirmDropPct || 3);

  const strongRows = primaryRows.filter((row) => aiDipDropPct(row) >= primaryDropPct || Number(row.dropPctFromPreviousClose || 0) >= prevCloseDropPct);
  const multiRows = primaryRows.filter((row) => aiDipDropPct(row) >= multiDropPct);
  const smh = position(snapshot, "SMH");
  const smhConfirms = smh && aiDipDropPct(smh) >= smhConfirmDropPct;

  let level = null;
  let triggeredRows = [];
  if (snapshot.cashPct >= Number(cfg.strongCashPct || 55) && aiWeight < Number(cfg.aiSuperTargetUnderPct || 15) && multiRows.length >= 3 && (!smh || smhConfirms)) {
    level = "S";
    triggeredRows = multiRows;
  } else if (aiWeight < Number(cfg.aiTargetUnderPct || 20) && (strongRows.length >= 1 || multiRows.length >= multiCount)) {
    level = "A";
    triggeredRows = strongRows.length ? strongRows : multiRows;
  }

  if (level && triggeredRows.length) {
    const maxDailyPct = aiDipDailyMaxPct(rules, snapshot);
    const maxDailyAmount = snapshot.totalValue > 0 ? snapshot.totalValue * maxDailyPct / 100 : 0;
    const isBasket = triggeredRows.length >= 3;
    const minAmount = level === "S"
      ? Number(cfg.basketAmountMin || 1500)
      : triggeredRows.length >= 2
        ? Number(cfg.twoSymbolAmountMin || 1000)
        : Number(cfg.singleSymbolAmountMin || 500);
    const maxAmount = level === "S"
      ? Number(cfg.basketAmountMax || 2500)
      : triggeredRows.length >= 2
        ? Number(cfg.twoSymbolAmountMax || 1500)
        : Number(cfg.singleSymbolAmountMax || 700);
    const cappedMax = Math.min(maxAmount, maxDailyAmount || maxAmount);
    const symbolText = triggeredRows.map((row) => row.symbol).join("/");
    const amountText = cappedMax > minAmount
      ? `AI主攻仓 ${Math.round(minAmount)}-${Math.round(cappedMax)} USDT`
      : `AI主攻仓 ${Math.round(Math.min(minAmount, cappedMax || minAmount))} USDT`;
    const title = level === "S" ? "AI主攻仓 S级急跌机会" : "AI主攻仓 A级急跌机会";
    const action = isBasket
      ? "优先用篮子方式买入 MU/GLW/SMH/DRAM；若使用 2x DRAM/RAM，单日不超过 500 USDT。"
      : `优先执行 ${triggeredRows[0].symbol} 有效仓位，不低于 500 USDT；若同时有 SMH 也回调，可改为半导体篮子买入。`;
    const reason = `${triggeredRows.map(formatSymbolDrop).join("；")}；现金 ${formatPct(snapshot.cashPct)}，AI主攻仓 ${formatPct(aiWeight)}。`;
    const alertPayload = {
      id: `ai-dip-${level.toLowerCase()}-${dayKey}`,
      symbol: symbolText,
      type: "ai-dip-opportunity",
      severity: level === "S" ? "high" : "medium",
      title,
      conclusion: "现金充足且AI主攻仓未达目标，主攻标的出现盘中急跌，应提示有效仓位买入机会。",
      amountText,
      reason,
      action,
      invalid: "若为财报暴雷、公司基本面恶化、数据过期或当日已执行主动交易，则不执行。",
      discipline: cfg.discipline || "急跌机会要买有效仓位，但不能突破现金、单股和AI总仓上限。"
    };

    // 执行日志独立于邮件提醒：即使 oneTradePerDay 或重复提醒限制导致邮件不发，S级升级等真实信号仍要被记录。
    const blockReason = tradeAlertBlockReason(alertState, rules, alertPayload);
    const added = addTradeAlert(alerts, alertState, rules, alertPayload);

    // suggestedAllocation 保留系统建议优先级顺序，不使用字母排序。
    const suggestedAllocation = isBasket
      ? [
          { symbol: "MU", amount: level === "S" ? 600 : 500 },
          { symbol: "GLW", amount: level === "S" ? 600 : 500 },
          { symbol: "SMH", amount: level === "S" ? 600 : 500 },
          { symbol: "DRAM", amount: level === "S" ? 400 : 300 }
        ].filter((item) => triggeredRows.some((row) => row.symbol === item.symbol) || item.symbol === "SMH")
      : [
          { symbol: triggeredRows[0].symbol, amount: Math.round(Math.min(cappedMax || minAmount, minAmount)) }
        ];

    upsertExecutionSignal({
      executionLog,
      signalState,
      tradingDate: dayKey,
      type: "ai_dip_opportunity",
      level,
      actionSide: "buy",
      symbols: triggeredRows.map((row) => row.symbol),
      triggerReason: reason,
      triggerMetrics: {
        cashPct: Number(snapshot.cashPct || 0),
        aiPrimaryPct: Number(aiWeight || 0),
        totalAssetValue: Number(snapshot.totalValue || 0),
        symbolMoves: buildSymbolMoves(triggeredRows)
      },
      suggestedAction: `买入 ${amountText}，${action}`,
      suggestedAmountMin: Math.round(minAmount),
      suggestedAmountMax: Math.round(cappedMax || maxAmount),
      suggestedCurrency: "USDT",
      suggestedAllocation,
      systemNote: added
        ? "系统自动生成：AI主攻仓急跌机会，邮件提醒已发出，等待用户手动补充执行结果。"
        : `系统自动生成：AI主攻仓急跌机会。${tradeAlertBlockReasonText(blockReason)}`
    });

    return Boolean(added);
  }

  // 没有 A/S 级触发时，尝试把上一波 active 信号清除。
  // 只有价格数据可靠时才允许清除，避免价格源失败导致“假解除、假重新触发”。
  clearTodayAiDipSignals(signalState, dayKey, now, clearMetrics, isExecutionSignalPriceReliable(primaryRowsAll));

  // 盘中已经跌深又快速拉回时，不发买入邮件，但保留复盘提醒，用于修正系统。
  const reviewRows = primaryRows.filter((row) => {
    const lowDrop = aiDayLowDropPct(row);
    const rebound = Number(row.reboundPctFromDayLow || 0);
    return lowDrop >= Number(cfg.reviewDayLowDropPct || 5) && rebound >= Number(cfg.reviewReboundFromLowPct || 4);
  });
  if (reviewRows.length && aiWeight < Number(cfg.aiTargetUnderPct || 20)) {
    addAlert(alerts, alertState, rules, {
      id: `ai-dip-review-${dayKey}`,
      symbol: reviewRows.map((row) => row.symbol).join("/"),
      type: "ai-dip-review",
      severity: "low",
      title: "AI主攻仓急跌反弹复盘",
      conclusion: "主攻标的盘中深跌后已反弹；本提醒不建议追买，只用于复盘是否错过有效仓位机会。",
      reason: `${reviewRows.map(formatSymbolDrop).join("；")}。`,
      action: "不要追已经拉回的价格；下次同类急跌时，现金高且AI仓不足，应执行1000-1500 USDT级别有效买入。",
      discipline: "复盘的目标是修正系统，不是事后追涨。"
    });
  }

  return false;
}

function evaluateRules(snapshot, rules, alertState, executionLog, signalState) {
  const alerts = [];
  updateRiskState(snapshot, rules, alertState);
  resetLevels(alertState, rules, snapshot);

  const btc = position(snapshot, "BTC");
  const eth = position(snapshot, "ETH");
  const btcFiveMinuteChangePct = Number(snapshot.btcFiveMinuteChangePct);
  const btcFiveMinuteDropPct = Number.isFinite(btcFiveMinuteChangePct) ? Math.max(0, -btcFiveMinuteChangePct) : 0;
  const rapidDropRules = rules.rapidDropRules || {};
  const rapidEnabled = rapidDropRules.enabled !== false;
  const rapidDropObserve = rapidEnabled && btcFiveMinuteDropPct >= Number(rapidDropRules.observeDropPct || Infinity);
  const rapidDropBuy = rapidEnabled && btcFiveMinuteDropPct >= Number(rapidDropRules.buyDropPct || Infinity);

  const actionablePriceErrors = Object.keys(snapshot.priceErrors || {}).filter((symbol) => {
    const row = position(snapshot, symbol);
    return !(row?.type === "watch" && Number(row.quantity || 0) <= 0);
  });
  if (actionablePriceErrors.length) {
    addAlert(alerts, alertState, rules, {
      id: "price-source-error",
      symbol: "DATA",
      type: "data-risk",
      severity: "high",
      title: "价格源异常，禁止按失败标的买入",
      conclusion: `价格源失败：${actionablePriceErrors.join("、")}`,
      reason: "部分标的没有拿到有效价格。",
      action: "失败标的不触发买入邮件，等待下一次刷新。",
      discipline: "价格源异常时宁可错过一次，也不要靠猜测下单。"
    });
  }

  if (snapshot.isDataBlocked) {
    addAlert(alerts, alertState, rules, {
      id: "snapshot-data-stale",
      symbol: "DATA",
      type: "data-risk",
      severity: "high",
      title: "数据已经过期",
      conclusion: "暂停所有买入信号。",
      reason: `数据年龄约 ${snapshot.dataAgeMinutes} 分钟，超过 ${rules.dataStaleBlockMinutes} 分钟。`,
      action: "先修复自动监控或手动刷新快照。",
      discipline: "过期数据不能指导交易。"
    });
  }

  if (snapshot.cashPct < Number(rules.cashMinPct || 35)) {
    addAlert(alerts, alertState, rules, {
      id: "cash-below-min",
      symbol: "CASH",
      type: "risk",
      severity: "high",
      title: "现金底线触发",
      conclusion: "停止所有新增买入。",
      reason: `当前现金比例 ${formatPct(snapshot.cashPct)}，低于 ${rules.cashMinPct}% 底线。`,
      action: "优先恢复现金仓。",
      discipline: "现金仓是二次进攻权，不能被情绪交易消耗。"
    });
  }

  for (const rule of rules.drawdownRules || []) {
    if (snapshot.drawdownPct >= Number(rule.drawdownPct)) {
      addAlert(alerts, alertState, rules, {
        id: rule.id,
        symbol: "PORTFOLIO",
        type: "drawdown-risk",
        severity: snapshot.drawdownPct >= 20 ? "high" : "medium",
        title: `账户回撤达到 ${rule.drawdownPct}%`,
        conclusion: rule.message,
        reason: `当前回撤 ${formatPct(snapshot.drawdownPct)}。`,
        action: rule.pauseDays ? `暂停主动买入 ${rule.pauseDays} 天。` : "降低风险资产加仓速度。",
        discipline: "回撤扩大时，先控制风险，再讨论抄底。"
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
        title: "组合相关性上限触发",
        conclusion: cap.message,
        reason: `${cap.symbols.join(" + ")} 当前合计仓位 ${formatPct(weight)}，超过 ${cap.maxPct}%。`,
        action: "停止给该组合继续加仓；若继续上涨或波动放大，考虑分批降仓。",
        discipline: "相关性高的标的不能当作真正分散。"
      });
    }
  }

  for (const [symbol, target] of Object.entries(rules.targets || {})) {
    const row = position(snapshot, symbol);
    if (!row || row.value <= 0) continue;
    if (Number.isFinite(Number(target.stopAddPct)) && row.weightPct >= Number(target.stopAddPct)) {
      addAlert(alerts, alertState, rules, {
        id: `${symbol.toLowerCase()}-stop-add`,
        symbol,
        type: "weight-risk",
        severity: "medium",
        title: `${symbol} 达到暂停加仓线`,
        conclusion: "暂停给该标的加仓。",
        reason: `${symbol} 当前仓位 ${formatPct(row.weightPct)}，达到或超过 ${target.stopAddPct}%。`,
        action: "只持有或等待再平衡，不做追买。",
        discipline: "看好不等于无限加仓。"
      });
    }
  }

  addV5StructuralAlerts(alerts, alertState, rules, snapshot);
  addTrendPriorityAlerts(alerts, alertState, rules, snapshot);
  addLowFrequencyExecutionAlerts(alerts, alertState, rules, snapshot);

  const ordinaryBuyAllowed = canBuy(snapshot, rules) && snapshot.cashPct >= Number(rules.ordinaryBuyCashMinPct || 40);
  const corePriceOk = Number.isFinite(btc?.price) && Number.isFinite(eth?.price);
  let buySignalThisRun = false;

  if (ordinaryBuyAllowed && corePriceOk) {
    if (!rapidDropObserve && !buySignalThisRun) {
      buySignalThisRun ||= addAiIntradayOpportunityAlerts(
    alerts,
    alertState,
    rules,
    snapshot,
    executionLog,
    signalState
  );
    }

    const now = new Date();
    const dca = rules.fixedDca || {};
    if (!rapidDropObserve && dca.enabled && now.getUTCDay() === Number(dca.weekdayUtc) && snapshot.cashPct >= Number(dca.requireCashPct)) {
      const halfSize = snapshot.drawdownPct >= Number(dca.halfSizeDrawdownPct || 999);
      const btcAmount = halfSize ? Number(dca.btcAmount) / 2 : Number(dca.btcAmount);
      const ethAmount = halfSize ? Number(dca.ethAmount) / 2 : Number(dca.ethAmount);
      const added = addTradeAlert(alerts, alertState, rules, {
        id: `fixed-dca-${isoWeek(now)}`,
        symbol: "BTC/ETH",
        type: "fixed-dca",
        severity: "low",
        title: "BTC/ETH 固定定投提醒",
        conclusion: "可以执行本周固定定投。",
        amountText: `BTC ${btcAmount} USDT + ETH ${ethAmount} USDT`,
        reason: "到达固定定投周期，现金比例满足要求。",
        action: halfSize ? "账户回撤较高，执行半额定投。" : "按固定定投金额执行。",
        discipline: "定投是纪律动作，但现金和回撤规则优先级更高。"
      });
      buySignalThisRun ||= added;
    }

    if (Number.isFinite(btc?.price) && rapidDropObserve) {
      const canRapidBuy =
        rapidDropBuy &&
        btc.price <= Number(rapidDropRules.buyMaxBtcPrice || Infinity) &&
        btc.price > Number(rapidDropRules.riskFloor || 0) &&
        snapshot.cashPct >= Number(rapidDropRules.requireCashPct || 45) &&
        !alreadyTriggered(alertState, rapidDropRules.buyRuleId || "rapid-btc-drop-buy");

      if (canRapidBuy) {
        const rule = { id: rapidDropRules.buyRuleId || "rapid-btc-drop-buy", resetAbove: rapidDropRules.resetAbove };
        markTriggered(alertState, rule, { triggerPrice: btc.price, resetAbove: rule.resetAbove });
        const added = addTradeAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol: "BTC/ETH",
          type: "rapid-drop-buy",
          severity: "medium",
          title: "BTC 5分钟急跌试探买入",
          conclusion: "只允许小额试探，不执行普通下跌加仓。",
          amountText: `BTC ${rapidDropRules.btcAmount} USDT + ETH ${rapidDropRules.ethAmount} USDT`,
          reason: `BTC 5分钟跌幅 ${formatPct(btcFiveMinuteDropPct)}，达到 ${rapidDropRules.buyDropPct}% 试探条件。`,
          reset: `BTC 重新站上 ${formatPrice(rapidDropRules.resetAbove)} 后才重置。`,
          invalid: `BTC 跌破 ${formatPrice(rapidDropRules.riskFloor)} 时不买，进入暂停观察。`,
          action: "确认不是流动性异常后，再考虑小额执行。",
          discipline: "急跌时先活下来，再谈低吸。"
        });
        buySignalThisRun ||= added;
      } else {
        addAlert(alerts, alertState, rules, {
          id: rapidDropRules.observeRuleId || "rapid-btc-drop-observe",
          symbol: "BTC",
          type: "rapid-drop-observe",
          severity: "high",
          title: "BTC 5分钟急跌观察",
          conclusion: "暂停普通下跌买点。",
          reason: `BTC 5分钟跌幅 ${formatPct(btcFiveMinuteDropPct)}，达到 ${rapidDropRules.observeDropPct}% 观察条件。`,
          action: `观察 ${rapidDropRules.observeHours || "4-24"} 小时，等待结构稳定。`,
          discipline: "急跌时不要把机械买点变成情绪接刀。"
        });
      }
    }

    if (!rapidDropObserve && !buySignalThisRun && Number.isFinite(btc?.price) && !btc.priceCachedFallback) {
      const riskFloor = Number(rapidDropRules.riskFloor || 52000);
      const btcRiskMode = btc.price <= riskFloor;
      const candidates = (rules.dipBuyRules || [])
        .filter((rule) => rule.enabled !== false)
        .filter((rule) => !shouldDeferCoreStableBuy(snapshot, rules, "BTC", btc))
        .filter((rule) => btc.price <= Number(rule.btcPriceBelow))
        .filter((rule) => snapshot.cashPct >= Number(rule.requireCashPct || 40))
        .filter((rule) => !alreadyTriggered(alertState, rule.id))
        .filter((rule) => btcRiskMode ? Number(rule.btcAmount || 0) <= 0 : Number(rule.btcAmount || 0) > 0)
        .sort((a, b) => Number(a.btcPriceBelow) - Number(b.btcPriceBelow));
      const rule = candidates[0];
      if (rule) {
        markTriggered(alertState, rule, { triggerPrice: btc.price, resetAbove: rule.resetAbove });
        if (Number(rule.btcAmount || 0) <= 0) {
          addAlert(alerts, alertState, rules, {
            id: rule.id,
            symbol: "BTC",
            type: "risk-pause",
            severity: "high",
            title: "BTC 极端下跌暂停",
            conclusion: "不提醒买入，先观察。",
            reason: `BTC 现价 ${formatPrice(btc.price)}，低于 ${formatPrice(rule.btcPriceBelow)}。`,
            reset: `BTC 重新站上 ${formatPrice(rule.resetAbove)} 后再评估。`,
            action: rule.note,
            discipline: "极端下跌区间先看结构，不抢反弹。"
          });
        } else {
          const added = addTradeAlert(alerts, alertState, rules, {
            id: rule.id,
            symbol: "BTC/ETH",
            type: "dip-buy",
            severity: "medium",
            title: "BTC/ETH 分批下跌加仓",
            conclusion: "触发预设下跌买点。",
            amountText: `BTC ${rule.btcAmount} USDT + ETH ${rule.ethAmount} USDT`,
            reason: `BTC 现价 ${formatPrice(btc.price)}，低于 ${formatPrice(rule.btcPriceBelow)}。`,
            reset: `BTC 重新站上 ${formatPrice(rule.resetAbove)} 后才允许同档再次触发。`,
            invalid: "现金低于 40%、价格源失败、当天已有主动交易时不执行。",
            action: "按计划分批执行，不额外加码。",
            discipline: "每个下跌档只触发一次，避免低位横盘慢性满仓。"
          });
          buySignalThisRun ||= added;
        }
      }
    }

    if (!rapidDropObserve && !buySignalThisRun && Number.isFinite(eth?.price) && !eth.priceCachedFallback) {
      const candidates = (rules.ethDipRules || [])
        .filter((rule) => rule.enabled !== false)
        .filter((rule) => eth.price <= Number(rule.priceBelow))
        .filter((rule) => !alreadyTriggered(alertState, rule.id))
        .sort((a, b) => Number(a.priceBelow) - Number(b.priceBelow));
      const rule = candidates[0];
      if (rule) {
        markTriggered(alertState, rule, { triggerPrice: eth.price, resetAbove: rule.resetAbove });
        const added = addTradeAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol: "ETH",
          type: "dip-buy",
          severity: "medium",
          title: "ETH 独立下跌买点",
          conclusion: "触发 ETH 独立买点。",
          amountText: `ETH ${rule.amount} USDT`,
          reason: `ETH 现价 ${formatPrice(eth.price)}，低于 ${formatPrice(rule.priceBelow)}。`,
          reset: `ETH 重新站上 ${formatPrice(rule.resetAbove)} 后才允许同档再次触发。`,
          invalid: "BTC 急跌观察、现金不足或当天已有主动交易时不执行。",
          action: rule.message,
          discipline: "ETH 买点不能和 BTC 急跌买点叠加。"
        });
        buySignalThisRun ||= added;
      }
    }

    if (!rapidDropObserve && !buySignalThisRun) {
      const triggeredSymbols = new Set();
      const watchRules = [...(rules.watchBuyRules || [])].filter((rule) => rule.enabled !== false).sort((a, b) => Number(a.priceBelow) - Number(b.priceBelow));
      for (const rule of watchRules) {
        if (buySignalThisRun || triggeredSymbols.has(rule.symbol)) continue;
        const row = position(snapshot, rule.symbol);
        if (!row || !row.priceOk || row.priceCachedFallback || row.isDataBlocked || row.price > Number(rule.priceBelow)) continue;
        if (shouldDeferCoreStableBuy(snapshot, rules, rule.symbol, row)) continue;
        if (snapshot.cashPct < Number(rule.requireCashPct || rules.ordinaryBuyCashMinPct || 40)) continue;
        if (alreadyTriggered(alertState, rule.id)) continue;
        const amount = Number(rule.amount || 0);
        const projectedSymbolWeight = projectedWeightPct(snapshot, rule.symbol, amount);
        if (Number.isFinite(Number(rule.maxSymbolWeightPctAfter)) && projectedSymbolWeight > Number(rule.maxSymbolWeightPctAfter)) continue;
        const capBlock = projectedCapBlock(snapshot, rules, rule.symbol, amount);
        if (capBlock) continue;

        markTriggered(alertState, rule, { triggerPrice: row.price, resetAbove: rule.resetAbove });
        const isDefensiveWatch = rule.group === "defensive" || rule.group === "gold";
        const watchTitle = isDefensiveWatch ? `${rule.symbol} 稳定仓下跌买点` : `${rule.symbol} 观察池下跌买点`;
        const watchDiscipline = isDefensiveWatch
          ? "VOO/XAUT 是稳定仓，只按预设价格分批，不追高也不一次性满仓。"
          : "AI 观察池只在规则买点触发时提醒，不因单日大涨追入。";
        const added = addTradeAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol: rule.symbol,
          type: "watch-buy",
          severity: "medium",
          title: watchTitle,
          conclusion: "触发观察池预设买点。",
          amountText: `${rule.symbol} ${amount} USDT`,
          reason: `${rule.symbol} 现价 ${formatPrice(row.price)}，低于 ${formatPrice(rule.priceBelow)}。`,
          reset: `${rule.symbol} 重新站上 ${formatPrice(rule.resetAbove)} 后才允许同档再次触发。`,
          invalid: "现金低于 40%、组合上限超标、BTC 急跌或当天已有主动交易时不执行。",
          action: rule.message,
          discipline: watchDiscipline
        });
        if (added) {
          buySignalThisRun = true;
          triggeredSymbols.add(rule.symbol);
        }
      }
    }

    if (!rapidDropObserve && !buySignalThisRun) {
      for (const rule of (rules.trendWatchRules || []).filter((rule) => rule.enabled !== false)) {
        if (buySignalThisRun) continue;
        const row = position(snapshot, rule.symbol);
        if (!row || !row.priceOk || row.priceCachedFallback || row.isDataBlocked || row.price < Number(rule.priceAbove)) continue;
        if (snapshot.cashPct < Number(rule.requireCashPct || 45)) continue;
        if (alreadyTriggered(alertState, rule.id)) continue;
        const amount = Number(rule.amount || 0);
        const projectedSymbolWeight = projectedWeightPct(snapshot, rule.symbol, amount);
        if (Number.isFinite(Number(rule.maxSymbolWeightPctAfter)) && projectedSymbolWeight > Number(rule.maxSymbolWeightPctAfter)) continue;
        const capBlock = projectedCapBlock(snapshot, rules, rule.symbol, amount);
        if (capBlock) continue;

        markTriggered(alertState, rule, { triggerPrice: row.price, resetBelow: rule.resetBelow });
        const added = addTradeAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol: rule.symbol,
          type: "trend-watch",
          severity: "low",
          title: `${rule.symbol} 上涨追随观察`,
          conclusion: "进入上涨追随区，但仍需人工确认。",
          amountText: `${rule.symbol} ${amount} USDT`,
          reason: `${rule.symbol} 现价 ${formatPrice(row.price)}，高于 ${formatPrice(rule.priceAbove)}。`,
          reset: `${rule.symbol} 回落到 ${formatPrice(rule.resetBelow)} 以下后重置。`,
          invalid: "单日暴拉、现金低于 45%、组合上限超标或当天已有主动交易时不执行。",
          action: rule.message,
          discipline: "上涨追随是确认买，不是看见突破就追高。"
        });
        buySignalThisRun ||= added;
      }
    }

    if (!rapidDropObserve && !buySignalThisRun && Number.isFinite(btc?.price) && !btc.priceCachedFallback) {
      for (const rule of (rules.trendFollowRules || []).filter((rule) => rule.enabled !== false)) {
        if (buySignalThisRun) continue;
        if (btc.price < Number(rule.btcPriceAbove)) continue;
        if (snapshot.btcWeeklyGainPct > Number(rule.maxWeeklyGainPct || 999)) {
          addAlert(alerts, alertState, rules, {
            id: `${rule.id}-pause-fast-rise`,
            symbol: rule.symbol || "BTC",
            type: "trend-pause",
            severity: "medium",
            title: "BTC 上涨过快，不追",
            conclusion: "暂停上涨追随。",
            reason: `BTC 周涨幅 ${formatPct(snapshot.btcWeeklyGainPct)}，超过 ${rule.maxWeeklyGainPct}%。`,
            action: "等待回调或横盘确认。",
            discipline: "上涨追随不是追单，先确认趋势质量。"
          });
          continue;
        }
        if (alreadyTriggered(alertState, rule.id)) continue;
        markTriggered(alertState, rule, { triggerPrice: btc.price, resetBelow: rule.resetBelow });
        const amountText = rule.btcAmount
          ? `BTC ${rule.btcAmount} USDT + ETH ${rule.ethAmount || 0} USDT`
          : `BTC ${rule.amount || 0} USDT`;
        const added = addTradeAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol: rule.symbol || "BTC",
          type: "trend-follow",
          severity: "low",
          title: "BTC 上涨追随提醒",
          conclusion: "进入上涨追随观察区，必须人工确认连续站稳。",
          amountText,
          reason: `BTC 现价 ${formatPrice(btc.price)}，高于 ${formatPrice(rule.btcPriceAbove)}。`,
          reset: `BTC 回落到 ${formatPrice(rule.resetBelow)} 以下后重置。`,
          invalid: "BTC 单周涨幅超过 15%、现金不足或当天已有主动交易时不执行。",
          action: rule.action,
          discipline: "连续 2 日站稳后再考虑，不做单日追涨。"
        });
        buySignalThisRun ||= added;
      }
    }
  }

  for (const [symbol, sellRules] of Object.entries(rules.sellRules || {})) {
    const row = position(snapshot, symbol);
    if (!row || row.value <= 0) continue;
    for (const rule of sellRules) {
      const priceHit = Number.isFinite(Number(rule.priceAbove)) && Number.isFinite(row.price) && !row.priceCachedFallback && row.price >= Number(rule.priceAbove);
      const weightHit = Number.isFinite(Number(rule.weightAbovePct)) && row.weightPct >= Number(rule.weightAbovePct);
      if (priceHit || weightHit) {
        addAlert(alerts, alertState, rules, {
          id: rule.id,
          symbol,
          type: "sell",
          severity: "medium",
          title: `${symbol} 止盈或再平衡提醒`,
          conclusion: "达到止盈或仓位上限规则。",
          amountText: `建议卖出/减仓 ${rule.sellPct || 0}%`,
          reason: `${symbol} 现价 ${formatPrice(row.price)}，仓位 ${formatPct(row.weightPct)}。`,
          action: rule.message,
          discipline: "止盈不是看空，是把过热仓位换回现金。"
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
  const baseHoldings = await readJson(files.holdings);
  const rules = await readJson(files.rules);
  const alertState = await readJson(files.alertState, {});
  const executionLog = normalizeExecutionLog(await readJson(files.executionLog, emptyExecutionLog()));
  const signalState = normalizeExecutionSignalState(await readJson(files.executionSignalState, emptyExecutionSignalState()));
  if (!baseHoldings || !rules) throw new Error("Missing config files");

  const holdings = baseHoldings;
  const previousSnapshot = await readJson(files.snapshot, null);
  const fallbackQuotes = quotesFromSnapshot(previousSnapshot);
  const bitgetSync = { enabled: false, used: false, source: "disabled-holdings-json-mode" };
  const assets = allAssets(holdings);
  const { quotes, errors, warnings } = await loadPrices(assets, fallbackQuotes, activePriceSymbols(rules));
  const snapshot = buildSnapshot(holdings, quotes, errors, rules, warnings);
  snapshot.bitgetSync = bitgetSync;
  snapshot.holdingsSource = { mode: "holdings-json-only", file: "config/holdings.json", note: "页面和邮件均以 holdings.json 为唯一仓位来源。" };
  snapshot.btcFiveMinuteChangePct = await loadBtcFiveMinuteChangePct();
  const alerts = evaluateRules(snapshot, rules, alertState, executionLog, signalState);
  snapshot.healthSummary = calculateHealthSummary(snapshot, rules);
  if (process.env.TEST_EMAIL === "true") {
    addAlert(alerts, alertState, rules, {
      id: `manual-test-email-${Date.now()}`,
      symbol: "TEST",
      type: "test-email",
      severity: "low",
      title: "邮件通道测试成功",
      conclusion: "不用交易。收到这封邮件说明 SMTP 邮件链路正常。",
      action: "正式提醒仍只在规则触发时发送。",
      discipline: "测试邮件不代表买卖建议。"
    });
  }
  const email = await sendEmail(alerts, snapshot);

  if (!noWrite) {
    await writeJson(files.snapshot, snapshot);
    await writeJson(files.alerts, { updatedAt: snapshot.updatedAt, email, alerts });
    await writeJson(files.alertState, alertState);
    await writeJson(files.executionLog, executionLog);
    await writeJson(files.executionSignalState, signalState);
  }

  console.log(JSON.stringify({
    totalValue: snapshot.totalValue,
    cashPct: snapshot.cashPct,
    drawdownPct: snapshot.drawdownPct,
    dataStatus: dataStatus(snapshot),
    btcFiveMinuteChangePct: snapshot.btcFiveMinuteChangePct,
    alerts: alerts.length,
    executionLogRecords: executionLog.records.length,
    executionSignalStateCount: Object.keys(signalState.signals || {}).length,
    email,
    priceErrors: errors,
    priceWarnings: warnings,
    bitgetSync: snapshot.bitgetSync,
    holdingsSource: snapshot.holdingsSource,
    noWrite
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
