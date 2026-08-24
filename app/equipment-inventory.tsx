/**
 * 设备进销存独立页面
 * 特点：购入/折旧/维修记录，不是进货逻辑，关联备用金 E 类
 * Tab：设备台账 / 购入登记 / 维修记录 / 折旧汇总
 */
import React, { useState, useMemo } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEquipmentInventoryStore, EQUIPMENT_TYPES, EQUIPMENT_EXCEL_HINT, parseEquipmentExcel
} from "@/lib/equipment/inventory-store";
import { EquipmentItem, MaintenanceRecord, calcMonthlyDepreciation, calcBookValue, calcDepreciatedMonths } from "@/lib/inventory-core/types";

const EQUIP_COLOR = "#6366F1";
type Tab = "ledger" | "purchase" | "maintenance" | "depreciation";

// ─── 设备卡片 ─────────────────────────────────────────────────────────────────
function EquipmentCard({ item, onEdit, onMaintenance, colors }: {
  item: EquipmentItem; onEdit: () => void; onMaintenance: () => void; colors: any;
}) {
  const monthly = calcMonthlyDepreciation(item);
  const bookValue = calcBookValue(item);
  const months = calcDepreciatedMonths(item.purchaseDate);
  const typeLabel = EQUIPMENT_TYPES.find((t) => t.value === item.equipmentType)?.label ?? "设备";
  const statusColors = { normal: colors.success, repair: colors.warning, scrapped: colors.error };
  const statusLabels = { normal: "正常", repair: "维修中", scrapped: "已报废" };

  return (
    <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.name}</Text>
          <View style={[S.tag, { backgroundColor: EQUIP_COLOR + "22" }]}>
            <Text style={{ fontSize: 10, color: EQUIP_COLOR }}>{typeLabel}</Text>
          </View>
          <View style={[S.tag, { backgroundColor: statusColors[item.status] + "22" }]}>
            <Text style={{ fontSize: 10, color: statusColors[item.status] }}>{statusLabels[item.status]}</Text>
          </View>
        </View>
        {item.spec ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{item.spec}</Text> : null}
        <Text style={{ fontSize: 12, color: colors.muted }}>
          购入 {item.purchaseDate} · ¥{formatMoney(item.purchasePrice)} · 已用 {months} 个月
        </Text>
        <Text style={{ fontSize: 12, color: EQUIP_COLOR }}>
          月折旧 ¥{formatMoney(monthly)} · 账面净值 ¥{formatMoney(bookValue)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <TouchableOpacity onPress={onMaintenance} style={[S.btn, { backgroundColor: colors.warning + "22" }]}>
          <Text style={{ fontSize: 11, color: colors.warning, fontWeight: "600" }}>维修</Text>
        </TouchableOpacity>
        <Pressable onPress={onEdit} style={{ padding: 4 }}>
          <IconSymbol name="pencil" size={14} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

// ─── 购入登记 Modal ───────────────────────────────────────────────────────────
function PurchaseModal({ visible, item, colors, onSave, onClose }: {
  visible: boolean; item: EquipmentItem | null; colors: any;
  onSave: (data: Omit<EquipmentItem, "id" | "createdAt" | "updatedAt">) => void; onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [equipmentType, setEquipmentType] = useState(item?.equipmentType ?? "other");
  const [spec, setSpec] = useState(item?.spec ?? "");
  const [purchaseDate, setPurchaseDate] = useState(item?.purchaseDate ?? new Date().toISOString().slice(0, 10));
  const [purchasePrice, setPurchasePrice] = useState(String(item?.purchasePrice ?? ""));
  const [usefulLife, setUsefulLife] = useState(String(item?.usefulLifeYears ?? 5));
  const [residualRate, setResidualRate] = useState(String(item?.residualRate ?? 0));
  const [supplier, setSupplier] = useState(item?.supplier ?? "");
  const [status, setStatus] = useState<EquipmentItem["status"]>(item?.status ?? "normal");

  React.useEffect(() => {
    if (visible && item) {
      setName(item.name); setEquipmentType(item.equipmentType); setSpec(item.spec);
      setPurchaseDate(item.purchaseDate); setPurchasePrice(String(item.purchasePrice));
      setUsefulLife(String(item.usefulLifeYears)); setResidualRate(String(item.residualRate));
      setSupplier(item.supplier); setStatus(item.status);
    } else if (visible && !item) {
      setName(""); setEquipmentType("other"); setSpec(""); setPurchaseDate(new Date().toISOString().slice(0, 10));
      setPurchasePrice(""); setUsefulLife("5"); setResidualRate("0"); setSupplier(""); setStatus("normal");
    }
  }, [visible, item]);

  const monthly = useMemo(() => {
    const price = Number(purchasePrice) || 0;
    const life = Number(usefulLife) || 5;
    const residual = Number(residualRate) || 0;
    if (price <= 0 || life <= 0) return 0;
    return Math.round((price * (1 - residual / 100) / (life * 12)) * 100) / 100;
  }, [purchasePrice, usefulLife, residualRate]);

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("请填写设备名称"); return; }
    onSave({ name: name.trim(), equipmentType, spec: spec.trim(), purchaseDate, purchasePrice: Number(purchasePrice) || 0, usefulLifeYears: Number(usefulLife) || 5, residualRate: Number(residualRate) || 0, status, supplier: supplier.trim(), notes: "", active: true });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.title, { color: colors.foreground }]}>{item ? "编辑设备" : "购入登记"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: EQUIP_COLOR }}>保存</Text></Pressable>
          </View>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
            {[
              { label: "设备名称 *", value: name, onChange: setName, placeholder: "如 制冰机" },
              { label: "规格/型号", value: spec, onChange: setSpec, placeholder: "可选" },
              { label: "购入日期", value: purchaseDate, onChange: setPurchaseDate, placeholder: "YYYY-MM-DD" },
              { label: "购入价格（元）", value: purchasePrice, onChange: setPurchasePrice, placeholder: "0.00", kb: "decimal-pad" as const },
              { label: "预计使用年限（年）", value: usefulLife, onChange: setUsefulLife, placeholder: "5", kb: "decimal-pad" as const },
              { label: "残值率（%，通常填 0）", value: residualRate, onChange: setResidualRate, placeholder: "0", kb: "decimal-pad" as const },
              { label: "供应商/品牌", value: supplier, onChange: setSupplier, placeholder: "可选" },
            ].map((f, i) => (
              <View key={i}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
                  placeholderTextColor={colors.muted} keyboardType={(f as any).kb ?? "default"}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            ))}

            {/* 月折旧预览 */}
            {monthly > 0 && (
              <View style={[S.totalRow, { backgroundColor: EQUIP_COLOR + "0a" }]}>
                <Text style={{ fontSize: 13, color: colors.muted }}>月折旧金额</Text>
                <Text style={{ fontSize: 18, fontWeight: "700", color: EQUIP_COLOR }}>¥{formatMoney(monthly)}/月</Text>
              </View>
            )}

            {/* 设备类型 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>设备类型</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {EQUIPMENT_TYPES.map((t) => (
                  <TouchableOpacity key={t.value} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} onPress={() => setEquipmentType(t.value)}
                    style={[S.chip, {
                      backgroundColor: equipmentType === t.value ? EQUIP_COLOR : colors.surface,
                      borderColor: equipmentType === t.value ? EQUIP_COLOR : colors.border,
                    }]}>
                    <Text style={{ fontSize: 12, color: equipmentType === t.value ? "#fff" : colors.muted }}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 状态 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>当前状态</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                {([["normal", "正常", colors.success], ["repair", "维修中", colors.warning], ["scrapped", "已报废", colors.error]] as const).map(([v, l, c]) => (
                  <TouchableOpacity key={v} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} onPress={() => setStatus(v)}
                    style={[S.chip, { backgroundColor: status === v ? c : colors.surface, borderColor: status === v ? c : colors.border }]}>
                    <Text style={{ fontSize: 12, color: status === v ? "#fff" : colors.muted }}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 维修记录 Modal ───────────────────────────────────────────────────────────
function MaintenanceModal({ visible, items, colors, onSave, onClose }: {
  visible: boolean; items: EquipmentItem[]; colors: any;
  onSave: (data: Omit<MaintenanceRecord, "id" | "createdAt">) => void; onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [vendor, setVendor] = useState("");

  const handleSave = () => {
    if (!selectedId) { Alert.alert("请选择设备"); return; }
    if (!description.trim()) { Alert.alert("请填写维修内容"); return; }
    const selectedItem = items.find((i) => i.id === selectedId);
    onSave({ equipmentId: selectedId, equipmentName: selectedItem?.name ?? "", date, description: description.trim(), cost: Number(cost) || 0, vendor: vendor.trim(), notes: "" });
    setSelectedId(""); setDate(new Date().toISOString().slice(0, 10)); setDescription(""); setCost(""); setVendor("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.title, { color: colors.foreground }]}>维修记录</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.warning }}>保存</Text></Pressable>
          </View>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
            <View>
              <Text style={[S.label, { color: colors.muted }]}>选择设备 *</Text>
              <ScrollView horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} contentContainerStyle={{ paddingHorizontal: 4, gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {items.filter((i) => i.active).map((item) => (
                    <TouchableOpacity key={item.id} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} onPress={() => setSelectedId(item.id)}
                      style={[S.chip, {
                        backgroundColor: selectedId === item.id ? colors.warning : colors.surface,
                        borderColor: selectedId === item.id ? colors.warning : colors.border,
                      }]}>
                      <Text style={{ fontSize: 13, color: selectedId === item.id ? "#fff" : colors.foreground }}>{item.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
            {[
              { label: "维修日期", value: date, onChange: setDate, placeholder: "YYYY-MM-DD" },
              { label: "维修费用（元）", value: cost, onChange: setCost, placeholder: "0.00", kb: "decimal-pad" as const },
              { label: "维修供应商/维修人", value: vendor, onChange: setVendor, placeholder: "可选" },
            ].map((f, i) => (
              <View key={i}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
                  placeholderTextColor={colors.muted} keyboardType={(f as any).kb ?? "default"}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            ))}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>维修内容 *</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder="描述维修内容"
                placeholderTextColor={colors.muted} multiline numberOfLines={3}
                style={[S.textarea, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export interface EquipmentInventoryScreenProps {
  month?: string;
  embedded?: boolean;
}

export default function EquipmentInventoryScreen({ month, embedded = false }: EquipmentInventoryScreenProps) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const store = useEquipmentInventoryStore();

  const [tab, setTab] = useState<Tab>("ledger");
  const [showPurchase, setShowPurchase] = useState(false);
  const [editItem, setEditItem] = useState<EquipmentItem | null>(null);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [, setMaintenanceItem] = useState<EquipmentItem | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  const currentMonth = month ?? new Date().toISOString().slice(0, 7);
  const totalMonthlyDepreciation = store.getTotalMonthlyDepreciation();
  const monthMaintenanceCost = store.getMonthMaintenanceCost(currentMonth);
  const totalBookValue = useMemo(() => store.items.filter((i) => i.active).reduce((s, i) => s + calcBookValue(i), 0), [store.items]);
  const totalPurchaseValue = useMemo(() => store.items.filter((i) => i.active).reduce((s, i) => s + i.purchasePrice, 0), [store.items]);

  const handlePickExcel = async () => {
    if (importLoading) return;
    tap();
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if ((asset.size ?? 0) > 10 * 1024 * 1024) {
        Alert.alert("文件过大", "设备导入文件不能超过 10MB，请拆分后再导入。");
        return;
      }
      setImportLoading(true);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const { items: parsed, error } = await parseEquipmentExcel(base64);
      setImportLoading(false);
      if (!parsed?.length) { Alert.alert("解析失败", error ?? "未能识别设备数据"); return; }
      parsed.forEach((item) => store.addItem(item));
      Alert.alert("导入成功", `已导入 ${parsed.length} 台设备`);
    } catch (e) {
      setImportLoading(false);
      Alert.alert("导入失败", String(e));
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "ledger", label: "设备台账" },
    { key: "purchase", label: "购入登记" },
    { key: "maintenance", label: "维修记录" },
    { key: "depreciation", label: "折旧汇总" },
  ];

  return (
    <ScreenContainer edges={embedded ? [] : undefined}>
      {/* 独立路由才保留返回导航；工作台已提供分类与月份层级。 */}
      {!embedded && <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>🔧 设备进销存</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={handlePickExcel} disabled={importLoading} style={({ pressed }) => ({ opacity: importLoading ? 0.45 : pressed ? 0.7 : 1 })}>
            <IconSymbol name="arrow.down.doc.fill" size={20} color={EQUIP_COLOR} />
          </Pressable>
          <Pressable onPress={() => { tap(); setEditItem(null); setShowPurchase(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="plus" size={22} color={EQUIP_COLOR} />
          </Pressable>
        </View>
      </View>}

      {/* Tab */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} testID={`equipment-tab-${t.key}`} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} onPress={() => { tap(); setTab(t.key); }}
            style={[S.tabChip, {
              backgroundColor: tab === t.key ? EQUIP_COLOR : colors.surface,
              borderColor: tab === t.key ? EQUIP_COLOR : colors.border,
            }]}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: tab === t.key ? "#fff" : colors.muted }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* 汇总行 */}
      <View style={[S.summaryRow, { borderBottomColor: colors.border }]}>
        {[
          { label: "设备数量", value: `${store.items.filter((i) => i.active).length}`, unit: "台", color: EQUIP_COLOR },
          { label: "原值合计", value: `¥${formatMoney(totalPurchaseValue)}`, unit: "", color: colors.foreground },
          { label: "账面净值", value: `¥${formatMoney(totalBookValue)}`, unit: "", color: EQUIP_COLOR },
          { label: "月折旧", value: `¥${formatMoney(totalMonthlyDepreciation)}`, unit: "", color: colors.warning },
        ].map((c, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 10, color: colors.muted }}>{c.label}</Text>
            <Text style={{ fontSize: 14, fontWeight: "700", color: c.color }}>{c.value}{c.unit}</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 设备台账 */}
        {tab === "ledger" && (
          store.items.filter((i) => i.active).length === 0 ? (
            <View style={{ alignItems: "center", padding: 40 }}>
              <Text style={{ fontSize: 48 }}>🔧</Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有设备档案</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>点击右上角 + 登记设备，或导入 Excel</Text>
              <View style={{ marginTop: 16, borderRadius: 10, borderWidth: 1, borderColor: EQUIP_COLOR + "33", backgroundColor: EQUIP_COLOR + "08", padding: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: EQUIP_COLOR, marginBottom: 4 }}>📋 Excel 导入格式</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{EQUIPMENT_EXCEL_HINT}</Text>
              </View>
            </View>
          ) : (
            store.items.filter((i) => i.active).map((item) => (
              <EquipmentCard key={item.id} item={item} colors={colors}
                onEdit={() => { tap(); setEditItem(item); setShowPurchase(true); }}
                onMaintenance={() => { tap(); setMaintenanceItem(item); setShowMaintenance(true); }} />
            ))
          )
        )}

        {/* 购入登记 Tab */}
        {tab === "purchase" && (
          <View style={{ gap: 8 }}>
            <TouchableOpacity onPress={() => { tap(); setEditItem(null); setShowPurchase(true); }}
              style={{ backgroundColor: EQUIP_COLOR, borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>+ 登记新设备</Text>
            </TouchableOpacity>
            <View style={[S.hintCard, { backgroundColor: EQUIP_COLOR + "08", borderColor: EQUIP_COLOR + "22" }]}>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                💡 购入设备后请在此登记，系统将自动计算月折旧金额，用于月度成本核算
              </Text>
            </View>
          </View>
        )}

        {/* 维修记录 Tab */}
        {tab === "maintenance" && (
          <View style={{ gap: 8 }}>
            <TouchableOpacity onPress={() => { tap(); setMaintenanceItem(null); setShowMaintenance(true); }}
              style={{ backgroundColor: colors.warning, borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>🔨 录入维修记录</Text>
            </TouchableOpacity>
            {store.maintenanceRecords.length === 0 ? (
              <Text style={{ textAlign: "center", padding: 20, color: colors.muted }}>暂无维修记录</Text>
            ) : (
              [...store.maintenanceRecords].sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
                <View key={r.id} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{r.equipmentName}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{r.date} · {r.vendor || "维修"}</Text>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>{r.description}</Text>
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: colors.warning }}>¥{formatMoney(r.cost)}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* 折旧汇总 Tab */}
        {tab === "depreciation" && (
          <View style={{ gap: 12 }}>
            <View style={[S.summaryCard, { backgroundColor: EQUIP_COLOR + "0a", borderColor: EQUIP_COLOR + "22" }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: EQUIP_COLOR, marginBottom: 8 }}>折旧汇总</Text>
              {[
                { label: "本月折旧总额", value: `¥${formatMoney(totalMonthlyDepreciation)}`, color: EQUIP_COLOR },
                { label: "本月维修费用", value: `¥${formatMoney(monthMaintenanceCost)}`, color: colors.warning },
                { label: "本月设备成本", value: `¥${formatMoney((totalMonthlyDepreciation + monthMaintenanceCost))}`, color: colors.foreground },
                { label: "设备账面净值", value: `¥${formatMoney(totalBookValue)}`, color: EQUIP_COLOR },
              ].map((row, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: row.color }}>{row.value}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>各设备折旧明细</Text>
            {store.items.filter((i) => i.active && i.status !== "scrapped").map((item) => {
              const monthly = calcMonthlyDepreciation(item);
              const bookVal = calcBookValue(item);
              return (
                <View key={item.id} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>
                      原值 ¥{formatMoney(item.purchasePrice)} · 使用年限 {item.usefulLifeYears} 年
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: EQUIP_COLOR }}>¥{formatMoney(monthly)}/月</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>净值 ¥{formatMoney(bookVal)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <PurchaseModal visible={showPurchase} item={editItem} colors={colors}
        onSave={(data) => { if (editItem) store.updateItem(editItem.id, data); else store.addItem(data); }}
        onClose={() => setShowPurchase(false)} />

      <MaintenanceModal visible={showMaintenance} items={store.items} colors={colors}
        onSave={(data) => store.addMaintenance(data)}
        onClose={() => setShowMaintenance(false)} />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  tabChip: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  summaryRow: { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  card: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  btn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 80 },
  chip: { minHeight: 40, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  totalRow: { borderRadius: 10, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  hintCard: { borderRadius: 10, borderWidth: 1, padding: 12 },
});
