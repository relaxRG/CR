const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Exclude native-only Node modules that can't be bundled for React Native / web
config.resolver = config.resolver || {};
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "canvas") {
    return { type: "empty" };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // 开发期保留文件系统 CSS 以兼容原生样式；CI 静态导出改用虚拟模块，避免
  // Web 与静态渲染并发打包时重写 node_modules/react-native-css-interop/.cache/web.css。
  forceWriteFileSystem: process.env.CI !== "true",
});
