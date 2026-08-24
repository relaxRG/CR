import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(value: T) => value },
}));

import { AppErrorBoundary } from "@/components/app-error-boundary";

function ExplodingPage({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("intentional render failure");
  return <span>ready</span>;
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("拦截页面渲染异常并显示可重试降级界面", () => {
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <AppErrorBoundary>
          <ExplodingPage shouldThrow />
        </AppErrorBoundary>,
      );
    });

    const textNodes = renderer!.root.findAll((node) => String(node.type) === "Text");
    const retryNodes = renderer!.root.findAll((node) => String(node.type) === "Pressable");
    expect(textNodes.map((node) => node.children.join(""))).toContain("页面暂时无法打开");
    expect(retryNodes).toHaveLength(1);
  });
});
