/**
 * 冰块进销存 ↔ 冰块成本 联动 Tab
 * 展示：每款冰块的匹配状态、进价→单杯成本换算、与成本设置的差异、一键同步
 */
import React, { useMemo, useState } from "react";
import {
  Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useIceSettings } from "@/lib/ice/store";
import { useIceNewInventoryStore } from "@/lib/ice/new-inventory-store";
import {
  analyzeIceLinks, buildSyncPatch, getLinkStatusLabel, IceLinkMatch,
} from "@/lib/ice/inventory-link";
import { iceKindCostPerDrink } from "@/lib/ice/cost";

const ICE_COLOR = "#00BCD4";

export default function IceCostLinkTab() {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { ice, updateKind } = useIceSettings();
  const { items } = useIceNewInventoryStore();

  const [syncing, setSyncing] = useState<string | null>(null);

  const matches = useMemo(() => analyzeIceLinks(items, ice), [items, ice]);
  const unmatched = useMemo(() => ice.kinds.filter((k) => !matches.some((m) => m.kind?.id === k.id)), [matches, ice.kinds]);
  const hasDiff = matches.some((m) => m.hasPriceDiff);

  const handleSync = (match: IceLinkMatch) => {
    if (!match.kind) return;
    tap();
    const { id, patch } = buildSyncPatch(match.item, match.kind);
    const newCost = iceKindCostPerDrink({ ...match.kind, ...patch });
    Alert.alert(
      "同步成本定价",
      `将「${match.kind.nameZh}」的定价更新为：\n¥${patch.price?.toFixed(3)} / ${match.item.unit}\n单杯成本：¥${newCost.toFixed(3)}\n\n（来源：${match.item.name} 进货价 ¥${match.item.latestCostPrice?.toFixed(3)}）`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认同步",
          onPress: () => {
            setSyncing(id);
            updateKind(id, patch);
            setTimeout(() => setSyncing(null), 800);
          },
        },
      ],
    );
  };

  const handleSyncAll = () => {
    tap();
    const diffs = matches.filter((m) => m.hasPriceDiff && m.kind);
    if (diffs.length === 0) { Alert.alert("无需同步", "所有冰款成本已与进货价一致"); return; }
    Alert.alert(
      `批量同步 ${diffs.length} 款`,
      diffs.map((m) => `• ${m.kind!.nameZh}：¥${m.computedCostPerDrink.toFixed(3)}/杯`).join("\n"),
      [
        { text: "取消", style: "cancel" },
        {
          text: "全部同步",
          onPress: () => {
            diffs.forEach((m) => {
              const { id, patch } = buildSyncPatch(m.item, m.kind!);
              updateKind(id, patch);
            });
          },
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      {/* 顶部说明卡 */}
      <View style={[S.infoCard, { backgroundColor: ICE_COLOR + "0f", borderColor: ICE_COLOR + "33" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <IconSymbol name="link" size={16} color={ICE_COLOR} />
          <Text style={{ fontSize: 14, fontWeight: "700", color: ICE_COLOR }}>冰块成本智能联动</Text>
        </View>
        <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 19 }}>
          进销存品类与冰块成本设置自动匹配。进货价变动后，可一键同步到成本定价，确保鸡尾酒成本计算始终准确。
        </Text>
        {hasDiff && (
          <TouchableOpacity onPress={handleSyncAll}
            style={{ marginTop: 10, backgroundColor: ICE_COLOR, borderRadius: 10, padding: 10, alignItems: "center" }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>⚡ 一键同步所有价差</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 已匹配品类 */}
      {matches.length > 0 && (
        <View>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>已匹配品类（{matches.length}）</Text>
          {matches.map((match) => {
            const status = getLinkStatusLabel(match);
            const isSyncing = syncing === match.kind?.id;
            return (
              <View key={match.item.id} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {/* 品类信息行 */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <View style={[S.iceBadge, { backgroundColor: ICE_COLOR + "22" }]}>
                    <Text style={{ fontSize: 18 }}>🧊</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>{match.item.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{match.item.spec} · {match.item.unit}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <IconSymbol name={status.icon as any} size={14} color={status.color} />
                    <Text style={{ fontSize: 12, fontWeight: "600", color: status.color }}>{status.label}</Text>
                  </View>
                </View>

                {/* 匹配的 IceKind */}
                {match.kind && (
                  <View style={[S.kindRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>匹配冰款</Text>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                        {match.kind.nameZh}
                        {match.kind.isShakeIce && (
                          <Text style={{ fontSize: 11, color: ICE_COLOR }}> · 摇冰</Text>
                        )}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>计价方式</Text>
                      <Text style={{ fontSize: 13, color: colors.foreground }}>
                        {match.kind.pricing === "perDrink" ? "按份" : match.kind.pricing === "perGram" ? "按克" : "按颗"}
                      </Text>
                    </View>
                  </View>
                )}

                {/* 成本对比 */}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  {/* 进货价 */}
                  <View style={[S.costBox, { backgroundColor: colors.background, borderColor: colors.border, flex: 1 }]}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>进货价</Text>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
                      ¥{(match.currentPrice || 0).toFixed(2)}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>/{match.item.unit}</Text>
                  </View>
                  {/* 箭头 */}
                  <View style={{ justifyContent: "center", alignItems: "center", paddingHorizontal: 4 }}>
                    <IconSymbol name="arrow.right" size={14} color={colors.muted} />
                  </View>
                  {/* 当前成本设置 */}
                  <View style={[S.costBox, { backgroundColor: colors.background, borderColor: colors.border, flex: 1 }]}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>成本设置</Text>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
                      ¥{match.kindCostPerDrink.toFixed(3)}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>/杯</Text>
                  </View>
                  {/* 箭头 */}
                  <View style={{ justifyContent: "center", alignItems: "center", paddingHorizontal: 4 }}>
                    <IconSymbol name="arrow.right" size={14} color={colors.muted} />
                  </View>
                  {/* 计算成本 */}
                  <View style={[S.costBox, {
                    backgroundColor: match.hasPriceDiff ? (match.diffPct > 0 ? colors.error + "0f" : colors.success + "0f") : colors.success + "0f",
                    borderColor: match.hasPriceDiff ? (match.diffPct > 0 ? colors.error + "44" : colors.success + "44") : colors.success + "44",
                    flex: 1,
                  }]}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>按进价计算</Text>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: match.hasPriceDiff ? (match.diffPct > 0 ? colors.error : colors.success) : colors.success }}>
                      ¥{match.computedCostPerDrink.toFixed(3)}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>/杯</Text>
                  </View>
                </View>

                {/* 差异说明 + 同步按钮 */}
                {match.hasPriceDiff && match.kind && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <Text style={{ flex: 1, fontSize: 12, color: match.diffPct > 0 ? colors.error : colors.success }}>
                      {match.diffPct > 0 ? "▲" : "▼"} 进货价较成本设置{Math.abs(match.diffPct).toFixed(1)}%，建议同步更新
                    </Text>
                    <TouchableOpacity onPress={() => handleSync(match)} disabled={isSyncing}
                      style={{ backgroundColor: ICE_COLOR, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, opacity: isSyncing ? 0.5 : 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>
                        {isSyncing ? "同步中…" : "同步"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* 未匹配的 IceKind（成本设置中有但进销存没有对应品类） */}
      {unmatched.length > 0 && (
        <View>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>冰款成本设置（进销存未录入）</Text>
          {unmatched.map((kind) => (
            <View key={kind.id} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.7 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={[S.iceBadge, { backgroundColor: colors.muted + "22" }]}>
                  <Text style={{ fontSize: 18 }}>🧊</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{kind.nameZh}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>
                    单杯成本 ¥{iceKindCostPerDrink(kind).toFixed(3)} · 进销存未录入对应品类
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <IconSymbol name="questionmark.circle" size={14} color={colors.muted} />
                  <Text style={{ fontSize: 12, color: colors.muted }}>未匹配</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 空状态 */}
      {matches.length === 0 && unmatched.length === 0 && (
        <View style={{ alignItems: "center", paddingTop: 40, gap: 8 }}>
          <Text style={{ fontSize: 40 }}>🧊</Text>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>暂无冰块品类</Text>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", paddingHorizontal: 32 }}>
            在台账中添加冰块品类后，系统将自动匹配对应的成本设置
          </Text>
        </View>
      )}

      {/* 跳转冰块成本设置 */}
      <Pressable onPress={() => { tap(); router.push("/ice-settings" as any); }}
        style={({ pressed }) => [S.settingsBtn, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
        <IconSymbol name="slider.horizontal.3" size={16} color={ICE_COLOR} />
        <Text style={{ fontSize: 14, fontWeight: "600", color: ICE_COLOR }}>前往冰块成本设置</Text>
        <IconSymbol name="chevron.right" size={14} color={colors.muted} />
      </Pressable>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  iceBadge: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  kindRow: { borderRadius: 10, borderWidth: 1, padding: 10, flexDirection: "row", alignItems: "center" },
  costBox: { borderRadius: 10, borderWidth: 1, padding: 10, alignItems: "center" },
  settingsBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14, justifyContent: "center" },
});
