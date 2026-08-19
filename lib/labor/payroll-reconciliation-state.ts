export type PayrollReconciliationState =
  | Readonly<{ tag: "closed" }>
  | Readonly<{ tag: "inspecting" }>
  | Readonly<{ tag: "rebuilding_draft" }>
  | Readonly<{ tag: "opening_adjustment" }>
  | Readonly<{ tag: "completed"; message: string }>
  | Readonly<{ tag: "failed"; message: string }>;

export type PayrollReconciliationEvent =
  | Readonly<{ type: "OPEN" }>
  | Readonly<{ type: "CLOSE" }>
  | Readonly<{ type: "REBUILD_DRAFT" }>
  | Readonly<{ type: "OPEN_ADJUSTMENT" }>
  | Readonly<{ type: "SUCCESS"; message: string }>
  | Readonly<{ type: "FAIL"; message: string }>;

/** 面板不允许在执行中关闭或并发启动第二个修正操作。 */
export function reducePayrollReconciliationState(
  state: PayrollReconciliationState,
  event: PayrollReconciliationEvent,
): PayrollReconciliationState {
  switch (event.type) {
    case "OPEN": return state.tag === "closed" ? { tag: "inspecting" } : state;
    case "CLOSE": return state.tag === "rebuilding_draft" || state.tag === "opening_adjustment" ? state : { tag: "closed" };
    case "REBUILD_DRAFT": return state.tag === "inspecting" ? { tag: "rebuilding_draft" } : state;
    case "OPEN_ADJUSTMENT": return state.tag === "inspecting" ? { tag: "opening_adjustment" } : state;
    case "SUCCESS": return state.tag === "rebuilding_draft" || state.tag === "opening_adjustment" ? { tag: "completed", message: event.message } : state;
    case "FAIL": return state.tag === "rebuilding_draft" || state.tag === "opening_adjustment" ? { tag: "failed", message: event.message } : state;
  }
}
