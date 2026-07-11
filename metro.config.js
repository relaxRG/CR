const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const config = getDefaultConfig(__dirname);

// Intercept the 'canvas' native module at any depth so Metro doesn't try to
// bundle canvas.node (pulled in by pdfjs-dist as an optional Node.js SSR dep).
const CANVAS_MOCK = require.resolve("./scripts/canvas-mock.js");
config.resolver = config.resolver ?? {};
const _origResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "canvas" || moduleName.endsWith("/canvas")) {
    return { filePath: CANVAS_MOCK, type: "sourceFile" };
  }
  if (_origResolveRequest) {
    return _origResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});
