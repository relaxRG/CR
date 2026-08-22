/**
 * 葡萄酒详情页
 */
import React from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useWineStore } from "@/lib/wine/store";
import { WINE_STYLE_LABELS } from "@/lib/wine/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";

export default function WineDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bottles, deleteBottle, updateBottle, updateStock } = useWineStore();
  const bottle = bottles.find((b) => b.id === id);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  if (!bottle) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>找不到该酒款</Text>
        </View>
      </ScreenContainer>
    );
  }

  const purchaseChannels = bottle.purchaseChannelProjections ?? [];

  const handleDelete = () => {
    Alert.alert("删除", `确认删除「${bottle.name}」？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => { deleteBottle(bottle.id); router.back(); } },
    ]);
  };

  return (
    <ScreenContainer>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]} numberOfLines={1}>{bottle.name}</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => { tap(); router.push(`/wine-form?id=${bottle.id}` as any); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, marginRight: 12 })}>
          <Text style={[styles.editBtn, { color: colors.primary }]}>编辑</Text>
        </Pressable>
        <Pressable onPress={handleDelete} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="trash" size={20} color={colors.error} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 基本信息 */}
        <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.bigName, { color: colors.foreground }]}>{bottle.name}</Text>
          {bottle.nameEn ? <Text style={[styles.engName, { color: colors.muted }]}>{bottle.nameEn}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {bottle.vintage ? <View style={[styles.tag, { backgroundColor: colors.primary + "22" }]}><Text style={[styles.tagText, { color: colors.primary }]}>{bottle.vintage}</Text></View> : null}
            <View style={[styles.tag, { backgroundColor: colors.border }]}><Text style={[styles.tagText, { color: colors.muted }]}>{WINE_STYLE_LABELS[bottle.style]}</Text></View>
            {bottle.region ? <View style={[styles.tag, { backgroundColor: colors.border }]}><Text style={[styles.tagText, { color: colors.muted }]}>{bottle.region}</Text></View> : null}
            {bottle.grape ? <View style={[styles.tag, { backgroundColor: colors.border }]}><Text style={[styles.tagText, { color: colors.muted }]}>{bottle.grape}</Text></View> : null}
          </View>
        </View>

        {/* 价格、供应渠道与库存。渠道只能由已确认采购自动投影，禁止在此独立虚构。 */}
        <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.channelTitle, { color: colors.foreground }]}>采购价格与成本基准</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
            {bottle.costPrice != null && (
              <View style={{ alignItems: "center" }}>
                <Text style={[styles.priceLabel, { color: colors.muted }]}>进价</Text>
                <Text style={[styles.priceValue, { color: colors.foreground }]}>¥{bottle.costPrice}</Text>
              </View>
            )}
            {bottle.salePrice != null && (
              <View style={{ alignItems: "center" }}>
                <Text style={[styles.priceLabel, { color: colors.muted }]}>售价</Text>
                <Text style={[styles.priceValue, { color: colors.primary }]}>¥{bottle.salePrice}</Text>
              </View>
            )}
            <View style={{ alignItems: "center" }}>
              <Text style={[styles.priceLabel, { color: colors.muted }]}>库存</Text>
              <Text style={[styles.priceValue, { color: bottle.stock > 0 ? colors.success : colors.error }]}>{bottle.stock} 瓶</Text>
            </View>
          </View>
          {purchaseChannels.length > 0 ? <View style={{ marginTop: 16, gap: 8 }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>以下渠道和价格历史由已确认采购自动生成。点选渠道即可设为成本计算基准。</Text>
            {purchaseChannels.map((channel) => {
              const latest = channel.priceHistory[channel.priceHistory.length - 1];
              const selected = channel.id === bottle.costChannelId;
              return <Pressable key={channel.id} onPress={() => { tap(); updateBottle(bottle.id, { costChannelId: channel.id }); }} style={[styles.channelRow, { backgroundColor: selected ? colors.primary + "12" : colors.background, borderColor: selected ? colors.primary : colors.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{channel.type === "self_purchase" ? "自采／电商" : channel.supplier}</Text><Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{channel.supplierProductNames.join("、") || "采购名称待补充"} · {channel.priceHistory.length} 笔采购</Text></View>
                <View style={{ alignItems: "flex-end", marginLeft: 8 }}><Text style={{ color: selected ? colors.primary : colors.foreground, fontSize: 15, fontWeight: "700" }}>¥{latest?.unitPrice ?? "—"}</Text><Text style={{ color: selected ? colors.primary : colors.muted, fontSize: 11, marginTop: 2 }}>{selected ? "当前成本基准" : "设为成本基准"}</Text></View>
              </Pressable>;
            })}
            {purchaseChannels.map((channel) => <View key={`${channel.id}-history`} style={{ marginLeft: 8, gap: 3 }}>{channel.priceHistory.slice().reverse().slice(0, 4).map((entry) => <Text key={entry.sourcePurchaseId} style={{ color: colors.muted, fontSize: 11 }}>{channel.supplier} · {entry.date} · {entry.quantity} 瓶 × ¥{entry.unitPrice}</Text>)}</View>)}
          </View> : <Text style={{ color: colors.muted, fontSize: 12, marginTop: 16 }}>尚无已确认采购。请先从葡萄酒库存的采购记录人工确认链接后查看供应渠道和价格历史。</Text>}
          <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
            <Pressable onPress={() => { tap(); updateStock(bottle.id, 1); }}
              style={[styles.stockBtn, { backgroundColor: colors.success + "22", flex: 1 }]}>
              <IconSymbol name="plus" size={16} color={colors.success} />
              <Text style={{ color: colors.success, fontWeight: "600", marginLeft: 4 }}>入库</Text>
            </Pressable>
            <Pressable onPress={() => { tap(); if (bottle.stock > 0) updateStock(bottle.id, -1); }}
              style={[styles.stockBtn, { backgroundColor: colors.error + "22", flex: 1 }]}>
              <IconSymbol name="minus" size={16} color={colors.error} />
              <Text style={{ color: colors.error, fontWeight: "600", marginLeft: 4 }}>出库</Text>
            </Pressable>
          </View>
        </View>

        {/* 其他信息 */}
        {[
          bottle.winery && { label: "酒庄", value: bottle.winery },
          bottle.abv != null && { label: "酒精度", value: `${bottle.abv}%` },
          bottle.rating != null && { label: "评分", value: `${bottle.rating} / 100` },
          bottle.supplier && { label: "供应商", value: bottle.supplier },
        ].filter(Boolean).map((item: any) => (
          <View key={item.label} style={[styles.detailRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>{item.label}</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{item.value}</Text>
          </View>
        ))}

        {bottle.notes ? (
          <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.notesTitle, { color: colors.muted }]}>品鉴笔记</Text>
            <Text style={[styles.notesText, { color: colors.foreground }]}>{bottle.notes}</Text>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  navTitle: { fontSize: 17, fontWeight: "600", marginLeft: 8, flex: 1 },
  editBtn: { fontSize: 17, fontWeight: "500" },
  infoCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  bigName: { fontSize: 24, fontWeight: "700", lineHeight: 30 },
  engName: { fontSize: 15, lineHeight: 20, marginTop: 4 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 13, fontWeight: "500" },
  priceLabel: { fontSize: 13, marginBottom: 4 },
  priceValue: { fontSize: 20, fontWeight: "700" },
  channelTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  channelRow: { borderWidth: 1, borderRadius: 10, minHeight: 56, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center" },
  stockBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 10 },
  detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, borderWidth: 1, padding: 14 },
  detailLabel: { fontSize: 14 },
  detailValue: { fontSize: 14, fontWeight: "500" },
  notesTitle: { fontSize: 13, fontWeight: "500", marginBottom: 8 },
  notesText: { fontSize: 15, lineHeight: 22 },
});

