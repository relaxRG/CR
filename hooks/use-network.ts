import { useNetworkState } from "expo-network";

/**
 * Returns whether the device currently has internet connectivity.
 * Uses expo-network's useNetworkState hook which auto-updates on network changes.
 *
 * Note: On iOS, isInternetReachable === isConnected.
 * On Android, isInternetReachable checks actual internet access.
 * We default to `true` when the state is still loading (undefined) to avoid
 * blocking the UI on first render.
 */
export function useNetwork() {
  const state = useNetworkState();
  // isInternetReachable can be null/undefined while loading — treat as online
  const isOnline = state.isInternetReachable !== false;
  return { isOnline, networkType: state.type };
}
