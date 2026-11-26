# 发版手册：服务端、iOS、Android

一次完整发版的顺序和命令。原则：**先部署服务端，再发 App**。新 App 会发送新字段，旧服务端的 strict schema 会返回 400；反过来，服务端新增的字段都是可选的，旧 App 照常工作。

## 0. 发版前

```bash
npm run check                                   # ESLint 零 warning → Vitest → 隔离迁移测试（需 Docker）→ 生产构建
swift test --package-path ios                   # iOS 纯逻辑
cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug
```

- 有 schema 变更时，先按 `AGENTS.md`「数据库迁移规则」在 SQL Editor 执行迁移。CI/CD 不会自动迁移。
- 版本号：
  - iOS：`ios/LingDaily/LingDaily.xcodeproj/project.pbxproj` 里的 `MARKETING_VERSION` 和 `CURRENT_PROJECT_VERSION`，Debug 和 Release 各一处，一共两组。构建号要跳过 Xcode Cloud 已经用过的号：每次推送 main，Cloud 都会自动上传自己编号的构建。本机上传一般比上次至少多 +5，例如 1.9 用的是 30。
  - Android：`android/app/build.gradle.kts` 的 `versionCode`（+1）和 `versionName`。

## 1. 服务端（自动）

推送 `main`。GitHub Actions 跑完质量门禁后，构建 `ghcr.io/jackyinpei/lingdaily:latest`，再 SSH 到服务器执行 `compose pull/up`，整个过程约 8 分钟。

本机没装 `gh` 时，可以用线上接口确认部署完成。例如等 `/api/ios/scenarios` 返回新的 `version`：

```bash
curl -s https://lingdaily.yasobi.xyz/api/ios/scenarios | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])"
```

部署任务的「Deploy to server」步骤几秒就失败、日志里有 `no space left on device`：服务器磁盘被历次部署留下的无标签旧镜像占满（流程为了回滚不自动清理）。登录服务器执行 `df -h /` 确认后，用 `docker image prune -f` 只删无标签镜像（保留正在运行的 `latest` 和带标签的回滚镜像），再推送一次 main 或重跑任务。

## 2. iOS（App Store）

```bash
cd ios/LingDaily
xcodebuild -project LingDaily.xcodeproj -scheme LingDaily -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/LingDaily-<版本>-<构建>.xcarchive \
  -allowProvisioningUpdates archive
```

先核对发布包：`Info.plist` 里的版本和构建号正确，`ITSAppUsesNonExemptEncryption=false`，包含 `PrivacyInfo.xcprivacy` 和 `ScenarioCatalog.json`，**不包含 `AIConnection.json`**（2.0 起 App 已没有本机配对，留着这条检查防止旧配对文件被打包）。

上传时用的 `ExportOptions.plist`：`method=app-store-connect`、`destination=upload`、`teamID=8AJ84729BZ`、`signingStyle=automatic`。

```bash
xcodebuild -exportArchive -archivePath /tmp/LingDaily-<版本>-<构建>.xcarchive \
  -exportOptionsPlist /tmp/ExportOptions-upload.plist -exportPath /tmp/lingdaily-upload -allowProvisioningUpdates
```

看到 `Upload succeeded` 就是上传成功。如果连接 App Store Connect 时断开（-1005），重试即可。

**上传不等于送审。** 下面这几步需要在 [App Store Connect](https://appstoreconnect.apple.com/apps/6824758752/distribution) 网页上手动完成：等构建处理完 → 创建商店版本 → 选择构建 → 填写更新说明 → 提交审核。最后把这次发版记到 `ios/AppStore/SUBMISSION.md`、`ios/AppStore/release.json` 和 `ios/README.md` 的状态行里。

### 装到自己的 iPhone

用开发签名的 Release 包，连线上服务：

```bash
xcrun devicectl list devices                    # 找到 physical、available (paired) 的设备 UDID
xcodebuild -project LingDaily.xcodeproj -scheme LingDaily -configuration Release \
  -destination "id=<UDID>" -derivedDataPath /tmp/ld-device -allowProvisioningUpdates build
xcrun devicectl device install app --device <UDID> /tmp/ld-device/Build/Products/Release-iphoneos/LingDaily.app
```

手机锁屏时装得上，但不能自动启动，解锁后手动打开即可。

## 3. Android（自建更新）

上传 COS 后测试者立刻就能更新，所以一定要在服务端部署成功之后再做这一步。

App 启动时会读取 `https://deploy.shiying.sh.cn/lingdaily/latest.json`。如果里面的 `versionCode` 比本机的大，首页和「我的」会提示下载。

```bash
cd android
./gradlew :app:assembleRelease                  # 用 lingdaily-release.jks 签名；产物 app/build/outputs/apk/release/app-release.apk
python3 tools/upload_release_to_cos.py --changelog "这一版改了什么"
```

脚本会把 `LingDaily-v<versionName>.apk` 和 `latest.json` 上传到 COS 的 `lingdaily/` 前缀下。上传完可以这样核对：

```bash
curl -s "https://deploy.shiying.sh.cn/lingdaily/latest.json?t=$(date +%s)"   # versionCode、sha256 应该是新的
```

如果想彻底确认，可以把 `apkUrl` 下载下来，比对它的 SHA-256 和本地 APK 是否一致。

### COS 凭据

| 文件 | 内容 | 说明 |
| --- | --- | --- |
| `android/tools/.env` | `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION` | 上传脚本默认读取它；已被 `android/.gitignore` 忽略，权限 0600 |
| `android/lingdaily-release.jks`、`android/keystore.properties` | Release 签名密钥和口令 | 只在本机，已被忽略；丢失后已安装的用户就无法覆盖升级 |

- COS 和 CRHPosition 用的是**同一个 bucket**（`app-1308277566`，`ap-shanghai`），公开域名都是 `https://deploy.shiying.sh.cn`。这份凭据复制自 `/Users/qcy/proj/CRHPosition/CRHPositionAndroid/tools/.env`；那边的凭据轮换后，这里要跟着更新。
- 只能把凭据放在被忽略的 `.env` 里，或者放进环境变量（环境变量优先）。不要写进 Git、日志或文档。换电脑时，用 `COS_ENV_FILE=/路径/文件` 指向别处的凭据文件也可以。
- 检查凭据是否可用，又不想上传任何东西时：对 `lingdaily/latest.json` 做一次签名的 `HEAD` 请求。返回 200，且 ETag 和公开地址返回的一致，就说明是同一个 bucket。

## 4. 发版后

- 用真机实际走一遍这次改动的地方，尤其是 Live 语音。模拟器和单元测试替代不了真机上的听感。
- iOS 审核结果以 App Store Connect 的反馈为准，上传成功不代表审核通过。
