import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendDiagnosticLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sync/engine", () => ({
  appendDiagnosticLog: mocks.appendDiagnosticLog,
}));

import {
  installGlobalRuntimeDiagnostics,
  recordRuntimeError,
  redactRuntimePath,
} from "@/lib/diagnostics/runtime";

describe("runtime diagnostics", () => {
  const originalErrorUtils = (globalThis as { ErrorUtils?: unknown }).ErrorUtils;

  beforeEach(() => {
    mocks.appendDiagnosticLog.mockClear();
  });

  afterEach(() => {
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = originalErrorUtils;
  });

  it("captures a sanitized stack without persisting token-like values", async () => {
    const error = new Error("request failed token=top-secret-value");
    error.stack = "Error: request failed token=top-secret-value\n at RootLayout";

    await recordRuntimeError("render_exception", error, "at RecipeScreen");

    expect(mocks.appendDiagnosticLog).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "render_exception",
        message: expect.stringContaining("token=[REDACTED]"),
        detail: expect.stringContaining("Component stack:\n"),
      }),
    );
    expect(JSON.stringify(mocks.appendDiagnosticLog.mock.calls)).not.toContain("top-secret-value");
  });

  it("observes global errors and still invokes the pre-existing fatal handler", async () => {
    type ErrorHandler = (error: Error, isFatal?: boolean) => void;
    const previousHandler = vi.fn<ErrorHandler>();
    let currentHandler: ErrorHandler = previousHandler;
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => currentHandler,
      setGlobalHandler: (handler: ErrorHandler) => {
        currentHandler = handler;
      },
    };

    const dispose = installGlobalRuntimeDiagnostics();
    const error = new Error("fatal startup failure");
    currentHandler(error, true);
    await Promise.resolve();

    expect(previousHandler).toHaveBeenCalledWith(error, true);
    expect(mocks.appendDiagnosticLog).toHaveBeenCalledWith(
      expect.objectContaining({ source: "global_js_fatal" }),
    );
    dispose();
  });

  it("removes identifier-like route segments from shareable navigation logs", () => {
    expect(redactRuntimePath("/recipe/7f3d2f31-8b4e-4b7a-94d4-123456789abc")).toBe("/recipe/:id");
    expect(redactRuntimePath("/labor/123456")).toBe("/labor/:id");
  });
});
