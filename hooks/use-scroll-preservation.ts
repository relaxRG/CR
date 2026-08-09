/**
 * useScrollPreservation
 *
 * 通用滚动位置保持 Hook：在 Tab 页面内，用户点进详情页再返回时，
 * 自动恢复 FlatList/ScrollView 的滚动位置，避免列表跳回顶部。
 *
 * 使用方法：
 *   const { listRef, onScroll } = useScrollPreservation<FlatList>();
 *   <FlatList ref={listRef} onScroll={onScroll} scrollEventThrottle={100} ... />
 *
 * 当 tab/key 变化时（如 wine.tsx 的三种视图切换），传入 resetKey 使偏移量归零：
 *   const { listRef, onScroll } = useScrollPreservation<FlatList>(tab);
 */
import { useCallback, useRef } from "react";
import { FlatList, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";

type ScrollableRef = FlatList<any> | ScrollView;

export function useScrollPreservation<T extends ScrollableRef = FlatList<any>>(
  /** 当此 key 变化时，重置保存的偏移量（用于同一页面多个 tab/视图切换） */
  resetKey?: string | number,
) {
  const listRef = useRef<T>(null);
  const scrollOffsetRef = useRef(0);
  const isRestoringRef = useRef(false);
  const prevResetKeyRef = useRef(resetKey);

  // 当 resetKey 变化时（tab 切换），清零保存的偏移量
  if (prevResetKeyRef.current !== resetKey) {
    prevResetKeyRef.current = resetKey;
    scrollOffsetRef.current = 0;
  }

  useFocusEffect(
    useCallback(() => {
      if (scrollOffsetRef.current > 0) {
        isRestoringRef.current = true;
        const timer = setTimeout(() => {
          const ref = listRef.current as any;
          if (ref?.scrollToOffset) {
            // FlatList
            ref.scrollToOffset({ offset: scrollOffsetRef.current, animated: false });
          } else if (ref?.scrollTo) {
            // ScrollView
            ref.scrollTo({ y: scrollOffsetRef.current, animated: false });
          }
          isRestoringRef.current = false;
        }, 50);
        return () => clearTimeout(timer);
      }
    }, []),
  );

  const onScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    if (!isRestoringRef.current) {
      scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
    }
  }, []);

  return { listRef, onScroll };
}
