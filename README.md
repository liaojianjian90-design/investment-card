# 投资监控卡 GitHub Pages 发布文件

这是一个不需要 Bitget API Key 的投资纪律监控页面。

## 当前版本做什么

- GitHub Actions 每 10 分钟运行一次。
- 读取 `config/holdings.json` 里的默认仓位。
- 拉取公开行情价格。
- 计算总资产、现金比例、仓位、盈亏、价格源异常。
- 按交易纪律规则判断是否触发提醒。
- 有提醒时通过邮件发送。
- 网页端可以手动输入仓位，并保存到当前手机浏览器。
- 网页端不会保存 GitHub Token、邮箱密码或交易所 API Key。

## 必须上传到 GitHub 的文件

把本文件夹里的所有内容上传到仓库根目录：

- `index.html`
- `manifest.webmanifest`
- `service-worker.js`
- `icons/`
- `config/`
- `data/`
- `scripts/`
- `.github/`
- `package.json`
- `README.md`

注意：`.github` 是隐藏文件夹，也必须上传，否则不会出现 `Investment Monitor` 自动监控流程。

## GitHub Pages 设置

仓库页面进入：

`Settings -> Pages -> Build and deployment`

选择：

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

保存后访问：

`https://你的GitHub用户名.github.io/investment-card/`

## GitHub Actions Secrets

仓库页面进入：

`Settings -> Secrets and variables -> Actions -> New repository secret`

至少添加：

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `ALERT_EMAIL_TO`

可选：

- `ALERT_EMAIL_FROM`

QQ 邮箱常见配置：

- `SMTP_HOST`: `smtp.qq.com`
- `SMTP_PORT`: `465`
- `SMTP_USER`: 你的 QQ 邮箱地址
- `SMTP_PASS`: QQ 邮箱生成的 SMTP 授权码，不是 QQ 登录密码
- `ALERT_EMAIL_TO`: `410097506@qq.com`

## 测试邮件

仓库页面进入：

`Actions -> Investment Monitor -> Run workflow`

然后：

1. Branch 保持 `main`。
2. 勾选或打开 `test_email`。
3. 点击绿色 `Run workflow`。
4. 等待运行成功。
5. 检查邮箱是否收到测试邮件。

如果运行成功但没有收到邮件，查看：

- `data/alerts.json` 里的 `email.sent` 是否为 `true`。
- `email.missing` 是否提示缺少哪个 Secret。
- QQ 邮箱是否开启了 SMTP 服务。
- `SMTP_PASS` 是否填写授权码，而不是登录密码。

## 手动运行监控

仓库页面进入：

`Actions -> Investment Monitor -> Run workflow`

不勾选 `test_email` 时，只按真实规则发送邮件。

运行成功后会更新：

- `data/snapshot.json`
- `data/alerts.json`
- `data/alert-state.json`

## 当前默认仓位

默认配置来自 2026-06-25 截图：

- USDT: `12388.13874886`
- USDGO: `1501.94752253`
- BTC: `0.00998615`, 成本 `60071.83`
- ETH: `0.0636747`, 成本 `1570.91`
- DOGE: `4662.3598142`, 成本 `0.07506`
- BGB: `26.60353409`, 成本 `1.9692`
- CRCL: `7.38398262`, 成本 `74.41`
- MSTR: `4.37657119`, 成本 `102.72`

## 手机网页手动修改仓位

网页里打开“手动更新仓位”：

1. 输入数量和成本价。
2. 点击“保存到本机”。
3. 刷新页面后仍会保留。
4. 点击“导出配置 JSON”可复制配置发给 Codex，用于更新 GitHub 默认仓位。

重要限制：

- 本机保存只影响当前手机浏览器显示。
- 邮件提醒仍使用 GitHub 仓库里的 `config/holdings.json`。

## 纪律规则 2.0

核心原则：

- 价格源失败时不发买入提醒。
- 现金低于 35% 时停止所有买入。
- 加密相关总仓不超过 65%。
- 下跌买点每个价位只触发一次，必须重新站上重置价才允许再次触发。
- 上涨追随必须人工确认，不能把单日暴拉当成买入理由。
- DOGE 只止盈不补仓。
- BGB 不加仓，反弹可清。
- MSTR 单项上限比普通股票更严格。

## 页面没有更新怎么办

如果 GitHub 文件已经上传，但手机仍看到旧页面：

1. 在 Chrome 打开页面。
2. 右上角菜单进入“设置 -> 隐私和安全 -> 清除浏览数据”。
3. 只清除该网站缓存，或直接换无痕窗口打开。
4. 也可以在 URL 后加 `?v=2` 强制刷新。

这次版本已把缓存名升级为 `investment-card-github-pages-v6`，正常上传后应能自动刷新。
