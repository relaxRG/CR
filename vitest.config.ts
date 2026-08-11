import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "lib/labor/**/*.{ts,tsx}",
        "lib/store/petty-labor-link-store.tsx",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/node_modules/**",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
      },
    },
  },
});
