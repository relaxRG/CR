import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { recordRuntimeError } from "@/lib/diagnostics/runtime";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

/**
 * 最后一层 React 渲染故障防线。
 * 它不掩盖原生 OOM 或进程级崩溃，但可将未预见的页面/Context 渲染异常降级为可重试界面。
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void recordRuntimeError("react_render_exception", error, info.componentStack || undefined);
    console.error("[AppErrorBoundary] render failed:", error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>页面暂时无法打开</Text>
        <Text style={styles.message}>已阻止异常继续扩散。请重试；如仍发生，请记录当前页面和操作步骤。</Text>
        <Pressable accessibilityRole="button" onPress={this.retry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
          <Text style={styles.retryLabel}>重试</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "#FFFFFF",
  },
  title: { fontSize: 20, fontWeight: "700", color: "#1C1C1E", marginBottom: 10 },
  message: { fontSize: 15, lineHeight: 22, color: "#636366", textAlign: "center", marginBottom: 22 },
  retryButton: { backgroundColor: "#111111", paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10 },
  retryLabel: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.7 },
});
