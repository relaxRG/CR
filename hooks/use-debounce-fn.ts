/**
 * useDebounce hook
 *
 * 提供两种防抖工具：
 * 1. `useDebounceFn`：对任意函数进行防抖，返回防抖后的函数
 * 2. `useThrottleFn`：对任意函数进行节流（首次立即执行，之后限速）
 *
 * 使用场景：
 * - 导出按钮：防止用户连续快速点击触发多次导出任务
 * - 保存按钮：防止用户连续点击触发多次保存
 * - 搜索输入：防止每次按键都触发搜索请求
 *
 * 注意：与 `tap()`（触觉反馈）配合使用时，`tap()` 应在防抖函数外部调用，
 * 确保每次点击都有触觉反馈，但实际操作只执行一次。
 */

import { useCallback, useRef } from "react";

/**
 * 防抖 hook：在最后一次调用后等待 `delay` ms 再执行
 *
 * @param fn 要防抖的函数
 * @param delay 防抖延迟（ms），默认 300ms
 * @returns 防抖后的函数
 */
export function useDebounceFn<T extends (...args: any[]) => any>(
  fn: T,
  delay = 300
): (...args: Parameters<T>) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fnRef.current(...args);
      }, delay);
    },
    [delay]
  );
}

/**
 * 节流 hook：首次调用立即执行，之后在 `interval` ms 内的调用被忽略
 *
 * 适合导出/保存等场景：第一次点击立即响应，防止重复触发。
 *
 * @param fn 要节流的函数
 * @param interval 节流间隔（ms），默认 1500ms
 * @returns 节流后的函数
 */
export function useThrottleFn<T extends (...args: any[]) => any>(
  fn: T,
  interval = 1500
): (...args: Parameters<T>) => void {
  const lastCallRef = useRef<number>(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      if (now - lastCallRef.current < interval) {
        return; // 在节流窗口内，忽略此次调用
      }
      lastCallRef.current = now;
      fnRef.current(...args);
    },
    [interval]
  );
}

/**
 * 异步节流 hook：首次调用立即执行，执行期间的调用被忽略（基于 Promise 状态）
 *
 * 适合异步导出/上传等场景：执行中不允许重复触发，执行完成后才能再次触发。
 *
 * @param fn 要节流的异步函数
 * @returns 节流后的异步函数，以及 isRunning 状态
 */
export function useAsyncThrottleFn<T extends (...args: any[]) => Promise<any>>(
  fn: T
): [(...args: Parameters<T>) => Promise<void>, React.MutableRefObject<boolean>] {
  const isRunningRef = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const throttled = useCallback(
    async (...args: Parameters<T>) => {
      if (isRunningRef.current) {
        return; // 正在执行中，忽略此次调用
      }
      isRunningRef.current = true;
      try {
        await fnRef.current(...args);
      } finally {
        isRunningRef.current = false;
      }
    },
    []
  );

  return [throttled, isRunningRef];
}
