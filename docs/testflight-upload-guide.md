# cocktail R — TestFlight 上传指南

## 当前版本信息

| 字段 | 值 |
|------|-----|
| App 名称 | cocktail R |
| Bundle ID | com.app.cocktailrecipes |
| Build Number | 133 |
| App Store Connect App ID | 6788653669 |
| EAS Project ID | 3ab89cc0-c646-4fb8-bceb-ba24204a8811 |
| EAS Owner | rgsds-team |
| GitHub 仓库 | relaxRG/CR |

## 前置条件

在触发 EAS Build 之前，需要准备以下凭证文件：

### Apple 凭证文件（需放置在 `~/.apple-creds/` 目录）

| 文件 | 说明 |
|------|------|
| `AuthKey_SS7N6Q2U48.p8` | App Store Connect API Key（用于自动提交 TestFlight） |
| `new_profile.mobileprovision` | iOS Distribution Provisioning Profile |
| `distribution_macos.p12` | Distribution Certificate（密码：expo123） |

> **注意**：以上凭证文件需要从 Apple Developer Portal 下载，或从上一次构建的备份中恢复。

### 环境变量

```bash
export EXPO_TOKEN=<你的 Expo 访问令牌>
```

Expo 访问令牌可在 [expo.dev/accounts/rgsds-team/settings/access-tokens](https://expo.dev/accounts/rgsds-team/settings/access-tokens) 生成。

## 构建命令

### 方法一：EAS Build（推荐，云端构建）

```bash
# 1. 登录 EAS
eas login

# 2. 触发 iOS Production 构建
cd ~/cocktail-r
eas build --platform ios --profile production

# 3. 构建完成后自动提交到 TestFlight
eas submit --platform ios --profile production --latest
```

### 方法二：本地构建 + 手动上传

```bash
# 本地构建（需要 macOS + Xcode）
eas build --platform ios --profile production --local

# 使用 Transporter 或 xcrun altool 上传 .ipa 文件
xcrun altool --upload-app -f <path-to.ipa> \
  --apiKey SS7N6Q2U48 \
  --apiIssuer 4c2aa939-390b-4d72-afef-7724d6238127
```

## 构建配置说明

### `eas.json` 关键配置

```json
{
  "build": {
    "production": {
      "autoIncrement": true,          // 自动递增 buildNumber
      "credentialsSource": "local",   // 使用本地凭证文件
      "ios": {
        "resourceClass": "m-medium"   // 使用 M 系列 Mac 构建机
      },
      "env": {
        "CF_WORKER_URL": "https://cocktail-ai.kikikong2017.workers.dev"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "6788653669",
        "ascApiKeyPath": "/home/ubuntu/.apple-creds/AuthKey_SS7N6Q2U48.p8",
        "ascApiKeyId": "SS7N6Q2U48",
        "ascApiKeyIssuerId": "4c2aa939-390b-4d72-afef-7724d6238127"
      }
    }
  }
}
```

## Build 133/134 更新内容（TestFlight 说明）

### Build 133 — 员工管理系统全面重构

**排班表系统**
- 手动维护班次组员工列表（支持历史快照代入）
- 全面清理旧代码和废弃字段

**月报重构**
- 删除冗余 Tab，只保留总报表单页
- 账户管理移至当月月报主页第三入口
- 月报工资科目自动同步，按部门分组显示

**薪资系统**
- 薪资总览即时同步，底部四按钮（发放/复制/历史/设置）
- 薪资统计和薪资总览统一按前厅/后厨/公司/临时兼职分组
- 全面修复薪资数据非响应式问题

**员工档案**
- 新增员工档案卡页面（详细档案查看）
- 全面重构员工档案编辑页面
- 统一使用 weeklyHoursRules 灵活工时规则

### Build 134 — 月报系统 v2

**科目行交互升级**
- 所有科目行支持长按菜单（手工标记重复/取消重复）
- 导航栏添加一键汇总快捷按钮
- 导航栏添加月报设置快捷入口

**货款管理升级**
- 供应商货款卡片新增「录入付款」按钮
- 员工薪资卡片新增「录入发放」按钮
- 新增部分付款 Modal（支持选择付款方式/账户/备注）
- 付款后自动更新已付/待付金额和状态

## 常见问题

### EAS Build 失败：metro.config.js 无法加载

```bash
# 升级 eas-cli 到最新版本
npm install -g eas-cli@latest

# 确认 Node 版本 >= 18
node --version

# 清理缓存后重试
eas build --platform ios --profile production --clear-cache
```

### 凭证文件缺失

如果 `~/.apple-creds/` 目录不存在，需要：
1. 从 Apple Developer Portal 下载 Provisioning Profile
2. 从 Keychain 导出 Distribution Certificate 为 .p12 格式
3. 从 App Store Connect 下载 API Key (.p8 文件)

### 构建后查看状态

```bash
# 查看最新构建状态
eas build:list --platform ios --limit 5

# 查看特定构建详情
eas build:view <build-id>
```

## 相关链接

- [App Store Connect](https://appstoreconnect.apple.com/apps/6788653669)
- [EAS Build 控制台](https://expo.dev/accounts/rgsds-team/projects/cocktail-recipes/builds)
- [GitHub 仓库](https://github.com/relaxRG/CR)
