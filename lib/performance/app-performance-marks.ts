export interface AppPerformanceMark {
  name: string;
  atMs: number;
  detail?: string;
}

const MAX_MARKS = 80;
const appStartedAt = now();
const marks: AppPerformanceMark[] = [];

function now(): number {
  const timer = globalThis.performance?.now;
  return typeof timer === "function" ? timer.call(globalThis.performance) : Date.now();
}

/**
 * 仅保留内存中的低频关键标记；不在用户点击或帧循环中写 AsyncStorage，
 * 以免性能观测本身制造 I/O 卡顿。原生验收可通过此时间线与 os_signpost 对齐。
 */
export function markAppPerformance(name: string, detail?: string): AppPerformanceMark {
  const mark: AppPerformanceMark = { name, atMs: Math.max(0, now() - appStartedAt), detail };
  marks.push(mark);
  if (marks.length > MAX_MARKS) marks.splice(0, marks.length - MAX_MARKS);
  return mark;
}

export function getAppPerformanceMarks(): readonly AppPerformanceMark[] {
  return marks.map((mark) => ({ ...mark }));
}

export function clearAppPerformanceMarks(): void {
  marks.splice(0, marks.length);
}

export function measureAppPerformance(name: string, startedAtMs: number, detail?: string): AppPerformanceMark {
  const duration = Math.max(0, now() - startedAtMs);
  return markAppPerformance(name, `${detail ? `${detail};` : ""}durationMs=${duration.toFixed(1)}`);
}

markAppPerformance("process.module_loaded");
