// https://docs.expo.dev/guides/using-eslint/
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
    rules: {
      // 原生ActionSheet与Web/Android后备分支使用条件表达式执行二选一动作；该模式本身是有副作用的。
      "no-unused-expressions": ["warn", { allowTernary: true }],
    },
  },
]);
