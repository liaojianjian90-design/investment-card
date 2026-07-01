export const DEFAULT_V4_RULES = {
  cashLayer: {
    targetMatureMin: 0.35,
    targetMatureMax: 0.45,
    phase1Target: 0.65,
    phase2Target: 0.50,
    pauseNormalBuyBelow: 0.35,
    stopNewBuyBelow: 0.30,
    defenseModeBelow: 0.28
  },
  coreGrowthLayer: {
    btcFirstTargetMin: 0.05,
    btcMatureTargetMin: 0.05,
    btcMatureTargetMax: 0.08,
    ethFirstTargetMin: 0.03,
    ethMatureTargetMin: 0.03,
    ethMatureTargetMax: 0.05,
    btcEthTotalTargetMin: 0.08,
    btcEthTotalTargetMax: 0.13,
    weeklyCoreBuyLimitPct: 0.03
  },
  stableLayer: {
    vooFirstTargetMin: 0.03,
    vooFirstTargetMax: 0.05,
    vooMatureTargetMin: 0.05,
    vooMatureTargetMax: 0.07,
    xautFirstTargetMin: 0.02,
    xautFirstTargetMax: 0.03,
    xautMatureTargetMin: 0.03,
    xautMatureTargetMax: 0.04
  },
  themeLayer: {
    targetMin: 0.25,
    targetMax: 0.35,
    hardMax: 0.40,
    maxBeforeCoreComplete: 0.30,
    symbols: ["AVGO", "MRVL", "ANET", "MU", "WDC", "DRAM", "SNDK", "TSM", "ASML", "SMH", "SOXX", "FN", "AAOI", "GLW", "ASX"]
  },
  speculativeLayer: {
    targetMax: 0.045,
    noNewBuyAbove: 0.045,
    reduceOnlyAbove: 0.05,
    hardWarningAbove: 0.06,
    symbols: ["DOGE", "BGB", "CRCL"],
    dogeTargetMax: 0.04,
    dogeHardMax: 0.055,
    bgbTargetMax: 0.01,
    bgbHardMax: 0.015,
    crclTargetMax: 0.035,
    crclStopAdd: 0.04,
    crclHardMax: 0.05
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

function coreLayerDetails({ btcWeight, ethWeight, rules }) {
  const total = btcWeight + ethWeight;
  const totalMin = pct(rules.coreGrowthLayer.btcEthTotalTargetMin);
  const totalMax = pct(rules.coreGrowthLayer.btcEthTotalTargetMax);
  const btcMin = pct(rules.coreGrowthLayer.btcFirstTargetMin);
  const ethMin = pct(rules.coreGrowthLayer.ethFirstTargetMin);
  const missing = [];
  if (btcWeight < btcMin) missing.push("BTC");
  if (ethWeight < ethMin) missing.push("ETH");

  if (total < totalMin) {
    return {
      total,
      missing,
      isTotalEnough: false,
      isSkewed: false,
      status: { label: "核心不足", level: "info" },
      advice: `BTC/ETH 合计低于 ${formatLayerPct(totalMin)} 底仓线；但当前 AI 主升优先，不因为核心不足机械补仓。`
    };
  }
  if (total > totalMax) {
    return {
      total,
      missing,
      isTotalEnough: true,
      isSkewed: false,
      status: { label: "偏高", level: "warn" },
      advice: "BTC/ETH 合计已经偏高，后续不要继续挤占 AI 主攻仓弹药。"
    };
  }
  if (missing.length) {
    return {
      total,
      missing,
      isTotalEnough: true,
      isSkewed: true,
      status: { label: "核心偏科", level: "info" },
      advice: `BTC/ETH 合计已达标，但 ${missing.join("/")} 低于单项底仓线；这只是结构提示，不影响 AI 主攻仓优先级。`
    };
  }
  return {
    total,
    missing,
    isTotalEnough: true,
    isSkewed: false,
    status: { label: "健康", level: "" },
    advice: "加密底仓总量和结构都已具备基础，后续只在深跌或趋势确认后补。"
  };
}

function stableLayerDetails({ vooWeight, xautWeight, rules }) {
  const total = vooWeight + xautWeight;
  const totalMin = pct(rules.stableLayer.vooFirstTargetMin + rules.stableLayer.xautFirstTargetMin);
  const totalMax = pct(rules.stableLayer.vooMatureTargetMax + rules.stableLayer.xautMatureTargetMax);
  const missing = [];
  if (vooWeight <= 0) missing.push("VOO");
  if (xautWeight <= 0) missing.push("XAUT");

  if (total < totalMin) {
    return {
      total,
      missing,
      status: { label: "稳定不足", level: "info" },
      advice: "稳定层只做保险底仓；新增资金仍优先 AI，VOO/XAUT 只在深跌价位补。"
    };
  }
  if (total > totalMax) {
    return {
      total,
      missing,
      status: { label: "偏高", level: "warn" },
      advice: "稳定层已经偏高，暂停快速加仓，避免降低 AI 主升方向收益效率。"
    };
  }
  if (missing.length) {
    return {
      total,
      missing,
      status: { label: "稳定偏科", level: "info" },
      advice: `${missing.join("/")} 缺位只是保险层结构提示；不因此抢 AI 主攻资金。`
    };
  }
  return {
    total,
    missing,
    status: { label: "健康", level: "" },
    advice: "稳定层已建立，当前不继续抢 AI 主攻资金。"
  };
}

function formatLayerPct(value) {
  return `${Number(value).toFixed(1).replace(/\.0$/, "")}%`;
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
        : cashPct > 70
          ? { label: "偏保守", level: "info" }
          : cashPct >= pct(v4.cashLayer.targetMatureMin) && cashPct <= 75
            ? { label: "健康", level: "" }
            : { label: "正常", level: "" };

  const coreDetails = coreLayerDetails({ btcWeight, ethWeight, rules: v4 });
  const coreStatus = coreDetails.status;

  const stableDetails = stableLayerDetails({ vooWeight, xautWeight, rules: v4 });
  const stableStatus = stableDetails.status;

  let themeStatus = layerStatus({
    weight: themeWeight,
    low: pct(v4.themeLayer.targetMin),
    high: pct(v4.themeLayer.targetMax),
    hardHigh: pct(v4.themeLayer.hardMax)
  });
  if (themeWeight > 0 && themeWeight < pct(v4.themeLayer.targetMin)) themeStatus = { label: "待推进", level: "info" };
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
      targetText: "成熟目标 35%-45%，阶段目标 65% / 50%",
      status: cashStatus,
      advice: cashPct > 65 ? "现金安全但资金效率偏低，新增资金优先给 AI 主攻仓。" : cashPct < 35 ? "现金防守不足，暂停普通加仓。" : "现金处于可执行区间，继续按 AI 优先规则分批。"
    },
    {
      id: "core",
      name: "核心增长层",
      symbols: ["BTC", "ETH"],
      value: groupValue(snapshot, ["BTC", "ETH"]),
      weightPct: coreWeight,
      targetText: "BTC 5%-8%，ETH 3%-5%；当前阶段只做底仓，不抢 AI 主攻资金",
      status: coreStatus,
      advice: coreDetails.advice
    },
    {
      id: "stable",
      name: "长期稳定层",
      symbols: ["VOO", "XAUT"],
      value: groupValue(snapshot, ["VOO", "XAUT"]),
      weightPct: stableWeight,
      targetText: "VOO 5%-7%，XAUT 3%-4%；保险底仓，不做当前主攻",
      status: stableStatus,
      advice: stableDetails.advice
    },
    {
      id: "theme",
      name: "AI抽水机主攻仓",
      symbols: themeSymbols,
      value: groupValue(snapshot, themeSymbols),
      weightPct: themeWeight,
      targetText: "目标 25%-35%，35% 停止新增，40% 硬上限；MU/DRAM/GLW/SMH 单笔 500 USDT 起",
      status: themeStatus,
      advice: themeWeight < 25 ? "当前阶段 AI 主攻仓优先推进到 25% 以上，BTC/XAUT 不抢新增资金。" : "AI 抽水机仓是收益主攻层，35% 后停止新增，40% 为硬上限。"
    },
    {
      id: "speculative",
      name: "投机清理层",
      symbols: specSymbols,
      value: groupValue(snapshot, specSymbols),
      weightPct: specWeight,
      targetText: "DOGE 可作为 BTC 高弹性卫星；DOGE+BGB 目标 0%-4%，4.5% 禁止新增，5% 只减不补",
      status: specStatus,
      advice: specWeight >= pct(v4.speculativeLayer.noNewBuyAbove) ? "DOGE/BGB 已到高弹性卫星仓上限，后续只等趋势或反弹减仓。" : "DOGE 可适度作为 BTC 放大器，但仍不能摊低成本或替代核心仓。"
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
    themeControl: { label: "AI抽水机仓控制", max: 15, score: 15, reasons: [] },
    dataDiscipline: { label: "数据与纪律", max: 15, score: 15, reasons: [] },
    drawdownState: { label: "回撤状态", max: 10, score: 10, reasons: [] }
  };

  if (cashPct > 70) {
    components.cashSafety.score -= 4;
    components.cashSafety.reasons.push("现金超过 70%，账户安全但有效仓位不足，可能浪费行情。");
  }
  if (cashPct < 40) {
    components.cashSafety.score -= 8;
    components.cashSafety.reasons.push("现金低于 40%，应暂停普通加仓。");
  }
  if (cashPct < 35) {
    components.cashSafety.score -= 4;
    components.cashSafety.reasons.push("现金低于 35%，停止新增买入。");
  }

  const coreDetails = coreLayerDetails({ btcWeight, ethWeight, rules: v4 });
  const stableDetails = stableLayerDetails({ vooWeight, xautWeight, rules: v4 });
  if (!coreDetails.isTotalEnough) {
    components.coreCompleteness.score -= 5;
    components.coreCompleteness.reasons.push("BTC/ETH 合计低于 8% 底仓线，但当前不因核心不足机械占用 AI 弹药。");
  } else if (coreDetails.isSkewed) {
    components.coreCompleteness.score -= 1;
    components.coreCompleteness.reasons.push(`BTC/ETH 合计达标，但 ${coreDetails.missing.join("/")} 偏低，仅作为结构提示。`);
  }
  if (stableDetails.total <= 0) {
    components.coreCompleteness.score -= 3;
    components.coreCompleteness.reasons.push("VOO/XAUT 稳定层完全缺位；仍不因此抢 AI 主攻资金。 ");
  } else if (stableDetails.missing.length) {
    components.coreCompleteness.score -= 1;
    components.coreCompleteness.reasons.push(`稳定层已有底仓，但 ${stableDetails.missing.join("/")} 缺位，仅作保险层提示。`);
  }

  if (specWeight > pct(v4.speculativeLayer.targetMax)) {
    components.speculativeControl.score -= 3;
    components.speculativeControl.reasons.push("高弹性卫星仓超过 4.5%，DOGE/BGB/CRCL 合计偏高。");
  }
  if (specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)) {
    components.speculativeControl.score -= 3;
    components.speculativeControl.reasons.push("高弹性卫星仓达到 4.5%，禁止新增 DOGE/BGB/CRCL。");
  }
  if (specWeight >= pct(v4.speculativeLayer.reduceOnlyAbove)) {
    components.speculativeControl.score -= 4;
    components.speculativeControl.reasons.push("高弹性卫星仓达到 5%，只允许趋势止盈或反弹减仓。");
  }
  if (specWeight >= pct(v4.speculativeLayer.hardWarningAbove)) {
    components.speculativeControl.score -= 5;
    components.speculativeControl.reasons.push("高弹性卫星仓超过 6%，进入高风险警戒。");
  }

  if (themeWeight > pct(v4.themeLayer.targetMax)) {
    components.themeControl.score -= 5;
    components.themeControl.reasons.push("AI抽水机主攻仓超过 35%，停止新增并复盘。");
  }
  if (themeWeight > pct(v4.themeLayer.hardMax)) {
    components.themeControl.score -= 8;
    components.themeControl.reasons.push("AI抽水机主攻仓超过 40%，超过硬上限，必须复盘是否降仓。");
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
    components.drawdownState.reasons.push("账户回撤超过 25%，暂停进攻仓买入。");
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
  if (cashPct > 70 && total >= 65) grade = "偏保守";
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
  const themeWeight = groupWeightPct(snapshot, v4.themeLayer.symbols);
  const coreDetails = coreLayerDetails({ btcWeight, ethWeight, rules: v4 });
  const stableDetails = stableLayerDetails({ vooWeight, xautWeight, rules: v4 });
  if (cashPct > 65 && themeWeight < 25) advice.push("现金偏高且 AI 主攻仓不足，新增资金优先 MU/DRAM/GLW/SMH；BTC/XAUT 暂不机械补仓。 ");
  if (!coreDetails.isTotalEnough) advice.push("BTC/ETH 总量低于底仓线，但当前只做观察，不抢 AI 主攻资金。 ");
  else if (coreDetails.isSkewed) advice.push(`BTC/ETH 总量达标但 ${coreDetails.missing.join("/")} 偏低，这是结构偏科，不是核心不足。 `);
  if (stableDetails.total <= 0) advice.push("VOO/XAUT 稳定层完全缺位，但当前优先级仍低于 AI 主攻仓。 ");
  if (specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)) advice.push("DOGE/BGB/CRCL 高弹性卫星仓达到上限，禁止新增，以趋势止盈或反弹减仓为主。 ");
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
  const coreDetails = coreLayerDetails({ btcWeight, ethWeight, rules: v4 });
  const stableDetails = stableLayerDetails({ vooWeight, xautWeight, rules: v4 });
  if (cashPct > 65 && themeWeight < 25) messages.push("当前现金仍偏高，AI 主攻仓未达 25%；新增资金优先给 MU/DRAM/GLW/SMH，BTC/XAUT 只保留底仓。 ");
  if (!coreDetails.isTotalEnough) messages.push("BTC/ETH 合计低于底仓线，但不在弱势阶段机械补；只有深跌或趋势重新确认后才补。 ");
  else if (coreDetails.isSkewed) messages.push(`BTC/ETH 合计已达标，但 ${coreDetails.missing.join("/")} 偏低，这是核心偏科，不是核心不足；不影响 AI 主攻仓优先。 `);
  if (stableDetails.total <= 0) messages.push("VOO/XAUT 是保险底仓，当前不应继续抢占 AI 主攻资金。 ");
  if (specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)) messages.push("DOGE/BGB 已达到高弹性卫星仓上限，不建议继续补；DOGE 可以作为 BTC 放大器，但不能突破风控。 ");
  if (themeWeight > 35) messages.push("AI抽水机仓超过 35% 后停止新增，40% 为硬上限。 ");
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

  const coreDetails = coreLayerDetails({ btcWeight, ethWeight, rules: v4 });
  if (themeWeight < 25 && cashPct >= 45) actions.push("新增资金第一优先给 AI 主攻仓：MU/DRAM/GLW/SMH 或 SMH，单笔 500 USDT 起；A/S 急跌执行 1000-2500 USDT。 ");
  if (cashPct >= 45 && !coreDetails.isTotalEnough) actions.push("BTC/ETH 总量低于底仓线，但仍只在 BTC 56k/55k 或重新站稳 62k 后小额补，不抢 AI 主攻资金。 ");
  if (cashPct >= 45 && coreDetails.isSkewed) actions.push(`BTC/ETH 总量达标但 ${coreDetails.missing.join("/")} 偏低；这是结构偏科，只提示不强制买。 `);
  if (cashPct >= 45 && xautWeight < 3) actions.push("XAUT 已降级为保险底仓；3900 上方不补，3850 以下才考虑 500 USDT 级别补仓。 ");
  if (themeWeight >= 25 && themeWeight < 35) actions.push("AI 主攻仓进入健康进攻区，后续只在急跌或深回调时继续加，不追涨。 ");
  actions.push("CRCL 只做加密金融卫星仓，55-60 区间才允许 100-200 USDT 小补，不能抢 AI 主攻资金。 允许做月度复盘、更新持仓成本和检查价格源。 ");
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
  if (cashPct < pct(v4.cashLayer.pauseNormalBuyBelow)) forbidden.push("不要在现金低于 35% 时普通加仓。 ");
  if (cashPct > 70) forbidden.push("不要因为现金多就一次性打光现金。 ");
  if (specWeight >= pct(v4.speculativeLayer.noNewBuyAbove)) {
    forbidden.push("DOGE 不再是绝对禁止，但只有 BTC 趋势确认、DOGE+BGB 合计低于 4.5% 时才允许小额；不要把 DOGE 当核心仓。 ");
    forbidden.push("不要补 BGB。 ");
  }
  if (specWeight >= pct(v4.speculativeLayer.reduceOnlyAbove)) forbidden.push("DOGE/BGB/CRCL 已进入只减不补区，不要摊低成本；CRCL 只适合作为小仓卫星，不适合作为主攻仓。 ");
  if (themeWeight < 25 && cashPct >= 45) {
    forbidden.push("不要把新增资金继续分散到 BTC/XAUT 或杂票；AI 主攻仓未达 25% 前，优先等 MU/DRAM/GLW/SMH 的有效买点。 ");
  }
  if (themeWeight >= pct(v4.themeLayer.maxBeforeCoreComplete)) {
    forbidden.push("不要在没有计划的情况下乱加主题股；AI 主攻只买 MU/DRAM/GLW/SMH 等高优先级，不买杂票。 ");
  }
  if (themeWeight >= 35) forbidden.push("AI抽水机仓超过 35% 后不要继续新增，40% 为硬上限。 ");
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
      name: "第一阶段：现金降到 60%-65%",
      deployAmount: toTargetAmount(0.65),
      target: "新增资金优先 AI 主攻仓；BTC/XAUT 弱势阶段只保留底仓，不继续机械补仓。",
      steps: ["MU/DRAM/GLW/SMH 建立有效主攻仓，单笔 500 USDT 起", "AI A/S 急跌机会执行 1000-2500 USDT", "BTC 只在 56k/55k 或趋势确认后小额补", "XAUT 3850 以下才补，3900 上方不补"]
    },
    {
      name: "第二阶段：现金降到 45%-50%",
      deployAmount: toTargetAmount(0.50),
      target: "AI 主攻仓推进到 25%-35%，让账户真正吃到主升方向。",
      steps: ["AI 抽水机仓推进到 25% 以上", "MU/DRAM/GLW/SMH 单项向 4%-8% 目标靠拢", "MRVL/ANET/AVGO 只做第二梯队", "不因 BTC/XAUT 目标不足而挤占 AI 弹药"]
    },
    {
      name: "第三阶段：现金稳定 35%-45%",
      deployAmount: toTargetAmount(0.45),
      target: "形成趋势优先结构：现金有防守，AI 主攻仓能真正影响账户收益。",
      steps: ["现金保留 35%-45%", "AI 抽水机仓 25%-35%", "AI 35% 后停止新增，40% 硬上限", "BTC/XAUT 只做保险底仓", "每月复盘再平衡"]
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
  if (groupWeightPct(snapshot, v4.themeLayer.symbols) > pct(v4.themeLayer.hardMax)) alerts.push("AI抽水机主攻仓超过 40%，超过硬上限，必须复盘是否降仓。 ");
  if (groupWeightPct(snapshot, v4.speculativeLayer.symbols) > pct(v4.speculativeLayer.reduceOnlyAbove)) alerts.push("DOGE/BGB/CRCL 高弹性卫星仓超过 5%，只允许趋势止盈或反弹减仓。 ");
  if (weightPct(snapshot, "CRCL") > 5) alerts.push("CRCL 超过 5%，超过加密金融卫星仓硬上限，必须停止新增并复盘是否减仓。 ");
  if (cashPct > 70) alerts.push("现金超过 70%，资金效率偏低，建议按有效仓位规则推进。 ");
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
