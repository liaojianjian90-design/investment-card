# 投资监控卡 GitHub Pages 文件

这是无 Bitget API Key 版本：

- GitHub Actions 每 10 分钟拉取公开价格。
- 使用 `config/holdings.json` 里的默认仓位计算盈亏。
- 触发规则后通过邮件提醒。
- 网页前端可以手动输入仓位并保存到本机浏览器。
- 前端输入不会回写 GitHub，不会影响邮件提醒。

## 上传文件

把本文件夹内全部内容上传到 GitHub 仓库根目录：

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

注意：`.github` 是隐藏文件夹，也要上传，否则不会自动监控。

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
- `ALERT_EMAIL_TO`：`410097506@qq.com`

可选：

- `ALERT_EMAIL_FROM`

说明：

- Gmail/QQ/Outlook 建议使用应用专用密码。
- 不要填写邮箱登录密码。
- 不需要 Bitget API Key。
- 不需要 GitHub Token。

## QQ 邮箱参考配置

如果使用 QQ 邮箱发信，通常填写：

- `SMTP_HOST`: `smtp.qq.com`
- `SMTP_PORT`: `465`
- `SMTP_USER`: 你的 QQ 邮箱地址
- `SMTP_PASS`: QQ 邮箱生成的 SMTP 授权码，不是 QQ 登录密码
- `ALERT_EMAIL_TO`: `410097506@qq.com`

QQ 邮箱授权码通常在：

`QQ邮箱 -> 设置 -> 账号 -> POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务`

开启 SMTP 服务后生成授权码，再填到 GitHub Secret 的 `SMTP_PASS`。

## 手动运行监控

仓库页面进入：

`Actions -> Investment Monitor -> Run workflow`

运行成功后会更新：

- `data/snapshot.json`
- `data/alerts.json`
- `data/alert-state.json`

网页会优先读取 GitHub raw 上的最新 `data/*.json`，即使 GitHub Pages 没有重新构建，也能看到新的监控数据。

## 手机手动修改仓位

网页里打开“手动更新仓位”：

1. 输入数量和成本价。
2. 点击“保存到本机”。
3. 刷新页面仍会保留。
4. 点击“导出配置”可复制 JSON 发给 Codex，用于更新 GitHub 默认仓位。

重要限制：

- 本机保存只影响当前手机浏览器的显示。
- 邮件提醒仍使用 GitHub 仓库里的 `config/holdings.json`。

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
