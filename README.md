# 投资健康卡 5.0：holdings.json 手动仓位版

本版本默认不接入 Bitget 私人账户 API，不做自动交易，也不再提供前端手动买入/卖出入口、手动更新仓位编辑器或云端同步设置。

**唯一仓位来源：`config/holdings.json`。**

你每次买入、卖出或调整现金后，只需要直接修改 GitHub 仓库里的 `config/holdings.json`，然后运行 GitHub Actions 生成新的 `data/snapshot.json`、`data/alerts.json` 和邮件判断。

---

## 当前系统定位

投资健康卡 5.0 是一个个人仓位管理和纪律提醒仪表盘：

- 读取 `config/holdings.json` 中的现金、持仓数量和成本价。
- 拉取行情价格，生成 `data/snapshot.json`。
- 计算投资健康评分、资产五层结构、今日允许动作、今日禁止动作、再平衡提醒和邮件提醒。
- 不保存交易所 API Key。
- 不在前端修改仓位。
- 不自动下单。

---

## 如何更新仓位

直接编辑：

```text
config/holdings.json
```

结构示例：

```json
{
  "baseCurrency": "USDT",
  "cash": [
    { "symbol": "USDT", "quantity": 10000, "cost": 1, "type": "cash" },
    { "symbol": "USDGO", "quantity": 1500, "cost": 1.0019, "type": "cash" }
  ],
  "positions": [
    { "symbol": "BTC", "quantity": 0.01, "cost": 59000, "type": "crypto" },
    { "symbol": "ETH", "quantity": 0.1, "cost": 1600, "type": "crypto" },
    { "symbol": "MU", "quantity": 0.2, "cost": 1130, "type": "watch" }
  ]
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `symbol` | 标的代码 |
| `quantity` | 当前持有数量 |
| `cost` | 平均成本价，以 USDT/USD 计价 |
| `type` | `cash`、`crypto` 或 `watch` |

买入后：增加对应标的 `quantity`，更新平均 `cost`，同时减少 USDT / USDGO 现金数量。

卖出后：减少对应标的 `quantity`，同时增加 USDT / USDGO 现金数量。

---

## GitHub Actions 运行方式

手动运行：

```text
GitHub → Actions → Investment Health Card 5.0 Holdings Monitor → Run workflow
```

或当以下文件变更时自动运行：

```text
config/holdings.json
config/rules.json
scripts/monitor.mjs
src/lib/investmentHealth.mjs
```

Actions 会输出：

```text
data/snapshot.json
data/alerts.json
data/alert-state.json
```

---

## 本地检查

```bash
npm install
npm test
npm run monitor:dry
```

`npm test` 会检查：

- 健康评分是否正常。
- 五层资产结构是否能计算。
- 前端是否已移除手动买入/卖出入口。
- 前端是否已移除云端同步设置。
- 前端是否以 `config/holdings.json` 为仓位来源。
- `holdings.json` 是否能正确解析。

---

## Service Worker 缓存

当前缓存版本：

```text
investment-card-github-pages-v512
```

如果手机端还显示旧页面，访问：

```text
https://liaojianjian90-design.github.io/investment-card/?v=512
```

也可以在手机浏览器中清理该站点缓存后重新打开。

---

## 风险声明

本项目仅用于个人投资记录、仓位管理和纪律提醒，不构成投资建议。所有买入、卖出、持有决策由使用者自行承担风险。系统规则用于降低冲动交易和仓位失控风险，但不能保证收益，也不能避免市场亏损。
