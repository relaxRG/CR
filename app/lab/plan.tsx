/**
 * 研发计划清单页面
 * 鸡尾酒 / 餐食 两大分类，每类含 计划产品 / 计划采购 两个子类
 */
import React, { useMemo, useState } from "react";
import { Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Modal } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useLabPlanStore, PlanCategory, PlanItemType, PlanItemStatus, PlanItem } from "@/lib/lab/plan-store";
import { IconSymbol } from "@/components/ui/icon-symbol";

type MainCat = PlanCategory;
type SubType = PlanItemType;

const STATUS_LABELS: Record<PlanItemStatus, string> = {
  pending: "待处理",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消",
};

const STATUS_COLORS: Record<PlanItemStatus, string> = {
  pending: "#FF9500",
  in_progress: "#007AFF",
  done: "#34C759",
  cancelled: "#8E8E93",
};

function PlanItemCard({ item, onStatusChange, onDelete }: {
  item: PlanItem;
  onStatusChange: (id: string, status: PlanItemStatus) => void;
  onDelete: (id: string) => void;
}) {
  const colors = useColors();
  const statusColor = STATUS_COLORS[item.status];
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <View style={[styles.priorityDot, { backgroundColor: item.priority === 1 ? colors.error : item.priority === 2 ? colors.warning : colors.muted }]} />
          <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={2}>{item.name}</Text>
        </View>
        {item.notes ? <Text style={[styles.cardNotes, { color: colors.muted }]} numberOfLines={2}>{item.notes}</Text> : null}
        {item.quantity ? <Text style={[styles.cardQty, { color: colors.muted }]}>数量：{item.quantity}</Text> : null}
        {item.dueDate ? <Text style={[styles.cardDate, { color: colors.muted }]}>截止：{item.dueDate}</Text> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Pressable
          onPress={() => {
            const next: PlanItemStatus[] = ["pending", "in_progress", "done", "cancelled"];
            const idx = next.indexOf(item.status);
            onStatusChange(item.id, next[(idx + 1) % next.length]);
          }}
          style={[styles.statusBadge, { backgroundColor: statusColor + "22" }]}
        >
          <Text style={[styles.statusText, { color: statusColor }]}>{STATUS_LABELS[item.status]}</Text>
        </Pressable>
        <Pressable
          onPress={() => Alert.alert("删除", `确认删除「${item.name}」？`, [
            { text: "取消", style: "cancel" },
            { text: "删除", style: "destructive", onPress: () => onDelete(item.id) },
          ])}
        >
          <IconSymbol name="trash" size={16} color={colors.error} />
        </Pressable>
      </View>
    </View>
  );
}

function AddItemSheet({ visible, category, type, onClose, onAdd }: {
  visible: boolean;
  category: PlanCategory;
  type: PlanItemType;
  onClose: () => void;
  onAdd: (data: { name: string; notes: string; quantity: string; priority: 1 | 2 | 3; dueDate: string }) => void;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [dueDate, setDueDate] = useState("");

  const reset = () => { setName(""); setNotes(""); setQuantity(""); setPriority(2); setDueDate(""); };

  const handleAdd = () => {
    if (!name.trim()) { Alert.alert("请输入名称"); return; }
    onAdd({ name: name.trim(), notes: notes.trim(), quantity: quantity.trim(), priority, dueDate: dueDate.trim() });
    reset();
    onClose();
  };

  const typeLabel = type === "product" ? "计划产品" : "计划采购";
  const catLabel = category === "cocktail" ? "鸡尾酒" : "餐食";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <View style={styles.sheetHeader}>
          <Pressable onPress={() => { reset(); onClose(); }}>
            <Text style={[styles.sheetCancel, { color: colors.primary }]}>取消</Text>
          </Pressable>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{catLabel} · {typeLabel}</Text>
          <Pressable onPress={handleAdd}>
            <Text style={[styles.sheetDone, { color: colors.primary }]}>添加</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>名称 *</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={type === "product" ? "产品名称" : "采购品名"}
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="next"
            />
          </View>
          {type === "purchase" && (
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>数量</Text>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                placeholder="如：2瓶、500g"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                returnKeyType="next"
              />
            </View>
          )}
          <View>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>优先级</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {([1, 2, 3] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPriority(p)}
                  style={[styles.priorityBtn, { borderColor: priority === p ? colors.primary : colors.border, backgroundColor: priority === p ? colors.primary + "22" : colors.surface }]}
                >
                  <Text style={{ color: priority === p ? colors.primary : colors.muted, fontWeight: "600" }}>
                    {p === 1 ? "高" : p === 2 ? "中" : "低"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>截止日期</Text>
            <TextInput
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="YYYY-MM-DD（可选）"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="next"
            />
          </View>
          <View>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>备注</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="描述、灵感、参考来源…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              style={[styles.input, styles.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function LabPlanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { items, addItem, setStatus, deleteItem } = useLabPlanStore();
  const [mainCat, setMainCat] = usePersistedState<MainCat>("lab.plan.cat.v1", "cocktail");
  const [subType, setSubType] = usePersistedState<SubType>("lab.plan.type.v1", "product");
  const [showAdd, setShowAdd] = useState(false);

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const filtered = useMemo(() =>
    items.filter((i) => i.category === mainCat && i.type === subType),
    [items, mainCat, subType]
  );

  const pendingCount = filtered.filter((i) => i.status === "pending").length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 主分类 */}
      <View style={[styles.subHeader, { backgroundColor: colors.background }]}>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          {(["cocktail", "food"] as MainCat[]).map((cat) => {
            const active = mainCat === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => { tap(); setMainCat(cat); }}
                style={[styles.mainCatBtn, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={{ color: active ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 14 }}>
                  {cat === "cocktail" ? "🍸 鸡尾酒" : "🍽 餐食"}
                </Text>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => { tap(); setShowAdd(true); }}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
          >
            <IconSymbol name="plus" size={18} color="#fff" />
          </Pressable>
        </View>
        {/* 子类型 */}
        <View style={[styles.segContainer, { backgroundColor: colors.border + "55" }]}>
          {(["product", "purchase"] as SubType[]).map((t) => {
            const active = subType === t;
            return (
              <Pressable
                key={t}
                onPress={() => { tap(); setSubType(t); }}
                style={[styles.segItem, active && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 }]}
              >
                <Text style={[styles.segText, { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" }]}>
                  {t === "product" ? "计划产品" : "计划采购"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {pendingCount > 0 && (
          <Text style={[styles.pendingHint, { color: colors.warning }]}>{pendingCount} 项待处理</Text>
        )}
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <IconSymbol name="list.clipboard.fill" size={48} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>暂无计划</Text>
          <Text style={[styles.emptyDesc, { color: colors.muted }]}>点击右上角 + 添加</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <PlanItemCard item={item} onStatusChange={setStatus} onDelete={deleteItem} />
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
        />
      )}

      <AddItemSheet
        visible={showAdd}
        category={mainCat}
        type={subType}
        onClose={() => setShowAdd(false)}
        onAdd={(data) => addItem({ ...data, category: mainCat, type: subType, status: "pending" })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  mainCatBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  addBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14, lineHeight: 19 },
  pendingHint: { fontSize: 12, marginTop: 6, fontWeight: "500" },
  card: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  cardName: { fontSize: 15, fontWeight: "600", lineHeight: 21, flex: 1 },
  cardNotes: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  cardQty: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  cardDate: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptyDesc: { fontSize: 14 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  priorityBtn: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
