import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { notifySyncChange, registerStoreReload } from "@/lib/sync/engine";
import { upsertPriceAlertsRemote } from "@/lib/cf-sync/client";
import { useBottleStore } from "./store";
import { PRICE_ALERTS_KEY, emptyPriceAlertLedger, inspectBottlePrices, resolvePriceAlert, type PriceAlert, type PriceAlertLedger, type PriceAlertSource, upsertPriceAlerts } from "./price-alerts";

interface PriceAlertContextValue {
  ledger: PriceAlertLedger;
  openAlerts: PriceAlert[];
  alertsForBottle: (bottleId: string) => PriceAlert[];
  inspect: (source: PriceAlertSource) => void;
  resolve: (id: string, resolution: NonNullable<PriceAlert["resolution"]>, suppressionUntil?: string) => void;
}
const EMPTY_PRICE_ALERT_CONTEXT: PriceAlertContextValue = {
  ledger: emptyPriceAlertLedger(),
  openAlerts: [],
  alertsForBottle: () => [],
  inspect: () => {},
  resolve: () => {},
};
const PriceAlertContext = createContext<PriceAlertContextValue>(EMPTY_PRICE_ALERT_CONTEXT);

export function PriceAlertProvider({ children }: { children: React.ReactNode }) {
  const { bottles } = useBottleStore();
  const [ledger, setLedger] = useState<PriceAlertLedger>(emptyPriceAlertLedger);
  const persist = useCallback((next: PriceAlertLedger) => { setLedger(next); AsyncStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(next)).then(() => { notifySyncChange(PRICE_ALERTS_KEY); return upsertPriceAlertsRemote(next.alerts); }).catch(() => {}); }, []);
  useEffect(() => {
    const load = async () => { const raw = await AsyncStorage.getItem(PRICE_ALERTS_KEY); if (!raw) return; try { const parsed = JSON.parse(raw); if (parsed?.schemaVersion === 1 && Array.isArray(parsed.alerts)) setLedger(parsed); } catch {} };
    void load(); return registerStoreReload(() => { void load(); });
  }, []);
  const inspect = useCallback((source: PriceAlertSource) => { const candidates = bottles.flatMap((bottle) => inspectBottlePrices(bottle, source)); if (candidates.length) persist(upsertPriceAlerts(ledger, candidates)); }, [bottles, ledger, persist]);
  useEffect(() => { if (bottles.length) inspect("recovery_scan"); }, [bottles.length]);
  const resolve = useCallback((id: string, resolution: NonNullable<PriceAlert["resolution"]>, suppressionUntil?: string) => persist(resolvePriceAlert(ledger, id, resolution, suppressionUntil)), [ledger, persist]);
  const value = useMemo<PriceAlertContextValue>(() => ({ ledger, openAlerts: ledger.alerts.filter((alert) => alert.status === "open"), alertsForBottle: (bottleId) => ledger.alerts.filter((alert) => alert.bottleId === bottleId && (alert.status === "open" || alert.status === "suppressed")), inspect, resolve }), [ledger, inspect, resolve]);
  return <PriceAlertContext.Provider value={value}>{children}</PriceAlertContext.Provider>;
}
export function usePriceAlerts() { return useContext(PriceAlertContext); }
