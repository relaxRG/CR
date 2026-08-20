/**
 * 供货渠道管理页
 * 路由：/bottle-channels?id=<bottleId>
 * 功能：
 * - 查看该酒款的所有供货渠道（供应商/自采电商）
 * - 添加/编辑/删除渠道
 * - 设置成本计算基准渠道
 * - 自采渠道支持粘贴购买链接（京东/淘宝/1919等），一键跳转
 * - 查看历史进货价记录
 */
import React, { useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useBottleStore } from "@/lib/bottles/store";
import { createSupplierChannelPurchaseName, getEffectiveCostPrice, getSupplierChannelPurchaseNames, normalizeSupplierChannels, resolveCostChannelId, SupplierChannel, SupplierPriceRecord } from "@/lib/bottles/types";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── 渠道表单 Modal ───────────────────────────────────────────────────────────
function ChannelFormModal({ visible, channel, colors, onSave, onClose }: {
  visible: boolean;
  channel: SupplierChannel | null;
  colors: any;
  onSave: (data: Omit<SupplierChannel, "id" | "createdAt" | "updatedAt" | "priceHistory">) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<"supplier" | "self">(channel?.type ?? "supplier");
  const [name, setName] = useState(channel?.name ?? "");
  const [purchaseNamesText, setPurchaseNamesText] = useState(getSupplierChannelPurchaseNames(channel ?? {}).map((entry) => entry.name).join("\n"));
  const [latestPrice, setLatestPrice] = useState(channel?.latestPrice ? String(channel.latestPrice) : "");
  const [unit, setUnit] = useState(channel?.unit ?? "瓶");
  const [purchaseUrl, setPurchaseUrl] = useState(channel?.purchaseUrl ?? "");
  const [isCostBasis, setIsCostBasis] = useState(channel?.isCostBasis ?? false);
  const [notes, setNotes] = useState(channel?.notes ?? "");

  React.useEffect(() => {
    if (visible) {
      setType(channel?.type ?? "supplier");
      setName(channel?.name ?? "");
      setPurchaseNamesText(getSupplierChannelPurchaseNames(channel ?? {}).map((entry) => entry.name).join("\n"));
      setLatestPrice(channel?.latestPrice ? String(channel.latestPrice) : "");
      setUnit(channel?.unit ?? "瓶");
      setPurchaseUrl(channel?.purchaseUrl ?? "");
      setIsCostBasis(channel?.isCostBasis ?? false);
      setNotes(channel?.notes ?? "");
    }
  }, [visible, channel]);

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("请填写渠道名称"); return; }
    if (!latestPrice || Number(latestPrice) <= 0) { Alert.alert("请填写进货价格"); return; }
    const purchaseNames = purchaseNamesText
      .split(/\n|\r|,|，|、/)
      .map((value) => createSupplierChannelPurchaseName(value))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    onSave({
      type, name: name.trim(),
      ...(purchaseNames[0] ? { supplierProductName: purchaseNames[0].name } : {}),
      ...(purchaseNames.length > 0 ? { purchaseNames } : {}),
      latestPrice: Number(latestPrice),
      unit: unit.trim() || "瓶",
      purchaseUrl: purchaseUrl.trim() || undefined,
      isCostBasis,
      notes: notes.trim() || undefined,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>{channel ? "编辑渠道" : "添加渠道"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
            {/* 渠道类型 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>渠道类型</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {([["supplier", "🏢 供应商"], ["self", "🛒 自采电商"]] as const).map(([key, label]) => (
                  <TouchableOpacity key={key} onPress={() => setType(key)}
                    style={[S.typeBtn, {
                      backgroundColor: type === key ? colors.primary + "22" : colors.surface,
                      borderColor: type === key ? colors.primary : colors.border,
                    }]}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: type === key ? colors.primary : colors.muted }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 渠道名称 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>
                {type === "supplier" ? "供应商名称 *" : "渠道名称 *（如：京东自采、1919）"}
              </Text>
              <TextInput value={name} onChangeText={setName}
                placeholder={type === "supplier" ? "如：至缘、戎恒" : "如：京东自采、1919酒类"}
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
            </View>

            {/* 渠道采购名称：允许现名、旧名和简称共同参与智能匹配。 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>
                {type === "supplier" ? "供应商采购名称（可选）" : "平台商品名称（可选）"}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>
                一行一个名称；可同时记录现名、旧名和简称，用于导入、手动进货和智能链接匹配。
              </Text>
              <TextInput value={purchaseNamesText} onChangeText={setPurchaseNamesText}
                multiline
                placeholder={type === "supplier" ? "如：君度 FP\n君度橙味利口酒" : "如：君度橙味利口酒 700ml\nCointreau 700ml"}
                placeholderTextColor={colors.muted}
                style={[S.input, { minHeight: 88, textAlignVertical: "top", color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
            </View>

            {/* 进货价格 */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 2 }}>
                <Text style={[S.label, { color: colors.muted }]}>最新进货价（元）*</Text>
                <TextInput value={latestPrice} onChangeText={setLatestPrice}
                  placeholder="0.00" keyboardType="decimal-pad"
                  placeholderTextColor={colors.muted}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.label, { color: colors.muted }]}>单位</Text>
                <TextInput value={unit} onChangeText={setUnit}
                  placeholder="瓶/箱" placeholderTextColor={colors.muted}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
              </View>
            </View>

            {/* 购买链接（自采渠道） */}
            {type === "self" && (
              <View>
                <Text style={[S.label, { color: colors.muted }]}>购买链接（粘贴后一键跳转）</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>
                  支持京东、淘宝、1919、酒仙网等电商链接
                </Text>
                <TextInput value={purchaseUrl} onChangeText={setPurchaseUrl}
                  placeholder="https://item.jd.com/..."
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none" autoCorrect={false}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
                {purchaseUrl.trim() ? (
                  <TouchableOpacity onPress={() => Linking.openURL(purchaseUrl.trim())}
                    style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <IconSymbol name="arrow.up.right.square" size={14} color={colors.primary} />
                    <Text style={{ fontSize: 12, color: colors.primary }}>测试链接</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}

            {/* 成本基准 */}
            <TouchableOpacity onPress={() => setIsCostBasis(!isCostBasis)}
              style={[S.toggleRow, { backgroundColor: isCostBasis ? colors.primary + "15" : colors.surface, borderColor: isCostBasis ? colors.primary + "44" : colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>设为成本计算基准</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  鸡尾酒成本配方将使用此渠道的进货价计算
                </Text>
              </View>
              <View style={[S.checkbox, { backgroundColor: isCostBasis ? colors.primary : "transparent", borderColor: isCostBasis ? colors.primary : colors.border }]}>
                {isCostBasis && <IconSymbol name="checkmark" size={12} color="#fff" />}
              </View>
            </TouchableOpacity>

            {/* 备注 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>备注（可选）</Text>
              <TextInput value={notes} onChangeText={setNotes}
                placeholder="如：每周三送货、需提前一天订货"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function BottleChannelsScreen() {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { id } = useLocalSearchParams<{ id: string }>();
  const { getBottle, updateBottle } = useBottleStore();
  const bottle = getBottle(id);

  const [showForm, setShowForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<SupplierChannel | null>(null);
  const [priceHistoryChannel, setPriceHistoryChannel] = useState<SupplierChannel | null>(null);

  if (!bottle) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>未找到酒款</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: colors.primary }}>返回</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const channels = bottle.supplierChannels ?? [];
  const effectivePrice = getEffectiveCostPrice(bottle);

  const handleSaveChannel = (data: Omit<SupplierChannel, "id" | "createdAt" | "updatedAt" | "priceHistory">) => {
    const now = new Date().toISOString();
    let updatedChannels: SupplierChannel[];

    if (editingChannel) {
      // 编辑现有渠道
      const oldChannel = channels.find((c) => c.id === editingChannel.id)!;
      const priceChanged = oldChannel.latestPrice !== data.latestPrice;
      updatedChannels = channels.map((c) => {
        if (c.id === editingChannel.id) {
          const newHistory: SupplierPriceRecord[] = priceChanged
            ? [{ date: now.slice(0, 10), price: data.latestPrice, source: "手动录入" }, ...(c.priceHistory ?? [])]
            : c.priceHistory ?? [];
          return { ...c, ...data, id: c.id, createdAt: c.createdAt, updatedAt: now, priceHistory: newHistory };
        }
        // 如果新渠道设为成本基准，清除其他渠道的基准标记
        if (data.isCostBasis) return { ...c, isCostBasis: false };
        return c;
      });
    } else {
      // 新增渠道
      const newChannel: SupplierChannel = {
        ...data, id: uuid(), createdAt: now, updatedAt: now,
        priceHistory: [{ date: now.slice(0, 10), price: data.latestPrice, source: "手动录入" }],
      };
      // 如果新渠道设为成本基准，清除其他渠道的基准标记
      updatedChannels = data.isCostBasis
        ? [...channels.map((c) => ({ ...c, isCostBasis: false })), newChannel]
        : [...channels, newChannel];
    }

    const activeChannelId = editingChannel?.id ?? updatedChannels.at(-1)?.id;
    const requestedCostChannelId = data.isCostBasis && activeChannelId ? activeChannelId : bottle.costChannelId;
    const normalizedChannels = normalizeSupplierChannels(updatedChannels, requestedCostChannelId);
    const basisChannelId = resolveCostChannelId(normalizedChannels, requestedCostChannelId);
    const basisChannel = normalizedChannels.find((channel) => channel.id === basisChannelId);

    updateBottle(bottle.id, {
      ...bottle,
      supplierChannels: normalizedChannels,
      ...(basisChannelId ? { costChannelId: basisChannelId } : { costChannelId: undefined }),
      ...(basisChannel ? { priceCny: basisChannel.latestPrice } : {}),
    });
  };

  const handleDeleteChannel = (channelId: string) => {
    if (channelId === resolveCostChannelId(channels, bottle.costChannelId) && channels.length > 1) {
      Alert.alert("请先切换成本基准", "当前渠道正在用于成本计算。请先在另一条渠道上选择“设为成本计算基准”，再删除此渠道。");
      return;
    }
    Alert.alert("删除渠道", "确认删除此供货渠道？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除", style: "destructive", onPress: () => {
          const updatedChannels = channels.filter((c) => c.id !== channelId);
          const normalizedChannels = normalizeSupplierChannels(updatedChannels, bottle.costChannelId === channelId ? undefined : bottle.costChannelId);
          const basisChannelId = resolveCostChannelId(normalizedChannels, bottle.costChannelId === channelId ? undefined : bottle.costChannelId);
          updateBottle(bottle.id, { ...bottle, supplierChannels: normalizedChannels, ...(basisChannelId ? { costChannelId: basisChannelId } : { costChannelId: undefined }) });
        },
      },
    ]);
  };

  const handleSetCostBasis = (channelId: string) => {
    const updatedChannels = normalizeSupplierChannels(channels.map((c) => ({ ...c, isCostBasis: c.id === channelId })), channelId);
    const basisChannel = updatedChannels.find((c) => c.id === channelId)!;
    updateBottle(bottle.id, { ...bottle, supplierChannels: updatedChannels, costChannelId: channelId, priceCny: basisChannel.latestPrice });
    Alert.alert("已设置", `成本计算基准已切换为「${basisChannel.name}」\n进货价：¥${basisChannel.latestPrice}/${basisChannel.unit}`);
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]} numberOfLines={1}>
          供货渠道管理
        </Text>
        <TouchableOpacity onPress={() => { tap(); setEditingChannel(null); setShowForm(true); }}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <IconSymbol name="plus.circle.fill" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* 酒款信息 */}
        <View style={[S.bottleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{bottle.nameZh}</Text>
          {bottle.nameEn ? <Text style={{ fontSize: 13, color: colors.muted }}>{bottle.nameEn}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>当前成本计算价：</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.primary }}>¥{formatMoney(effectivePrice)}</Text>
            {channels.find((c) => c.isCostBasis) && (
              <Text style={{ fontSize: 11, color: colors.muted }}>
                （来自「{channels.find((c) => c.isCostBasis)!.name}」）
              </Text>
            )}
          </View>
        </View>

        {/* 渠道列表 */}
        {channels.length === 0 ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 40 }}>🏢</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>
              还没有供货渠道
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
              点击右上角「+」添加供应商或自采电商渠道
            </Text>
            <TouchableOpacity onPress={() => { tap(); setEditingChannel(null); setShowForm(true); }}
              style={[S.addBtn, { backgroundColor: colors.primary }]}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: "#fff" }}>添加第一个渠道</Text>
            </TouchableOpacity>
          </View>
        ) : (
          channels.map((ch) => (
            <View key={ch.id} style={[S.channelCard, { backgroundColor: colors.surface, borderColor: ch.isCostBasis ? colors.primary : colors.border }]}>
              {/* 渠道头部 */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{ch.name}</Text>
                    {ch.isCostBasis && (
                      <View style={{ backgroundColor: colors.primary + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>✓ 成本基准</Text>
                      </View>
                    )}
                    {ch.type === "self" && (
                      <View style={{ backgroundColor: "#F59E0B22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#F59E0B" }}>🛒 自采</Text>
                      </View>
                    )}
                  </View>
                  {getSupplierChannelPurchaseNames(ch).length > 0 && (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }} numberOfLines={2}>
                      采购名称：{getSupplierChannelPurchaseNames(ch).map((entry) => entry.name).join("、")}
                    </Text>
                  )}
                </View>
                {/* 操作按钮 */}
                <View style={{ flexDirection: "row", gap: 8, marginLeft: 8 }}>
                  <TouchableOpacity onPress={() => { tap(); setEditingChannel(ch); setShowForm(true); }}
                    style={[S.iconBtn, { borderColor: colors.border }]}>
                    <IconSymbol name="pencil" size={14} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { tap(); handleDeleteChannel(ch.id); }}
                    style={[S.iconBtn, { borderColor: colors.border }]}>
                    <IconSymbol name="trash" size={14} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* 价格信息 */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
                <View>
                  <Text style={{ fontSize: 11, color: colors.muted }}>最新进货价</Text>
                  <Text style={{ fontSize: 20, fontWeight: "700", color: ch.isCostBasis ? colors.primary : colors.foreground }}>
                    ¥{formatMoney(ch.latestPrice)}
                    <Text style={{ fontSize: 13, fontWeight: "400", color: colors.muted }}>/{ch.unit}</Text>
                  </Text>
                </View>
                {(ch.priceHistory ?? []).length > 0 && (
                  <TouchableOpacity onPress={() => { tap(); setPriceHistoryChannel(ch); }} style={{ flex: 1, alignItems: "flex-start" }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>价格变化</Text>
                    <Text style={{ fontSize: 12, color: colors.primary, marginTop: 2 }}>
                      查看 {(ch.priceHistory ?? []).length} 条记录
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* 购买链接（自采渠道） */}
              {ch.purchaseUrl && (
                <TouchableOpacity onPress={() => { tap(); Linking.openURL(ch.purchaseUrl!); }}
                  style={[S.purchaseBtn, { backgroundColor: "#F59E0B" }]}>
                  <IconSymbol name="cart.fill" size={14} color="#fff" />
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>一键跳转购买</Text>
                  <Text style={{ fontSize: 11, color: "#fff88" }} numberOfLines={1}>
                    {ch.purchaseUrl.replace(/https?:\/\//, "").slice(0, 30)}...
                  </Text>
                </TouchableOpacity>
              )}

              {/* 设为成本基准按钮（非基准渠道显示） */}
              {!ch.isCostBasis && (
                <TouchableOpacity onPress={() => { tap(); handleSetCostBasis(ch.id); }}
                  style={[S.basisBtn, { borderColor: colors.primary + "44" }]}>
                  <IconSymbol name="checkmark.circle" size={14} color={colors.primary} />
                  <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>设为成本计算基准</Text>
                </TouchableOpacity>
              )}

              {ch.notes && (
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>备注：{ch.notes}</Text>
              )}
            </View>
          ))
        )}

        {/* 说明 */}
        <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 16, lineHeight: 18 }}>
          成本基准渠道的进货价将自动同步到鸡尾酒成本配方计算中{"\n"}
          可随时切换不同渠道作为成本基准
        </Text>
      </ScrollView>

      <Modal
        visible={Boolean(priceHistoryChannel)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPriceHistoryChannel(null)}
      >
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setPriceHistoryChannel(null)}><Text style={{ fontSize: 17, color: colors.primary }}>完成</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]} numberOfLines={1}>价格变化</Text>
            <View style={{ width: 34 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>{priceHistoryChannel?.name}</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 12 }}>
              当前价格与所有历史报价；历史记录不会因渠道名称修改或删除而改写采购流水。
            </Text>
            {(priceHistoryChannel?.priceHistory ?? [])
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((record, index, records) => (
                <View key={`${record.date}-${record.price}-${index}`} style={{ paddingVertical: 12, borderBottomWidth: index < records.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View>
                    <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "500" }}>{record.date}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>
                      {record.source ?? "手动录入"}{record.quantity ? ` · ${record.quantity} 件` : ""}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 17, color: colors.foreground, fontWeight: "600" }}>¥{formatMoney(record.price)}</Text>
                </View>
              ))}
          </ScrollView>
        </View>
      </Modal>

      <ChannelFormModal
        visible={showForm}
        channel={editingChannel}
        colors={colors}
        onSave={handleSaveChannel}
        onClose={() => { setShowForm(false); setEditingChannel(null); }}
      />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "700", flex: 1, textAlign: "center" },
  bottleCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  channelCard: { borderRadius: 12, borderWidth: 1.5, padding: 14, marginBottom: 12 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  label: { fontSize: 13, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  typeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  toggleRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  purchaseBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 10, marginTop: 10 },
  basisBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, borderWidth: 1, padding: 8, marginTop: 8, justifyContent: "center" },
  iconBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  addBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
});
