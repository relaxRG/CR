/**
 * 啤酒 + 冰块 + 水果进销存主页面
 * - Tab 切换：啤酒 / 冰块 / 水果
 * - 台账视图：库存列表、进货记录
 * - 进货录入（关联备用金）
 * - 库存预警
 */
import React, { useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useBeerStore } from "@/lib/beer/store";
import { useIceInventoryStore } from "@/lib/ice/inventory-store";
import { useFruitStore } from "@/lib/fruit/store";
import { BeerItem, PACKAGE_TYPE_LABELS, calcBeerMargin } from "@/lib/beer/types";
import { IceInventoryItem } from "@/lib/ice/inventory";
import { FruitItem, FruitCategory, FruitUnit, FRUIT_CATEGORY_LABELS, FRUIT_CATEGORY_COLORS, FRUIT_UNIT_LABELS } from "@/lib/fruit/types";

type MainTab = "beer" | "ice" | "fruit";

const BEER_COLOR = "#F4A300";
const ICE_COLOR = "#00BCD4";
const FRUIT_COLOR = "#22C55E";

// ─── 啤酒条目卡片 ─────────────────────────────────────────────────────────────
function BeerItemCard({ item, onIn, onOut, onEdit, colors }: {
  item: BeerItem; onIn: () => void; onOut: () => void; onEdit: () => void; colors: any;
}) {
  const lowStock = item.currentStock <= item.alertThreshold;
  const margin = calcBeerMargin(item.latestCostPrice, item.sellingPrice);
  return (
    <View style={[BC.card, { backgroundColor: colors.surface, borderColor: lowStock ? colors.error : colors.border }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.name}</Text>
          <View style={[BC.tag, { backgroundColor: BEER_COLOR + "22" }]}>
            <Text style={{ fontSize: 10, color: BEER_COLOR }}>{PACKAGE_TYPE_LABELS[item.packageType]}</Text>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
          {item.spec} · 进价¥{formatMoney(item.latestCostPrice)} · 售价¥{formatMoney(item.sellingPrice)} · 毛利{margin}%
        </Text>
        {item.supplier ? <Text style={{ fontSize: 11, color: colors.muted }}>{item.supplier}</Text> : null}
        {lowStock && <Text style={{ fontSize: 11, color: colors.error, marginTop: 2 }}>⚠ 库存不足（预警线：{item.alertThreshold}）</Text>}
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={[BC.stock, { color: lowStock ? colors.error : BEER_COLOR }]}>{item.currentStock} 瓶</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <TouchableOpacity onPress={onIn} style={[BC.btn, { backgroundColor: BEER_COLOR + "22" }]}>
            <Text style={{ fontSize: 12, color: BEER_COLOR, fontWeight: "600" }}>入库</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOut} style={[BC.btn, { backgroundColor: colors.error + "15" }]}>
            <Text style={{ fontSize: 12, color: colors.error, fontWeight: "600" }}>出库</Text>
          </TouchableOpacity>
          <Pressable onPress={onEdit} style={{ padding: 4 }}>
            <IconSymbol name="pencil" size={14} color={colors.muted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── 冰块条目卡片 ─────────────────────────────────────────────────────────────
function IceItemCard({ item, onIn, onOut, onEdit, colors }: {
  item: IceInventoryItem; onIn: () => void; onOut: () => void; onEdit: () => void; colors: any;
}) {
  const lowStock = item.currentStock <= item.alertThreshold;
  return (
    <View style={[BC.card, { backgroundColor: colors.surface, borderColor: lowStock ? colors.error : colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.name}</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
          {item.spec} · 进价¥{formatMoney(item.latestCostPrice)}/{item.unit}
        </Text>
        {item.supplier ? <Text style={{ fontSize: 11, color: colors.muted }}>{item.supplier}</Text> : null}
        {lowStock && <Text style={{ fontSize: 11, color: colors.error, marginTop: 2 }}>⚠ 库存不足</Text>}
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={[BC.stock, { color: lowStock ? colors.error : ICE_COLOR }]}>{item.currentStock} {item.unit}</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <TouchableOpacity onPress={onIn} style={[BC.btn, { backgroundColor: ICE_COLOR + "22" }]}>
            <Text style={{ fontSize: 12, color: ICE_COLOR, fontWeight: "600" }}>入库</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOut} style={[BC.btn, { backgroundColor: colors.error + "15" }]}>
            <Text style={{ fontSize: 12, color: colors.error, fontWeight: "600" }}>出库</Text>
          </TouchableOpacity>
          <Pressable onPress={onEdit} style={{ padding: 4 }}>
            <IconSymbol name="pencil" size={14} color={colors.muted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── 水果条目卡片 ─────────────────────────────────────────────────────────────
function FruitItemCard({ item, onIn, onOut, onEdit, colors }: {
  item: FruitItem; onIn: () => void; onOut: () => void; onEdit: () => void; colors: any;
}) {
  const lowStock = item.currentStock <= item.alertThreshold;
  const catColor = FRUIT_CATEGORY_COLORS[item.category] ?? FRUIT_COLOR;
  const unitLabel = FRUIT_UNIT_LABELS[item.unit] ?? item.unit;
  return (
    <View style={[BC.card, { backgroundColor: colors.surface, borderColor: lowStock ? colors.error : colors.border }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.name}</Text>
          {item.nameEn ? <Text style={{ fontSize: 12, color: colors.muted }}>{item.nameEn}</Text> : null}
          <View style={[BC.tag, { backgroundColor: catColor + "22" }]}>
            <Text style={{ fontSize: 10, color: catColor }}>{FRUIT_CATEGORY_LABELS[item.category]}</Text>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
          {item.spec ? `${item.spec} · ` : ""}进价¥{formatMoney(item.latestCostPrice)}/{unitLabel}
        </Text>
        {item.usage ? <Text style={{ fontSize: 11, color: colors.muted }}>用途：{item.usage}</Text> : null}
        {item.supplier ? <Text style={{ fontSize: 11, color: colors.muted }}>来源：{item.supplier}</Text> : null}
        {lowStock && <Text style={{ fontSize: 11, color: colors.error, marginTop: 2 }}>⚠ 库存不足（预警线：{item.alertThreshold}{unitLabel}）</Text>}
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text style={[BC.stock, { color: lowStock ? colors.error : FRUIT_COLOR }]}>
          {item.currentStock} {unitLabel}
        </Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <TouchableOpacity onPress={onIn} style={[BC.btn, { backgroundColor: FRUIT_COLOR + "22" }]}>
            <Text style={{ fontSize: 12, color: FRUIT_COLOR, fontWeight: "600" }}>入库</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOut} style={[BC.btn, { backgroundColor: colors.error + "15" }]}>
            <Text style={{ fontSize: 12, color: colors.error, fontWeight: "600" }}>出库</Text>
          </TouchableOpacity>
          <Pressable onPress={onEdit} style={{ padding: 4 }}>
            <IconSymbol name="pencil" size={14} color={colors.muted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── 进货录入 Modal（通用：啤酒/冰块/水果） ──────────────────────────────────
function PurchaseModal({
  visible, tabType, itemName, itemUnit, colors, onSave, onClose
}: {
  visible: boolean;
  tabType: MainTab;
  itemName: string;
  itemUnit: string;
  colors: any;
  onSave: (qty: number, unitPrice: number, notes: string) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [notes, setNotes] = useState("");
  const color = tabType === "beer" ? BEER_COLOR : tabType === "ice" ? ICE_COLOR : FRUIT_COLOR;
  const pettyHint = tabType === "beer" ? "B1（酒水现结）" : tabType === "ice" ? "B1/B2/B3（酒水相关）" : "A5（蔬菜水果）";

  const total = (Number(qty) || 0) * (Number(unitPrice) || 0);

  const handleSave = () => {
    if (!qty || Number(qty) <= 0) { Alert.alert("请填写数量"); return; }
    onSave(Number(qty), Number(unitPrice) || 0, notes);
    setQty(""); setUnitPrice(""); setNotes("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[PM.sheet, { backgroundColor: colors.background }]}>
          <View style={[PM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[PM.title, { color: colors.foreground }]}>进货录入</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={[PM.infoCard, { backgroundColor: color + "0a", borderColor: color + "22" }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color }}>{itemName}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>单位：{itemUnit}</Text>
            </View>
            <View style={[PM.section, { borderColor: colors.border }]}>
              <View style={PM.row}>
                <Text style={[PM.label, { color: colors.foreground }]}>进货数量 *</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <TextInput value={qty} onChangeText={setQty} placeholder="0"
                    placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                    style={[PM.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                  <Text style={{ fontSize: 14, color: colors.muted }}>{itemUnit}</Text>
                </View>
              </View>
              <View style={PM.row}>
                <Text style={[PM.label, { color: colors.foreground }]}>单价（元/{itemUnit}）</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 14, color: colors.muted }}>¥</Text>
                  <TextInput value={unitPrice} onChangeText={setUnitPrice} placeholder="0.00"
                    placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                    style={[PM.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                </View>
              </View>
              {total > 0 && (
                <View style={[PM.totalRow, { backgroundColor: color + "0a" }]}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>本次进货金额</Text>
                  <Text style={{ fontSize: 18, fontWeight: "700", color }}>¥{formatMoney(total)}</Text>
                </View>
              )}
            </View>
            <View style={[PM.section, { borderColor: colors.border }]}>
              <View style={[PM.infoBox, { backgroundColor: colors.warning + "0a", borderColor: colors.warning + "22" }]}>
                <Text style={{ fontSize: 12, color: colors.warning }}>
                  💡 请同时在备用金中录入 {pettyHint} 支出，金额与进货金额一致。
                </Text>
              </View>
              <TextInput value={notes} onChangeText={setNotes} placeholder="备注（可选）"
                placeholderTextColor={colors.muted} multiline numberOfLines={2}
                style={[PM.textarea, { color: colors.foreground, borderColor: colors.border, marginTop: 10 }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 新增条目 Modal ───────────────────────────────────────────────────────────
function AddItemModal({
  visible, tabType, colors, onSave, onClose
}: {
  visible: boolean; tabType: MainTab; colors: any;
  onSave: (data: any) => void; onClose: () => void;
}) {
  const color = tabType === "beer" ? BEER_COLOR : tabType === "ice" ? ICE_COLOR : FRUIT_COLOR;
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState(tabType === "beer" ? "瓶" : tabType === "ice" ? "袋" : "kg");
  const [stock, setStock] = useState("0");
  const [alert, setAlert] = useState(tabType === "beer" ? "12" : tabType === "ice" ? "2" : "1");
  const [costPrice, setCostPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [usage, setUsage] = useState("");
  const [packageType, setPackageType] = useState<BeerItem["packageType"]>("bottle");
  const [fruitCategory, setFruitCategory] = useState<FruitCategory>("citrus");
  const [fruitUnit, setFruitUnit] = useState<FruitUnit>("kg");

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("请填写名称"); return; }
    if (tabType === "beer") {
      onSave({ name: name.trim(), nameEn: nameEn.trim(), spec: spec.trim(), packageType, unitsPerCase: 24, currentStock: Number(stock) || 0, alertThreshold: Number(alert) || 12, latestCostPrice: Number(costPrice) || 0, sellingPrice: Number(sellingPrice) || 0, supplier: supplier.trim(), notes: "", active: true });
    } else if (tabType === "ice") {
      onSave({ name: name.trim(), spec: spec.trim(), unit: unit.trim(), currentStock: Number(stock) || 0, alertThreshold: Number(alert) || 2, latestCostPrice: Number(costPrice) || 0, supplier: supplier.trim(), notes: "", active: true });
    } else {
      onSave({ name: name.trim(), nameEn: nameEn.trim(), category: fruitCategory, spec: spec.trim(), unit: fruitUnit, currentStock: Number(stock) || 0, alertThreshold: Number(alert) || 1, latestCostPrice: Number(costPrice) || 0, supplier: supplier.trim(), usage: usage.trim(), notes: "", active: true });
    }
    setName(""); setNameEn(""); setSpec(""); setStock("0"); setCostPrice(""); setSellingPrice(""); setSupplier(""); setUsage("");
    onClose();
  };

  const tabLabel = tabType === "beer" ? "啤酒" : tabType === "ice" ? "冰块" : "水果";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[PM.sheet, { backgroundColor: colors.background }]}>
          <View style={[PM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[PM.title, { color: colors.foreground }]}>新增{tabLabel}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* 水果品类选择 */}
            {tabType === "fruit" && (
              <View style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground, marginBottom: 8 }}>品类</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {(Object.keys(FRUIT_CATEGORY_LABELS) as FruitCategory[]).map((cat) => (
                      <TouchableOpacity key={cat} onPress={() => setFruitCategory(cat)}
                        style={[BC.btn, { backgroundColor: fruitCategory === cat ? FRUIT_CATEGORY_COLORS[cat] : colors.surface, borderWidth: 1, borderColor: fruitCategory === cat ? FRUIT_CATEGORY_COLORS[cat] : colors.border }]}>
                        <Text style={{ fontSize: 12, color: fruitCategory === cat ? "#fff" : colors.muted }}>
                          {FRUIT_CATEGORY_LABELS[cat]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {[
              { label: "名称 *", value: name, onChange: setName, placeholder: tabType === "beer" ? "如 青岛啤酒" : tabType === "ice" ? "如 摇冰袋" : "如 青柠檬" },
              ...(tabType !== "ice" ? [{ label: "英文名", value: nameEn, onChange: setNameEn, placeholder: "可选" }] : []),
              { label: "规格", value: spec, onChange: setSpec, placeholder: tabType === "beer" ? "如 330ml" : tabType === "ice" ? "如 10kg/袋" : "如 500g/袋" },
              ...(tabType === "ice" ? [{ label: "单位", value: unit, onChange: setUnit, placeholder: "袋/kg/颗" }] : []),
              { label: "当前库存", value: stock, onChange: setStock, placeholder: "0", keyboardType: "decimal-pad" as const },
              { label: "预警线", value: alert, onChange: setAlert, placeholder: "0", keyboardType: "decimal-pad" as const },
              { label: `进货价（元/${tabType === "fruit" ? "单位" : tabType === "beer" ? "瓶" : "单位"}）`, value: costPrice, onChange: setCostPrice, placeholder: "0.00", keyboardType: "decimal-pad" as const },
              ...(tabType === "beer" ? [{ label: "售价（元/瓶）", value: sellingPrice, onChange: setSellingPrice, placeholder: "0.00", keyboardType: "decimal-pad" as const }] : []),
              ...(tabType === "fruit" ? [{ label: "主要用途", value: usage, onChange: setUsage, placeholder: "如 装饰/果汁/调酒" }] : []),
              { label: "供应商/渠道", value: supplier, onChange: setSupplier, placeholder: "可选" },
            ].map((f, i) => (
              <View key={i} style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground, marginBottom: 4 }}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
                  placeholderTextColor={colors.muted} keyboardType={f.keyboardType ?? "default"}
                  style={[PM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            ))}

            {/* 啤酒包装类型 */}
            {tabType === "beer" && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground, marginBottom: 6 }}>包装类型</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["bottle", "can", "draft", "barrel"] as const).map((pt) => (
                    <TouchableOpacity key={pt} onPress={() => setPackageType(pt)}
                      style={[BC.btn, { backgroundColor: packageType === pt ? BEER_COLOR : colors.surface, borderWidth: 1, borderColor: packageType === pt ? BEER_COLOR : colors.border }]}>
                      <Text style={{ fontSize: 12, color: packageType === pt ? "#fff" : colors.muted }}>
                        {PACKAGE_TYPE_LABELS[pt]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* 水果单位选择 */}
            {tabType === "fruit" && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground, marginBottom: 6 }}>单位</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {(Object.keys(FRUIT_UNIT_LABELS) as FruitUnit[]).map((u) => (
                    <TouchableOpacity key={u} onPress={() => setFruitUnit(u)}
                      style={[BC.btn, { backgroundColor: fruitUnit === u ? FRUIT_COLOR : colors.surface, borderWidth: 1, borderColor: fruitUnit === u ? FRUIT_COLOR : colors.border }]}>
                      <Text style={{ fontSize: 12, color: fruitUnit === u ? "#fff" : colors.muted }}>
                        {FRUIT_UNIT_LABELS[u]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function BeerIceInventoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { items: beerItems, addItem: addBeer, addTransaction: addBeerTx } = useBeerStore();
  const { items: iceItems, addItem: addIce, addTransaction: addIceTx } = useIceInventoryStore();
  const { items: fruitItems, addItem: addFruit, addTransaction: addFruitTx } = useFruitStore();

  const [tab, setTab] = useState<MainTab>("beer");
  const [purchaseModal, setPurchaseModal] = useState(false);
  const [purchaseItemId, setPurchaseItemId] = useState("");
  const [purchaseType, setPurchaseType] = useState<"in" | "out">("in");
  const [addItemModal, setAddItemModal] = useState(false);

  const color = tab === "beer" ? BEER_COLOR : tab === "ice" ? ICE_COLOR : FRUIT_COLOR;

  const beerAlerts = useMemo(() => beerItems.filter((i) => i.currentStock <= i.alertThreshold && i.active).length, [beerItems]);
  const iceAlerts = useMemo(() => iceItems.filter((i) => i.currentStock <= i.alertThreshold && i.active).length, [iceItems]);
  const fruitAlerts = useMemo(() => fruitItems.filter((i) => i.currentStock <= i.alertThreshold && i.active).length, [fruitItems]);

  const currentBeerItem = beerItems.find((i) => i.id === purchaseItemId);
  const currentIceItem = iceItems.find((i) => i.id === purchaseItemId);
  const currentFruitItem = fruitItems.find((i) => i.id === purchaseItemId);

  const currentItemName = tab === "beer" ? (currentBeerItem?.name ?? "") : tab === "ice" ? (currentIceItem?.name ?? "") : (currentFruitItem?.name ?? "");
  const currentItemUnit = tab === "beer" ? "瓶" : tab === "ice" ? ((currentIceItem as any)?.unit ?? "袋") : (currentFruitItem ? FRUIT_UNIT_LABELS[currentFruitItem.unit] : "kg");

  const handlePurchase = (qty: number, unitPrice: number, notes: string) => {
    const delta = purchaseType === "in" ? qty : -qty;
    if (tab === "beer") {
      addBeerTx({ beerItemId: purchaseItemId, type: purchaseType, quantity: delta, unitPrice, totalAmount: qty * unitPrice, date: new Date().toISOString().slice(0, 10), notes });
    } else if (tab === "ice") {
      addIceTx({ iceItemId: purchaseItemId, type: purchaseType, quantity: delta, unitPrice, totalAmount: qty * unitPrice, date: new Date().toISOString().slice(0, 10), notes });
    } else {
      addFruitTx({ fruitItemId: purchaseItemId, type: purchaseType, quantity: delta, unitPrice, totalAmount: qty * unitPrice, date: new Date().toISOString().slice(0, 10), notes });
    }
  };

  const handleAddItem = (data: any) => {
    if (tab === "beer") addBeer(data);
    else if (tab === "ice") addIce(data);
    else addFruit(data);
  };

  // 水果按品类分组
  const fruitByCategory = useMemo(() => {
    const groups: Record<string, FruitItem[]> = {};
    fruitItems.filter(i => i.active).forEach(item => {
      const cat = item.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [fruitItems]);

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>啤酒 & 冰块 & 水果</Text>
        <Pressable onPress={() => { tap(); setAddItemModal(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="plus" size={22} color={color} />
        </Pressable>
      </View>

      {/* Tab 切换 */}
      <View style={[S.tabBar, { backgroundColor: colors.border + "33" }]}>
        {([["beer", "🍺 啤酒", beerAlerts], ["ice", "🧊 冰块", iceAlerts], ["fruit", "🍋 水果", fruitAlerts]] as [MainTab, string, number][]).map(([v, label, alerts]) => {
          const tabColor = v === "beer" ? BEER_COLOR : v === "ice" ? ICE_COLOR : FRUIT_COLOR;
          return (
            <TouchableOpacity key={v} onPress={() => { tap(); setTab(v); }}
              style={[S.tabBtn, tab === v && { backgroundColor: colors.background }]}>
              <Text style={[S.tabText, { color: tab === v ? tabColor : colors.muted, fontWeight: tab === v ? "700" : "400" }]}>
                {label}
              </Text>
              {alerts > 0 && (
                <View style={[S.alertBadge, { backgroundColor: colors.error }]}>
                  <Text style={{ fontSize: 9, color: "#fff", fontWeight: "700" }}>{alerts}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 汇总 */}
      <View style={[S.summaryRow, { borderBottomColor: colors.border }]}>
        {tab === "beer" ? (
          <>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>品种数</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: BEER_COLOR }}>{beerItems.filter((i) => i.active).length}</Text>
            </View>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>总库存</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>
                {beerItems.reduce((s, i) => s + i.currentStock, 0)} 瓶
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>库存价值</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: BEER_COLOR }}>
                ¥{formatMoney(beerItems.reduce((s, i) => s + i.currentStock * i.latestCostPrice, 0))}
              </Text>
            </View>
          </>
        ) : tab === "ice" ? (
          <>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>品种数</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: ICE_COLOR }}>{iceItems.filter((i) => i.active).length}</Text>
            </View>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>库存价值</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: ICE_COLOR }}>
                ¥{formatMoney(iceItems.reduce((s, i) => s + i.currentStock * i.latestCostPrice, 0))}
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>品种数</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: FRUIT_COLOR }}>{fruitItems.filter((i) => i.active).length}</Text>
            </View>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>品类数</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>
                {Object.keys(fruitByCategory).length}
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>库存价值</Text>
              <Text style={{ fontSize: 18, fontWeight: "700", color: FRUIT_COLOR }}>
                ¥{formatMoney(fruitItems.reduce((s, i) => s + i.currentStock * i.latestCostPrice, 0))}
              </Text>
            </View>
          </>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {tab === "beer" ? (
          beerItems.filter((i) => i.active).length === 0 ? (
            <View style={{ alignItems: "center", padding: 40 }}>
              <Text style={{ fontSize: 40 }}>🍺</Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有啤酒档案</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>点击右上角 + 添加啤酒品种</Text>
            </View>
          ) : (
            beerItems.filter((i) => i.active).map((item) => (
              <BeerItemCard key={item.id} item={item} colors={colors}
                onIn={() => { tap(); setPurchaseItemId(item.id); setPurchaseType("in"); setPurchaseModal(true); }}
                onOut={() => { tap(); setPurchaseItemId(item.id); setPurchaseType("out"); setPurchaseModal(true); }}
                onEdit={() => {}} />
            ))
          )
        ) : tab === "ice" ? (
          iceItems.filter((i) => i.active).length === 0 ? (
            <View style={{ alignItems: "center", padding: 40 }}>
              <Text style={{ fontSize: 40 }}>🧊</Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有冰块档案</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>点击右上角 + 添加冰块品种</Text>
            </View>
          ) : (
            iceItems.filter((i) => i.active).map((item) => (
              <IceItemCard key={item.id} item={item} colors={colors}
                onIn={() => { tap(); setPurchaseItemId(item.id); setPurchaseType("in"); setPurchaseModal(true); }}
                onOut={() => { tap(); setPurchaseItemId(item.id); setPurchaseType("out"); setPurchaseModal(true); }}
                onEdit={() => {}} />
            ))
          )
        ) : (
          fruitItems.filter((i) => i.active).length === 0 ? (
            <View style={{ alignItems: "center", padding: 40 }}>
              <Text style={{ fontSize: 40 }}>🍋</Text>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>还没有水果档案</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>
                点击右上角 + 添加水果品种{"\n"}支持柑橘/浆果/热带/香草等 9 个品类
              </Text>
            </View>
          ) : (
            // 按品类分组展示
            Object.entries(fruitByCategory).map(([cat, items]) => (
              <View key={cat}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, marginTop: 4 }}>
                  <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: FRUIT_CATEGORY_COLORS[cat as FruitCategory] ?? FRUIT_COLOR }} />
                  <Text style={{ fontSize: 12, fontWeight: "600", color: FRUIT_CATEGORY_COLORS[cat as FruitCategory] ?? FRUIT_COLOR }}>
                    {FRUIT_CATEGORY_LABELS[cat as FruitCategory] ?? cat}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>· {items.length} 种</Text>
                </View>
                {items.map((item) => (
                  <FruitItemCard key={item.id} item={item} colors={colors}
                    onIn={() => { tap(); setPurchaseItemId(item.id); setPurchaseType("in"); setPurchaseModal(true); }}
                    onOut={() => { tap(); setPurchaseItemId(item.id); setPurchaseType("out"); setPurchaseModal(true); }}
                    onEdit={() => {}} />
                ))}
              </View>
            ))
          )
        )}
      </ScrollView>

      {/* 进货 Modal */}
      <PurchaseModal
        visible={purchaseModal}
        tabType={tab}
        itemName={currentItemName}
        itemUnit={currentItemUnit}
        colors={colors}
        onSave={handlePurchase}
        onClose={() => setPurchaseModal(false)}
      />

      {/* 新增条目 Modal */}
      <AddItemModal
        visible={addItemModal}
        tabType={tab}
        colors={colors}
        onSave={handleAddItem}
        onClose={() => setAddItemModal(false)}
      />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  tabBar: { flexDirection: "row", margin: 12, borderRadius: 10, padding: 2, gap: 2 },
  tabBtn: { flex: 1, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  tabText: { fontSize: 13 },
  alertBadge: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  summaryRow: { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
});

const BC = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  stock: { fontSize: 18, fontWeight: "800" },
  btn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
});

const PM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  section: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  row: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  totalRow: { borderRadius: 8, padding: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoBox: { borderRadius: 8, borderWidth: 1, padding: 10 },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 60 },
});
