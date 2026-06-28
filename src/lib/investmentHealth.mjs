export const DEFAULT_V4_RULES = {
  cashLayer: {
    targetMatureMin: 0.55,
    targetMatureMax: 0.60,
    phase1Target: 0.75,
    phase2Target: 0.65,
    pauseNormalBuyBelow: 0.40,
    stopNewBuyBelow: 0.35,
    defenseModeBelow: 0.30
  },
  coreGrowthLayer: {
    btcFirstTargetMin: 0.08,
    btcMatureTargetMin: 0.10,
    btcMatureTargetMax: 0.12,
    ethFirstTargetMin: 0.03,
    ethMatureTargetMin: 0.04,
    ethMatureTargetMax: 0.06,
    btcEthTotalTargetMin: 0.15,
    btcEthTotalTargetMax: 0.18,
    weeklyCoreBuyLimitPct: 0.02
  },
  stableLayer: {
    vooFirstTargetMin: 0.04,
    vooFirstTargetMax: 0.06,
    vooMatureTargetMin: 0.10,
    vooMatureTargetMax: 0.12,
    xautFirstTargetMin: 0.02,
    xautFirstTargetMax: 0.03,
    xautMatureTargetMin: 0.05,
    xautMatureTargetMax: 0.07
  },
  themeLayer: {
    targetMin: 0.05,
    targetMax: 0.10,
    hardMax: 0.15,
    maxBeforeCoreComplete: 0.05,
    symbols: ["AVGO", "MRVL", "ANET", "MU", "WDC", "DRAM", "SNDK", "TSM", "ASML", "SMH", "SOXX", "FN", "AAOI", "GLW", "ASX"]
  },
  speculativeLayer: {
    targetMax: 0.02,
    noNewBuyAbove: 0.025,
    reduceOnlyAbove: 0.03,
    hardWarningAbove: 0.04,
    symbols: ["DOGE", "BGB"]
  },
  dataFreshness: {
    maxAgeMinutes: 30,
    warnAgeMinutes: 10
  },
  drawdownRules: {
    lightRisk: 0.05,
    reduceBuySize: 0.10,
    pauseAggressiveBuy: 0.15,
    pauseActiveBuy: 0.20,
    pauseActiveBuyDays: 7
  },
  tradeCooldown: {
    enabled: true,
    sameSymbolBuyHours: 48,
    postBuyNoDipBuyHours: 24
  }
};

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return structuredCloneFallback(base);
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) result[key] = [...value];
    else if (value && typeof value === "object" && base?.[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function structuredCloneFallback(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getV4Rules(rules = {}) {
  const legacyFreshness = {
    dataFreshness: {
      warnAgeMinutes: Number(rules.dataStaleWarnMinutes ?? DEFAULT_V4_RULES.dataFreshness.warnAgeMinutes),
      maxAgeMinutes: Number(rules.dataStaleBlockMinutes ?? DEFAULT_V4_RULES.dataFreshness.maxAgeMinutes)
    }
  };
  return deepMerge(deepMerge(deepMerge(DEFAULT_V4_RULES, legacyFreshness), rules.v4Rules || {}), rules.v5Rules || {});
}

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function pct(value) {
  return safeNumber(value) * 100;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function position(snapshot, symbol) {
  return (snapshot?.positions || []).find((item) => item.symbol === symbol) || null;
}

export function weightPct(snapshot, symbol) {
  return safeNumber(position(snapshot, symbol)?.weightPct, 0);
}

export function groupWeightPct(snapshot, symbols = []) {
  return symbols.reduce((sum, symbol) => sum + weightPct(snapshot, symbol), 0);
}

export function groupValue(snapshot, symbols = []) {
  return symbols.reduce((sum, symbol) => sum + safeNumber(position(snapshot, symbol)?.value, 0), 0);
}

export function checkDataFreshness(snapshot, rules = {}) {
  const v4 = getV4Rules(rules);
  const age = safeNumber(snapshot?.dataAgeMinutes, Math.max(0, (Date.now() - Date.parse(snapshot?.updatedAt || new Date())) / 60000));
  const missingPrices = (snapshot?.positions || [])
    .filter((row) => row.type !== "cash" && row.value > 0 && row.priceOk === false)
    .map((row) => row.symbol);
  const isBlocked = Boolean(snapshot?.isDataBlocked) || age >= safeNumber(v4.dataFreshness.maxAgeMinutes, 30) || missingPrices.length > 0;
  const isStale = Boolean(snapshot?.isStale) || age >= safeNumber(v4.dataFreshness.warnAgeMinutes, 10);
  return {
    ageMinutes: age,
    isStale,
    isBlocked,
    missingPrices,
    label: isBlocked ? `数据不可交易判断（${Math.round(age)} 分钟）` : isStale ? `数据偏旧（${Math.round(age)} 分钟）` : "数据新鲜"
  };
}

export function checkTradeCooldown(snapshot, rules = {}, now = new Date()) {
  const v4 = getV4Rules(rules);
  const trades = Array.isArray(snapshot?.lastTrades) ? snapshot.lastTrades : [];
  if (!trades.length) {
    return {
      configured: false,
      status: "未配置交易记录",
      blockedSymbols: [],
      messages: ["冷却机制：未配置交易记录；页面只显示规则，不伪造最近交易。"]
    };
  }

  const blockedSymbols = [];
  const messages = [];
  const nowMs = now.getTime();
  const sameSymbolHours = safeNumber(v4.tradeCooldown.sameSymbolBuyHours, 48);
  const noDipHours = safeNumber(v4.tradeCooldown.postBuyNoDipBuyHours, 24);
  for (const trade of trades) {
    if (!trade?.symbol || String(trade.side || "").toLowerCase() !== "buy") continue;
    const tradeMs = Date.parse(trade.time || trade.createdAt || trade.date);
    if (!Number.isFinite(tradeMs)) continue;
    const hours = (nowMs - tradeMs) / 36e5;
    if (hours >= 0 && hours < sameSymbolHours) {
      blockedSymbols.push(trade.symbol);
      messages.push(`${trade.symbol} 距上次主动买入约 ${hours.toFixed(1)} 小时，同一标的 48 小时内不重复补。`);
    } else if (hours >= 0 && hours < noDipHours) {
      messages.push(`${trade.symbol} 买入后 24 小时内不因下跌继续补仓。`);
    }
  }
  return {
    configured: true,
    status: blockedSymbols.length ? "冷却中" : "开启",
    blockedSymbols: [...new Set(blockedSymbols)],
    messages: messages.length ? messages : ["冷却机制：开启；当前没有发现需要拦截的近期买入。"]
  };
}

function layerStatus({ weight, low, high, hardHigh, zeroMeansMissing = false, currentZero = false }) {
  if (zeroMeansMissing && currentZero) return { label: "不足", level: "warn" };
  if (Number.isFinite(hardHigh) && weight >= hardHigh) return { label: "高风险", level: "risk" };
  if (Number.isFinite(high) && weight > high) return { label: "偏高", level: "warn" };
  if (Number.isFinite(low) && weight < low) return { label: "不足", level: "info" };
  return { label: "健康", level: "" };
}

export function calculateAssetLayers(snapshot, rules = {}) {
  const v4 = getV4Rules(rules);
  const totalValue = safeNumber(snapshot?.totalValue, 0);
  const cashPct = safeNumber(snapshot?.cashPct, 0);
  const cashValue = safeNumber(snapshot?.cashValue, totalValue * cashPct / 100);
  const btcWeight = weightPct(snapshot, "BTC");
  const ethWeight = weightPct(snapshot, "ETH");
  const coreWeight = btcWeight + ethWeight;
  const vooWeight = weightPct(snapshot, "VOO");
  const xautWeight = weightPct(snapshot, "XAUT");
  const stableWeight = vooWeight + xautWeight;
  const themeSymbols = v4.themeLayer.symbols || [];
  const specSymbols = v4.speculativeLayer.symbols || [];
  const themeWeight = groupWeightPct(snapshot, themeSymbols);
  const specWeight = groupWeightPct(snapshot, specSymbols);
  const corePlusStableWeight = coreWeight + stableWeight;

  const cashStatus = cashPct < pct(v4.cashLayer.defenseModeBelow)
    ? { label: "高风险", level: "risk" }
    : cashPct < pct(v4.cashLayer.stopNewBuyBelow)
      ? { label: "停止新增", level: "risk" }
      : cashPct < pct(v4.cashLayer.pauseNormalBuyBelow)
        ? { label: "防守不足", level: "warn" }
        : cashPct > 80
          ? { label: "偏保守", level: "info" }
          : cashPct >= pct(v4.cashLayer.targetMatureMin) && cashPct <= 75
            ? { label: "健康", level: "" }
            : { label: "正常", level: "" };

  const coreStatus = layerStatus({
    weight: coreWeight,
    low: pct(v4.coreGrowthLayer.btcEthTotalTargetMin),
    high: pct(v4.coreGrowthLayer.btcEthTotalTargetMax),
    hardHigh: 40
  });
  if (btcWeight < pct(v4.coreGrowthLayer.btcFirstTargetMin) || ethWeight < pct(v4.coreGrowthLayer.ethFirstTargetMin)) {
    coreStatus.label = "核心不足";
    coreStatus.level = "warn";
  }

  const stableStatus = layerStatus({
    weight: stableWeight,
    low: pct(v4.stableLayer.vooFirstTargetMin + v4.stableLayer.xautFirstTargetMin),
    high: pct(v4.stableLayer.vooMatureTargetMax + v4.stableLayer.xautMatureTargetMax),
    hardHigh: 30,
    zeroMeansMissing: true,
    currentZero: vooWeight === 0 || xautWeight === 0
  });

  let themeStatus = layerStatus({
    weight: themeWeight,
    low: 0,
    high: pct(v4.themeLayer.targetMax),
    hardHigh: pct(v4.themeLayer.hardMax)
  });
  if (corePlusStableWeight < 25 && themeWeight > pct(v4.themeLayer.maxBeforeCoreComplete)) {
    themeStatus = { label: "核心未稳，主题偏高", level: "warn" };
  }
  if (themeWeight === 0) themeStatus = { label: "未建仓", level: "info" };

  const specStatus = specWeight >= pct(v4.speculativeLayer.hardWarningAbove)
    ? { label: "高风险", level: "risk" }
    : specWeight >= pct(v4.speculativeLayer.reduceOnlyAbove)
      ? { label: "只减不补", level: "risk" }
      : specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)
        ? { label: "禁止新增", level: "warn" }
        : specWeight > pct(v4.speculativeLayer.targetMax)
          ? { label: "轻度偏高", level: "warn" }
          : { label: "健康", level: "" };

  return [
    {
      id: "cash",
      name: "安全现金层",
      symbols: ["USDT", "USDGO"],
      value: cashValue,
      weightPct: cashPct,
      targetText: "成熟目标 55%-60%，阶段目标 75% / 65%",
      status: cashStatus,
      advice: cashPct > 80 ? "账户安全但资金效率偏低，可分批补核心仓和稳定层。" : cashPct < 40 ? "现金防守不足，暂停普通加仓。" : "现金处于可执行区间，继续按规则分批。"
    },
    {
      id: "core",
      name: "核心增长层",
      symbols: ["BTC", "ETH"],
      value: groupValue(snapshot, ["BTC", "ETH"]),
      weightPct: coreWeight,
      targetText: "BTC 10%-12%，ETH 4%-6%，合计 15%-18%",
      status: coreStatus,
      advice: btcWeight < 8 || ethWeight < 3 ? "BTC/ETH 未达到第一阶段核心仓，现金充足时优先小额补。" : "核心仓已具备基础，后续只慢慢补到成熟目标。"
    },
    {
      id: "stable",
      name: "长期稳定层",
      symbols: ["VOO", "XAUT"],
      value: groupValue(snapshot, ["VOO", "XAUT"]),
      weightPct: stableWeight,
      targetText: "VOO 10%-12%，XAUT 5%-7%；第一阶段先建底仓",
      status: stableStatus,
      advice: vooWeight === 0 || xautWeight === 0 ? "VOO/XAUT 长期稳定资产缺位，建议分批建立底仓。" : "稳定层已建立，后续按月再平衡。"
    },
    {
      id: "theme",
      name: "AI观察仓",
      symbols: themeSymbols,
      value: groupValue(snapshot, themeSymbols),
      weightPct: themeWeight,
      targetText: "目标 5%-10%，硬上限 15%；核心未稳前不超过 5%",
      status: themeStatus,
      advice: corePlusStableWeight < 25 ? "核心仓和稳定层未完成前，AI/半导体/存储/光通信不要抢跑。" : "主题仓可作为收益增强，但不能超过硬上限。"
    },
    {
      id: "speculative",
      name: "投机清理层",
      symbols: specSymbols,
      value: groupValue(snapshot, specSymbols),
      weightPct: specWeight,
      targetText: "目标 0%-2%，2.5% 禁止新增，3% 只减不补",
      status: specStatus,
      advice: specWeight >= pct(v4.speculativeLayer.noNewBuyAbove) ? "DOGE/BGB 禁止新增，后续以反弹减仓为主。" : "投机仓保持小仓位，不做摊低成本。"
    }
  ];
}

export function calculateHealthScore(snapshot, rules = {}) {
  const v4 = getV4Rules(rules);
  const freshness = checkDataFreshness(snapshot, rules);
  const layers = calculateAssetLayers(snapshot, rules);
  const cashPct = safeNumber(snapshot?.cashPct, 0);
  const drawdownPct = safeNumber(snapshot?.drawdownPct, 0);
  const btcWeight = weightPct(snapshot, "BTC");
  const ethWeight = weightPct(snapshot, "ETH");
  const vooWeight = weightPct(snapshot, "VOO");
  const xautWeight = weightPct(snapshot, "XAUT");
  const specWeight = groupWeightPct(snapshot, v4.speculativeLayer.symbols);
  const themeWeight = groupWeightPct(snapshot, v4.themeLayer.symbols);

  const components = {
    cashSafety: { label: "现金安全", max: 20, score: 20, reasons: [] },
    coreCompleteness: { label: "核心仓完整度", max: 25, score: 25, reasons: [] },
    speculativeControl: { label: "投机仓控制", max: 15, score: 15, reasons: [] },
    themeControl: { label: "主题仓控制", max: 15, score: 15, reasons: [] },
    dataDiscipline: { label: "数据与纪律", max: 15, score: 15, reasons: [] },
    drawdownState: { label: "回撤状态", max: 10, score: 10, reasons: [] }
  };

  if (cashPct > 80) {
    components.cashSafety.score -= 4;
    components.cashSafety.reasons.push("现金超过 80%，账户安全但收益效率偏低。");
  }
  if (cashPct < 40) {
    components.cashSafety.score -= 8;
    components.cashSafety.reasons.push("现金低于 40%，应暂停普通加仓。");
  }
  if (cashPct < 35) {
    components.cashSafety.score -= 4;
    components.cashSafety.reasons.push("现金低于 35%，停止新增买入。");
  }

  if (btcWeight < pct(v4.coreGrowthLayer.btcFirstTargetMin)) {
    components.coreCompleteness.score -= 5;
    components.coreCompleteness.reasons.push("BTC 低于第一阶段 8% 目标。");
  }
  if (ethWeight < pct(v4.coreGrowthLayer.ethFirstTargetMin)) {
    components.coreCompleteness.score -= 5;
    components.coreCompleteness.reasons.push("ETH 低于第一阶段 3% 目标。");
  }
  if (vooWeight <= 0) {
    components.coreCompleteness.score -= 6;
    components.coreCompleteness.reasons.push("VOO 为 0，长期稳定资产缺位。");
  }
  if (xautWeight <= 0) {
    components.coreCompleteness.score -= 6;
    components.coreCompleteness.reasons.push("XAUT 为 0，黄金稳定层缺位。");
  }

  if (specWeight > pct(v4.speculativeLayer.targetMax)) {
    components.speculativeControl.score -= 3;
    components.speculativeControl.reasons.push("DOGE + BGB 超过 2%，投机仓轻度偏高。");
  }
  if (specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)) {
    components.speculativeControl.score -= 3;
    components.speculativeControl.reasons.push("DOGE + BGB 达到 2.5%，禁止新增投机仓。");
  }
  if (specWeight >= pct(v4.speculativeLayer.reduceOnlyAbove)) {
    components.speculativeControl.score -= 4;
    components.speculativeControl.reasons.push("DOGE + BGB 达到 3%，只允许反弹减仓。");
  }
  if (specWeight >= pct(v4.speculativeLayer.hardWarningAbove)) {
    components.speculativeControl.score -= 5;
    components.speculativeControl.reasons.push("DOGE + BGB 超过 4%，进入高风险警戒。");
  }

  if (themeWeight > pct(v4.themeLayer.targetMax)) {
    components.themeControl.score -= 5;
    components.themeControl.reasons.push("AI观察仓超过 10%，谨慎加仓。");
  }
  if (themeWeight > pct(v4.themeLayer.hardMax)) {
    components.themeControl.score -= 8;
    components.themeControl.reasons.push("AI观察仓超过 15%，停止新增主题仓。");
  }

  if (freshness.isStale) {
    components.dataDiscipline.score -= freshness.isBlocked ? 10 : 4;
    components.dataDiscipline.reasons.push(freshness.isBlocked ? "数据过期或价格缺失，禁止交易判断。" : "数据偏旧，只能观察。");
  }
  if (freshness.missingPrices.length) {
    components.dataDiscipline.score -= 3;
    components.dataDiscipline.reasons.push(`价格源缺失：${freshness.missingPrices.join("、")}。`);
  }

  if (drawdownPct >= pct(v4.drawdownRules.pauseActiveBuy)) {
    components.drawdownState.score -= 10;
    components.drawdownState.reasons.push("账户回撤超过 20%，暂停主动买入 7 天。");
  } else if (drawdownPct >= pct(v4.drawdownRules.pauseAggressiveBuy)) {
    components.drawdownState.score -= 7;
    components.drawdownState.reasons.push("账户回撤超过 15%，暂停进攻仓买入。");
  } else if (drawdownPct >= pct(v4.drawdownRules.reduceBuySize)) {
    components.drawdownState.score -= 4;
    components.drawdownState.reasons.push("账户回撤超过 10%，降低买入额度。");
  } else if (drawdownPct >= pct(v4.drawdownRules.lightRisk)) {
    components.drawdownState.score -= 2;
    components.drawdownState.reasons.push("账户回撤超过 5%，进入轻度风险。 ");
  }

  for (const component of Object.values(components)) {
    component.score = clamp(Math.round(component.score), 0, component.max);
  }

  const total = Object.values(components).reduce((sum, item) => sum + item.score, 0);
  const reasons = Object.values(components).flatMap((item) => item.reasons.map((reason) => `${item.label}：${reason}`));
  const topAdvice = generateTopAdvice(snapshot, rules, layers, freshness).slice(0, 3);
  let grade = total >= 88 ? "优秀" : total >= 75 ? "健康" : total >= 65 ? "偏保守" : total >= 50 ? "偏激进" : "高风险";
  if (cashPct > 80 && total >= 65) grade = "偏保守";
  if (specWeight >= pct(v4.speculativeLayer.reduceOnlyAbove) || themeWeight > pct(v4.themeLayer.hardMax) || cashPct < 40) grade = total < 60 ? "高风险" : "偏激进";

  return {
    total,
    grade,
    components: Object.values(components),
    reasons,
    topAdvice,
    layers
  };
}

function generateTopAdvice(snapshot, rules, layers, freshness) {
  const v4 = getV4Rules(rules);
  const advice = [];
  const cashPct = safeNumber(snapshot?.cashPct, 0);
  const btcWeight = weightPct(snapshot, "BTC");
  const ethWeight = weightPct(snapshot, "ETH");
  const vooWeight = weightPct(snapshot, "VOO");
  const xautWeight = weightPct(snapshot, "XAUT");
  const specWeight = groupWeightPct(snapshot, v4.speculativeLayer.symbols);
  if (freshness.isBlocked) advice.push("先等待数据刷新，不根据过期数据买入。");
  if (cashPct > 80) advice.push("现金过高，优先用小额分批方式补核心仓和稳定层。 ");
  if (btcWeight < 8 || ethWeight < 3) advice.push("BTC/ETH 未达到第一阶段核心仓，现金充足时优先补。 ");
  if (vooWeight === 0 || xautWeight === 0) advice.push("VOO/XAUT 为 0，建议分批建立长期稳定底仓。 ");
  if (specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)) advice.push("DOGE/BGB 投机仓偏高，禁止新增，以反弹减仓为主。 ");
  if (!advice.length) advice.push("结构基本健康，继续按月复盘和再平衡。 ");
  return [...new Set(advice.map((item) => item.trim()))];
}

export function generateSystemJudgement(snapshot, rules = {}) {
  const v4 = getV4Rules(rules);
  const freshness = checkDataFreshness(snapshot, rules);
  const cashPct = safeNumber(snapshot?.cashPct, 0);
  const btcWeight = weightPct(snapshot, "BTC");
  const ethWeight = weightPct(snapshot, "ETH");
  const vooWeight = weightPct(snapshot, "VOO");
  const xautWeight = weightPct(snapshot, "XAUT");
  const specWeight = groupWeightPct(snapshot, v4.speculativeLayer.symbols);
  const themeWeight = groupWeightPct(snapshot, v4.themeLayer.symbols);
  const messages = [];
  if (freshness.isBlocked) messages.push("当前数据已过期或关键价格缺失，只能做结构分析，不能做买入判断。");
  if (cashPct > 80) messages.push("当前账户非常安全，但现金占比过高，长期资金效率偏低。建议优先补 BTC/ETH 核心仓，并建立 VOO/XAUT 底仓。");
  if (btcWeight < 8 || ethWeight < 3) messages.push("核心增长层不足，BTC/ETH 应优先补到第一阶段目标，再考虑扩大主题仓。 ");
  if (vooWeight === 0 || xautWeight === 0) messages.push("长期稳定层缺位，建议分批建立 VOO 与 XAUT 底仓。 ");
  if (specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)) messages.push("投机仓已偏高，不建议继续补 DOGE/BGB，后续应以反弹减仓为主。 ");
  if (themeWeight > pct(v4.themeLayer.targetMax)) messages.push("主题仓偏高，AI/半导体/存储/光通信不应继续主动加仓。 ");
  if (!messages.length) messages.push("当前系统结构健康，可以继续按既定买点、现金底线和每月再平衡执行。 ");
  return messages.map((item) => item.trim());
}

export function generateAllowedActions(snapshot, rules = {}) {
  const v4 = getV4Rules(rules);
  const freshness = checkDataFreshness(snapshot, rules);
  const cashPct = safeNumber(snapshot?.cashPct, 0);
  const actions = [];
  if (freshness.isBlocked) return ["等待数据刷新；当前只允许结构复盘，不允许按信号买入。"];
  if (cashPct < pct(v4.cashLayer.stopNewBuyBelow)) return ["只允许观察、复盘和减仓，不允许新增买入。"];
  if (cashPct < pct(v4.cashLayer.pauseNormalBuyBelow)) return ["暂停普通加仓，只允许极小额核心定投或防守复盘。"];

  const btcWeight = weightPct(snapshot, "BTC");
  const ethWeight = weightPct(snapshot, "ETH");
  const vooWeight = weightPct(snapshot, "VOO");
  const xautWeight = weightPct(snapshot, "XAUT");
  const themeWeight = groupWeightPct(snapshot, v4.themeLayer.symbols);
  const corePlusStable = btcWeight + ethWeight + vooWeight + xautWeight;

  if (cashPct >= 75 && (btcWeight < 8 || ethWeight < 3)) actions.push("允许小额补 BTC/ETH 核心仓，每周合计不超过账户 2%。");
  if (cashPct >= 75 && vooWeight === 0) actions.push("允许分批建立 VOO 底仓，不必等待完美低点。 ");
  if (cashPct >= 75 && xautWeight === 0) actions.push("允许分批建立 XAUT 底仓，用作稳定层。 ");
  if (corePlusStable >= 25 && themeWeight < pct(v4.themeLayer.targetMax)) actions.push("AI观察仓可小额观察，但必须低于 10% 并服从买点；MRVL 只能小仓试错。 ");
  actions.push("允许做月度复盘、更新持仓成本和检查价格源。 ");
  return [...new Set(actions.map((item) => item.trim()))];
}

export function generateForbiddenActions(snapshot, rules = {}) {
  const v4 = getV4Rules(rules);
  const freshness = checkDataFreshness(snapshot, rules);
  const cooldown = checkTradeCooldown(snapshot, rules);
  const forbidden = [];
  const cashPct = safeNumber(snapshot?.cashPct, 0);
  const specWeight = groupWeightPct(snapshot, v4.speculativeLayer.symbols);
  const themeWeight = groupWeightPct(snapshot, v4.themeLayer.symbols);
  const btcWeight = weightPct(snapshot, "BTC");
  const ethWeight = weightPct(snapshot, "ETH");
  const vooWeight = weightPct(snapshot, "VOO");
  const xautWeight = weightPct(snapshot, "XAUT");
  const corePlusStable = btcWeight + ethWeight + vooWeight + xautWeight;

  if (freshness.isBlocked) forbidden.push("不要在数据过期或价格源失败时买入。 ");
  if (cashPct < pct(v4.cashLayer.pauseNormalBuyBelow)) forbidden.push("不要在现金低于 40% 时普通加仓。 ");
  if (cashPct > 80) forbidden.push("不要因为现金多就一次性打光现金。 ");
  if (specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)) {
    forbidden.push("不要补 DOGE。 ");
    forbidden.push("不要补 BGB。 ");
  }
  if (specWeight >= pct(v4.speculativeLayer.reduceOnlyAbove)) forbidden.push("DOGE/BGB 已进入只减不补区，不要摊低成本。 ");
  if ((btcWeight < 8 || ethWeight < 3 || vooWeight === 0 || xautWeight === 0) && themeWeight >= pct(v4.themeLayer.maxBeforeCoreComplete)) {
    forbidden.push("不要在核心仓不足时优先加主题股。 ");
  }
  if (themeWeight >= pct(v4.themeLayer.hardMax)) forbidden.push("不要继续新增 AI/半导体/存储/光通信主题仓。 ");
  forbidden.push("不要因为刚买就跌而立刻补同一个标的。 ");
  if (cooldown.blockedSymbols.length) forbidden.push(`冷却中标的不要补仓：${cooldown.blockedSymbols.join("、")}。`);
  return [...new Set(forbidden.map((item) => item.trim()))];
}

export function generatePhasePlan(snapshot, rules = {}) {
  const total = safeNumber(snapshot?.totalValue, 0);
  const cashPct = safeNumber(snapshot?.cashPct, 0);
  const toTargetAmount = (targetPct) => Math.max(0, total * (cashPct / 100 - targetPct));
  return [
    {
      name: "第一阶段：现金降到 75%",
      deployAmount: toTargetAmount(0.75),
      target: "先修复结构，不追求一次买满。",
      steps: ["BTC 补到 8% 以上", "ETH 补到 3% 以上", "VOO 建立 4%-6% 底仓", "XAUT 建立 2%-3% 底仓", "DOGE/BGB 不新增"]
    },
    {
      name: "第二阶段：现金降到 65%",
      deployAmount: toTargetAmount(0.65),
      target: "提高长期资产比例，同时保留防守现金。",
      steps: ["VOO 增加到 8% 左右", "XAUT 增加到 4% 左右", "BTC/ETH 慢慢补", "主题仓可小幅增加但不超过 8%-10%"]
    },
    {
      name: "第三阶段：现金稳定 55%-60%",
      deployAmount: toTargetAmount(0.60),
      target: "形成成熟配置并进入再平衡模式。",
      steps: ["形成长期目标配置", "每月复盘一次", "超过上限的资产做再平衡", "投机仓只减不补"]
    }
  ];
}

export function generateRebalanceAlerts(snapshot, rules = {}) {
  const v4 = getV4Rules(rules);
  const alerts = [];
  const cashPct = safeNumber(snapshot?.cashPct, 0);
  const checks = [
    ["BTC", 18, "BTC 超过 18%，停止加仓。"],
    ["BTC", 25, "BTC 超过 25%，建议卖出 10% 回现金。"],
    ["ETH", 10, "ETH 超过 10%，停止加仓。"],
    ["ETH", 12, "ETH 超过 12%，建议卖出 10% 回现金。"],
    ["VOO", 30, "VOO 超过 30%，提示再平衡。"],
    ["XAUT", 12, "XAUT 超过 12%，提示再平衡。"]
  ];
  for (const [symbol, limit, message] of checks) {
    if (weightPct(snapshot, symbol) > limit) alerts.push(message);
  }
  if (groupWeightPct(snapshot, v4.themeLayer.symbols) > pct(v4.themeLayer.hardMax)) alerts.push("AI/半导体/存储/光通信超过 15%，停止新增。 ");
  if (groupWeightPct(snapshot, v4.speculativeLayer.symbols) > pct(v4.speculativeLayer.reduceOnlyAbove)) alerts.push("DOGE + BGB 超过 3%，反弹减仓。 ");
  if (cashPct > 80) alerts.push("现金超过 80%，资金效率偏低。 ");
  if (cashPct < 40) alerts.push("现金低于 40%，防守不足。 ");
  return [...new Set(alerts.map((item) => item.trim()))];
}

export function calculateHealthSummary(snapshot, rules = {}) {
  return {
    score: calculateHealthScore(snapshot, rules),
    layers: calculateAssetLayers(snapshot, rules),
    judgement: generateSystemJudgement(snapshot, rules),
    allowedActions: generateAllowedActions(snapshot, rules),
    forbiddenActions: generateForbiddenActions(snapshot, rules),
    phasePlan: generatePhasePlan(snapshot, rules),
    freshness: checkDataFreshness(snapshot, rules),
    cooldown: checkTradeCooldown(snapshot, rules),
    rebalanceAlerts: generateRebalanceAlerts(snapshot, rules)
  };
}
