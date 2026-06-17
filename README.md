# 投资执行卡 GitHub Pages 发布文件

把本文件夹内的全部内容上传到 GitHub 仓库根目录，然后开启 GitHub Pages。

## 建议仓库名

```text
investment-card
```

发布后网址通常是：

```text
https://你的GitHub用户名.github.io/investment-card/
```

## GitHub 网页上传步骤

1. 登录 GitHub。
2. 点击右上角 `+`，选择 `New repository`。
3. Repository name 填：`investment-card`。
4. 选择 `Public`。
5. 勾选 `Add a README file` 也可以，不勾选也可以。
6. 创建仓库后，点击 `Add file` -> `Upload files`。
7. 上传本文件夹里的全部内容：`index.html`、`manifest.webmanifest`、`service-worker.js`、`icons` 文件夹。
8. 点击 `Commit changes`。
9. 进入仓库 `Settings` -> `Pages`。
10. Source 选择 `Deploy from a branch`。
11. Branch 选择 `main`，目录选择 `/root`。
12. 点击 `Save`，等待 1-3 分钟。

## 添加到手机桌面

1. 用安卓 Chrome 打开 GitHub Pages 网址。
2. 右上角 `⋮`。
3. 选择 `添加到主屏幕` 或 `安装应用`。
4. 名称填 `投资执行卡`。
5. 添加完成后，桌面会出现图标。

## 后续更新

以后只需要替换仓库里的 `index.html`，等待 GitHub Pages 自动刷新即可。
