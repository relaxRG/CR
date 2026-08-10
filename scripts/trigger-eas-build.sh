#!/bin/bash
# ============================================================
# cocktail R — EAS Build 触发脚本
# 用法：bash scripts/trigger-eas-build.sh [--submit]
# 参数：--submit  构建完成后自动提交到 TestFlight
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=================================================="
echo "  cocktail R — EAS Build 触发脚本"
echo "  Build Number: $(grep buildNumber app.config.ts | grep -o '[0-9]*')"
echo "  Bundle ID: com.app.cocktailrecipes"
echo "=================================================="

# 检查 eas-cli
if ! command -v eas &> /dev/null; then
  echo "❌ 未找到 eas-cli，正在安装..."
  npm install -g eas-cli@latest
fi

echo "✅ EAS CLI 版本: $(eas --version)"

# 检查登录状态
if ! eas whoami &> /dev/null 2>&1; then
  echo ""
  echo "⚠️  未登录 EAS，请先运行："
  echo "   eas login"
  echo ""
  echo "或设置环境变量："
  echo "   export EXPO_TOKEN=<你的访问令牌>"
  exit 1
fi

echo "✅ 已登录 EAS: $(eas whoami)"

# 检查凭证文件（与 credentials.json 保持一致）
CREDS_DIR="$HOME/.apple-creds"
if [ ! -f "$CREDS_DIR/AuthKey_SS7N6Q2U48.p8" ]; then
  echo ""
  echo "⚠️  缺少 Apple API Key 文件"
  echo "   请将 AuthKey_SS7N6Q2U48.p8 放置到 $CREDS_DIR/"
fi

if [ ! -f "$CREDS_DIR/profile_eas.mobileprovision" ]; then
  echo ""
  echo "⚠️  缺少 Provisioning Profile 文件"
  echo "   请将 profile_eas.mobileprovision 放置到 $CREDS_DIR/"
fi

if [ ! -f "$CREDS_DIR/distribution_eas.p12" ]; then
  echo ""
  echo "⚠️  缺少 Distribution Certificate 文件"
  echo "   请将 distribution_eas.p12 放置到 $CREDS_DIR/"
fi

echo ""
echo "🚀 开始触发 EAS Build (iOS Production)..."
echo ""

# 触发构建
eas build --platform ios --profile production --non-interactive

BUILD_STATUS=$?

if [ $BUILD_STATUS -eq 0 ]; then
  echo ""
  echo "✅ 构建已成功提交到 EAS！"
  echo ""
  
  if [ "$1" == "--submit" ]; then
    echo "📤 正在提交到 TestFlight..."
    eas submit --platform ios --profile production --latest --non-interactive
    echo "✅ 已提交到 TestFlight！"
  else
    echo "💡 构建完成后，运行以下命令提交到 TestFlight："
    echo "   eas submit --platform ios --profile production --latest"
  fi
  
  echo ""
  echo "📊 查看构建状态："
  echo "   eas build:list --platform ios --limit 3"
  echo "   https://expo.dev/accounts/rgsds-team/projects/cocktail-recipes/builds"
else
  echo ""
  echo "❌ 构建失败，请检查错误信息"
  exit 1
fi
