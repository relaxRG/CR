import React, { useEffect, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useBottleStore } from "@/lib/bottles/store";
import { getEffectiveCostPrice, getSupplierChannelPurchaseNames, normalizeSupplierChannels, type SupplierChannel } from "@/lib/bottles/types";
import { useSpiritsInventoryStore } from "@/lib/spirits/crud-store";
import { hasBottlePurchaseProjectionChanged, projectBottleSupplierChannelsFromPurchases } from "@/lib/spirits/purchase-bottle-projection";

/**
 * 采购渠道页只展示由已链接采购投影出的渠道、采购名称和价格历史。
 * 不在这里独立创建渠道或手填价格；采购记录才是唯一事实来源。
 */
export default function BottleChannelsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getBottle, updateBottle } = useBottleStore();
  const { items, purchases } = useSpiritsInventoryStore();
  const bottle = getBottle(id);
  const [priceHistoryChannel, setPriceHistoryChannel] = useState<SupplierChannel | null>(null);
  const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  // 即使用户从酒库直接打开此页，也会用当前已链接采购刷新价格卡片投影。
  useEffect(() => {
    if (!bottle) return;
    const linkedItemIds = new Set(items.filter((item) => item.bottleId === bottle.id).map((item) => item.id));
    const linkedPurchases = purchases.filter((purchase) => Boolean(purchase.itemId && linkedItemIds.has(purchase.itemId)));
    const projection = projectBottleSupplierChannelsFromPurchases(bottle, linkedPurchases);
    if (hasBottlePurchaseProjectionChanged(bottle, projection)) updateBottle(bottle.id, { ...bottle, ...projection });
  }, [bottle, items, purchases, updateBottle]);

  if (!bottle) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>未找到酒款</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: colors.primary }}>返回</Text></Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const channels = bottle.supplierChannels ?? [];
  const effectivePrice = getEffectiveCostPrice(bottle);
  const projectedPurchaseCount = channels.flatMap((channel) => channel.priceHistory ?? []).filter((record) => Boolean(record.sourcePurchaseId)).length;

  const handleSetCostBasis = (channelId: string) => {
    const updatedChannels = normalizeSupplierChannels(channels.map((channel) => ({ ...channel, isCostBasis: channel.id === channelId })), channelId);
    const basisChannel = updatedChannels.find((channel) => channel.id === channelId)!;
    updateBottle(bottle.id, { ...bottle, supplierChannels: updatedChannels, costChannelId: channelId, priceCny: basisChannel.latestPrice });
    Alert.alert("已设置", `成本计算基准已切换为「${basisChannel.name}」\n进货价：¥${basisChannel.latestPrice}/${basisChannel.unit}`);
  };

  return (
    <ScreenContainer>
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}><IconSymbol name="chevron.left" size={22} color={colors.primary} /></Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]} numberOfLines={1}>采购渠道</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={[S.bottleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>{bottle.nameZh}</Text>
          {bottle.nameEn ? <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>{bottle.nameEn}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>当前成本计算价：</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>¥{formatMoney(effectivePrice)}</Text>
          </View>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 18 }}>
            由 {projectedPurchaseCount} 笔已链接进货自动汇总。更正名称、价格或日期请返回对应采购记录操作。
          </Text>
        </View>

        {channels.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 44 }}>
            <IconSymbol name="building.2" size={34} color={colors.muted} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>尚无已链接采购渠道</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center", lineHeight: 19 }}>
              在烈酒当月进货中完成酒库链接后，供应商、自采渠道、采购名称与价格历史会自动生成在这里。
            </Text>
          </View>
        ) : channels.map((channel) => (
          <View key={channel.id} style={[S.channelCard, { backgroundColor: colors.surface, borderColor: channel.isCostBasis ? colors.primary : colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>{channel.name}</Text>
                  {channel.isCostBasis ? <View style={{ backgroundColor: colors.primary + "18", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}><Text style={{ fontSize: 11, fontWeight: "600", color: colors.primary }}>成本基准</Text></View> : null}
                  {channel.type === "self" ? <Text style={{ fontSize: 11, color: colors.muted }}>自采电商</Text> : <Text style={{ fontSize: 11, color: colors.muted }}>供应商</Text>}
                </View>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }} numberOfLines={2}>
                  采购名称：{getSupplierChannelPurchaseNames(channel).map((entry) => entry.name).join("、") || "—"}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 11, color: colors.muted }}>最新进货价</Text>
                <Text style={{ fontSize: 20, fontWeight: "600", color: channel.isCostBasis ? colors.primary : colors.foreground }}>¥{formatMoney(channel.latestPrice)}<Text style={{ fontSize: 12, fontWeight: "400", color: colors.muted }}>/{channel.unit}</Text></Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={() => { tap(); setPriceHistoryChannel(channel); }} style={[S.secondaryAction, { borderColor: colors.border }]}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "500" }}>查看价格变化 · {(channel.priceHistory ?? []).length} 笔</Text>
              </TouchableOpacity>
              {!channel.isCostBasis ? <TouchableOpacity onPress={() => { tap(); handleSetCostBasis(channel.id); }} style={[S.secondaryAction, { borderColor: colors.primary + "66" }]}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "500" }}>设为成本基准</Text>
              </TouchableOpacity> : null}
            </View>

            {channel.purchaseUrl ? <TouchableOpacity onPress={() => { tap(); Linking.openURL(channel.purchaseUrl!); }} style={[S.purchaseBtn, { backgroundColor: colors.primary }]}>
              <IconSymbol name="arrow.up.right.square" size={14} color="#fff" />
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>打开采购链接</Text>
            </TouchableOpacity> : null}
          </View>
        ))}

        <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 16, lineHeight: 18 }}>
          渠道和价格历史仅由已链接采购生成；成本基准可在已有采购渠道间切换。
        </Text>
      </ScrollView>

      <Modal visible={Boolean(priceHistoryChannel)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPriceHistoryChannel(null)}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setPriceHistoryChannel(null)}><Text style={{ fontSize: 17, color: colors.primary }}>完成</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]} numberOfLines={1}>价格变化</Text>
            <View style={{ width: 34 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>{priceHistoryChannel?.name}</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 12, lineHeight: 19 }}>
              每一项均回溯至已链接采购。若需要更正，请回到原采购记录修改，不在此页手动改价。
            </Text>
            {(priceHistoryChannel?.priceHistory ?? []).slice().sort((left, right) => right.date.localeCompare(left.date)).map((record, index, records) => (
              <View key={record.sourcePurchaseId ?? `${record.date}-${record.price}-${index}`} style={{ paddingVertical: 12, borderBottomWidth: index < records.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500" }}>{record.date}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>{record.source ?? "历史采购"}{record.quantity ? ` · ${record.quantity} ${priceHistoryChannel?.unit ?? "件"}` : ""}</Text>
                </View>
                <Text style={{ fontSize: 17, color: colors.foreground, fontWeight: "600" }}>¥{formatMoney(record.price)}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600", flex: 1, textAlign: "center" },
  bottleCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  channelCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  secondaryAction: { flex: 1, minHeight: 36, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  purchaseBtn: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 9, marginTop: 10 },
});
