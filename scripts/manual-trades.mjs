const DEFAULT_CASH_SYMBOL = "USDT";

const DEFAULT_TYPES = {
  BTC: "crypto",
  ETH: "crypto",
  DOGE: "crypto",
  BGB: "crypto",
  XAUT: "watch",
  VOO: "watch",
  AVGO: "watch",
  MRVL: "watch",
  ANET: "watch",
  TSM: "watch",
  ASML: "watch",
  SMH: "watch",
  SOXX: "watch",
  FN: "watch",
  MU: "watch",
  SNDK: "watch",
  DRAM: "watch",
  WDC: "watch",
  ASX: "watch",
  AAOI: "watch",
  GLW: "watch"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function allAssets(holdings) {
  return [...(holdings.cash || []), ...(holdings.positions || [])];
}

function normalizeAction(value) {
  const action = String(value || "").trim().toLowerCase();
  if (["buy", "b", "买", "买入"].includes(action)) return "buy";
  if (["sell", "s", "卖", "卖出"].includes(action)) return "sell";
  return action;
}

export function normalizeManualTrade(raw) {
  const action = normalizeAction(raw?.action || raw?.side || raw?.type);
  const symbol = String(raw?.symbol || "").trim().toUpperCase();
  const quantity = Number(raw?.quantity ?? raw?.qty ?? raw?.amount ?? 0);
  const price = Number(raw?.price ?? raw?.fillPrice ?? 0);
  const fee = Math.max(0, Number(raw?.fee ?? 0));
  const cashSymbol = String(raw?.cashSymbol || DEFAULT_CASH_SYMBOL).trim().toUpperCase();
  const tradedAt = raw?.tradedAt || raw?.time || raw?.date || new Date().toISOString();
  const note = String(raw?.note || "").trim();
  const id = String(raw?.id || `${tradedAt}-${action}-${symbol}-${quantity}-${price}-${fee}`).replace(/\s+/g, "-");

  if (!["buy", "sell"].includes(action)) throw new Error("action must be buy or sell");
  if (!symbol) throw new Error("symbol is required");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("quantity must be greater than 0");
  if (!Number.isFinite(price) || price <= 0) throw new Error("price must be greater than 0");
  if (!cashSymbol) throw new Error("cashSymbol is required");

  return { id, action, symbol, quantity, price, fee, cashSymbol, tradedAt, note };
}

function ensureCash(holdings, cashSymbol) {
  holdings.cash ||= [];
  let cash = holdings.cash.find((item) => item.symbol === cashSymbol);
  if (!cash) {
    cash = { symbol: cashSymbol, quantity: 0, cost: 1, type: "cash" };
    holdings.cash.push(cash);
  }
  cash.quantity = Number(cash.quantity || 0);
  cash.cost = Number(cash.cost || 1) || 1;
  cash.type = "cash";
  return cash;
}

function ensurePosition(holdings, symbol) {
  holdings.positions ||= [];
  let asset = holdings.positions.find((item) => item.symbol === symbol);
  if (!asset) {
    asset = { symbol, quantity: 0, cost: 0, type: DEFAULT_TYPES[symbol] || "watch" };
    holdings.positions.push(asset);
  }
  asset.quantity = Number(asset.quantity || 0);
  asset.cost = Number(asset.cost || 0);
  asset.type ||= DEFAULT_TYPES[symbol] || "watch";
  return asset;
}

export function applyManualTrade(holdings, rawTrade) {
  const trade = normalizeManualTrade(rawTrade);
  const next = clone(holdings);
  next.baseCurrency ||= DEFAULT_CASH_SYMBOL;
  const cash = ensureCash(next, trade.cashSymbol);
  const asset = ensurePosition(next, trade.symbol);
  const gross = trade.quantity * trade.price;
  const cashUnitPrice = Number(cash.cost || 1) || 1;

  if (trade.action === "buy") {
    const newQuantity = asset.quantity + trade.quantity;
    const oldCostValue = asset.quantity * asset.cost;
    asset.cost = newQuantity > 0 ? (oldCostValue + gross + trade.fee) / newQuantity : 0;
    asset.quantity = newQuantity;
    cash.quantity -= (gross + trade.fee) / cashUnitPrice;
  } else {
    if (asset.quantity + 1e-12 < trade.quantity) {
      throw new Error(`${trade.symbol} sell quantity exceeds current quantity`);
    }
    asset.quantity = Math.max(0, asset.quantity - trade.quantity);
    if (asset.quantity === 0) asset.cost = 0;
    cash.quantity += Math.max(0, gross - trade.fee) / cashUnitPrice;
  }

  return { holdings: next, trade };
}

export function applyManualTrades(baseHoldings, manualTradesData) {
  const trades = Array.isArray(manualTradesData?.trades)
    ? manualTradesData.trades
    : Array.isArray(manualTradesData)
      ? manualTradesData
      : [];
  const ordered = trades
    .map((trade, index) => ({ trade, index }))
    .sort((a, b) => String(a.trade.tradedAt || "").localeCompare(String(b.trade.tradedAt || "")) || a.index - b.index);

  let holdings = clone(baseHoldings);
  const applied = [];
  const skipped = [];
  const seen = new Set();

  for (const item of ordered) {
    try {
      const normalized = normalizeManualTrade(item.trade);
      if (seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      const result = applyManualTrade(holdings, normalized);
      holdings = result.holdings;
      applied.push(result.trade);
    } catch (error) {
      skipped.push({ trade: item.trade, reason: error.message });
    }
  }

  return { holdings, meta: { enabled: trades.length > 0, appliedCount: applied.length, skippedCount: skipped.length, applied, skipped } };
}
