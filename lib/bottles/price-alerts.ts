import type { Bottle, SupplierChannel } from "./types";

export const PRICE_ALERTS_KEY = "bottles.price-alerts.v1";
export type PriceAlertSeverity = "data_review" | "notice" | "attention" | "critical" | "missing";
export type PriceAlertStatus = "open" | "acknowledged" | "suppressed" | "resolved" | "voided";
export type PriceAlertRule = "invalid_quote" | "cost_basis_missing" | "cost_basis_stale" | "previous_quote_delta" | "median_quote_delta";
export type PriceAlertSource = "channel_edit" | "purchase_import" | "manual_purchase" | "cost_basis_change" | "recovery_scan" | "daily_scan";

export interface PriceAlert {
  id: string;
  fingerprint: string;
  bottleId: string;
  channelId?: string;
  rule: PriceAlertRule;
  severity: PriceAlertSeverity;
  status: PriceAlertStatus;
  price: number | null;
  referencePrice: number | null;
  delta: number | null;
  deltaPercent: number | null;
  unit?: string;
  detail: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  detectedCount: number;
  source: PriceAlertSource;
  version: number;
  operationId?: string;
  acknowledgedAt?: string;
  resolution?: "confirmed_change" | "temporary_promotion" | "corrected_input" | "ignored_once";
  suppressionUntil?: string;
}

export interface PriceAlertLedger { schemaVersion: 1; updatedAt: string; alerts: PriceAlert[]; }
export interface PriceAlertPolicy { noticePercent: number; noticeAbsolute: number; attentionPercent: number; attentionAbsolute: number; criticalPercent: number; criticalAbsolute: number; staleDays: number; medianHistoryCount: number; }
export const DEFAULT_PRICE_ALERT_POLICY: PriceAlertPolicy = { noticePercent: .05, noticeAbsolute: 5, attentionPercent: .15, attentionAbsolute: 15, criticalPercent: .30, criticalAbsolute: 30, staleDays: 90, medianHistoryCount: 6 };

const uuid = () => `price-alert-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const validHistory = (channel: SupplierChannel) => [...(channel.priceHistory ?? [])].filter((entry) => Number.isFinite(entry.price) && entry.price > 0 && entry.date).sort((a, b) => a.date.localeCompare(b.date));
const median = (values: number[]) => { if (!values.length) return null; const sorted = [...values].sort((a,b) => a-b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i-1] + sorted[i]) / 2; };
const severity = (current: number, reference: number, policy: PriceAlertPolicy): PriceAlertSeverity | null => { const d = Math.abs(current-reference); const p = reference > 0 ? d/reference : 0; if (p >= policy.criticalPercent && d >= policy.criticalAbsolute) return "critical"; if (p >= policy.attentionPercent && d >= policy.attentionAbsolute) return "attention"; if (p >= policy.noticePercent && d >= policy.noticeAbsolute) return "notice"; return null; };

type Candidate = Omit<PriceAlert, "id" | "status" | "firstDetectedAt" | "lastDetectedAt" | "detectedCount" | "version">;
export function inspectPriceChannel(bottle: Bottle, channel: SupplierChannel, source: PriceAlertSource, policy = DEFAULT_PRICE_ALERT_POLICY, now = new Date()): Candidate[] {
  const current = Number(channel.latestPrice); const base = { bottleId: bottle.id, channelId: channel.id, source, unit: channel.unit };
  if (!Number.isFinite(current) || current <= 0) return [{ ...base, rule: "invalid_quote", severity: "data_review", price: null, referencePrice: null, delta: null, deltaPercent: null, detail: "渠道报价无效，不能进入成本计算。", fingerprint: `${bottle.id}:${channel.id}:invalid` }];
  const history = validHistory(channel); const candidates: Candidate[] = [];
  if (channel.isCostBasis && !history.length) candidates.push({ ...base, rule: "cost_basis_missing", severity: "data_review", price: current, referencePrice: null, delta: null, deltaPercent: null, detail: "成本基准渠道缺少有效报价历史。", fingerprint: `${bottle.id}:${channel.id}:basis-missing` });
  if (channel.isCostBasis && history.length && (now.getTime() - new Date(history.at(-1)!.date).getTime()) / 86400000 > policy.staleDays) candidates.push({ ...base, rule: "cost_basis_stale", severity: "missing", price: current, referencePrice: current, delta: 0, deltaPercent: 0, detail: "成本基准报价已超过有效期。", fingerprint: `${bottle.id}:${channel.id}:basis-stale:${history.at(-1)!.date}` });
  const comparisons: [PriceAlertRule, number | null][] = [["previous_quote_delta", history.length >= 2 ? history.at(-2)!.price : null], ["median_quote_delta", median(history.slice(-policy.medianHistoryCount - 1, -1).map((entry) => entry.price))]];
  for (const [rule, reference] of comparisons) { if (reference === null) continue; const level = severity(current, reference, policy); if (!level) continue; const delta = current - reference; candidates.push({ ...base, rule, severity: level, price: current, referencePrice: reference, delta, deltaPercent: delta / reference, detail: rule === "previous_quote_delta" ? "当前报价较上次有效报价异常变化。" : "当前报价偏离近期有效报价中位数。", fingerprint: `${bottle.id}:${channel.id}:${rule}:${history.at(-1)?.date ?? "none"}:${current}` }); }
  return candidates;
}

export function inspectBottlePrices(bottle: Bottle, source: PriceAlertSource, policy = DEFAULT_PRICE_ALERT_POLICY, now = new Date()) { return (bottle.supplierChannels ?? []).flatMap((channel) => inspectPriceChannel(bottle, channel, source, policy, now)); }
export function upsertPriceAlerts(ledger: PriceAlertLedger, candidates: Candidate[], now = new Date().toISOString()): PriceAlertLedger { const alerts = [...ledger.alerts]; for (const candidate of candidates) { const index = alerts.findIndex((entry) => entry.fingerprint === candidate.fingerprint); if (index < 0) alerts.push({ ...candidate, id: uuid(), status: "open", firstDetectedAt: now, lastDetectedAt: now, detectedCount: 1, version: 1 }); else { const prior = alerts[index]; const held = prior.status === "suppressed" && !!prior.suppressionUntil && prior.suppressionUntil > now; alerts[index] = { ...prior, ...candidate, status: held ? "suppressed" : prior.status, lastDetectedAt: now, detectedCount: prior.detectedCount + 1, version: prior.version + 1 }; } } return { schemaVersion: 1, updatedAt: now, alerts }; }
export function resolvePriceAlert(ledger: PriceAlertLedger, id: string, resolution: NonNullable<PriceAlert["resolution"]>, suppressionUntil?: string): PriceAlertLedger { const now = new Date().toISOString(); return { ...ledger, updatedAt: now, alerts: ledger.alerts.map((alert) => alert.id === id ? { ...alert, status: resolution === "temporary_promotion" ? "suppressed" : "acknowledged", resolution, acknowledgedAt: now, suppressionUntil, version: alert.version + 1 } : alert) }; }
export const emptyPriceAlertLedger = (): PriceAlertLedger => ({ schemaVersion: 1, updatedAt: new Date(0).toISOString(), alerts: [] });
