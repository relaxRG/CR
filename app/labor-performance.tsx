/**
 * 绩效模板编辑器 + 个人发薪卡片
 * - 分组条目（A/B/C/利润提点等）
 * - 智能数据源（营业额/净利润/出勤天数）
 * - 每月填写实际完成情况
 * - 自动汇入薪资单
 * - 支持增删改所有条目
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEmployeeStore, usePerformanceTemplateStore, usePerformanceRecordStore,
  usePaySlipStore, useAttendanceStore,
} from "@/lib/labor/store";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import {
  Employee, PerformanceTemplate, PerformanceGroup, PerformanceItem,
  PerformanceRecord, PerformanceDataSource,
  DEPT_COLORS, monthLabel,
} from "@/lib/labor/types";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const DATA_SOURCE_LABELS: Record<PerformanceDataSource, string> = {
  manual: "手动填写",
  revenue: "营业额（自动）",
  net_profit: "净利润（自动）",
  attendance_days: "出勤天数（自动）",
};

const DATA_SOURCE_COLORS: Record<PerformanceDataSource, string> = {
  manual: "#8E8E93",
  revenue: "#52C41A",
  net_profit: "#1677FF",
  attendance_days: "#FA8C16",
};

// ─── 条目编辑 Modal ───────────────────────────────────────────────────────────
function ItemEditModal({ visible, item, groupTitle, accentColor, colors, onSave, onClose }: {
  visible: boolean;
  item: PerformanceItem | null;
  groupTitle: string;
  accentColor: string;
  colors: any;
  onSave: (item: PerformanceItem) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [code, setCode] = useState(item?.code ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [maxAmount, setMaxAmount] = useState(String(item?.maxAmount ?? ""));
  const [isFixed, setIsFixed] = useState(item?.isFixed ?? false);
  const [dataSource, setDataSource] = useState<PerformanceDataSource>(item?.dataSource ?? "manual");

  React.useEffect(() => {
    if (visible && item) {
      setCode(item.code); setTitle(item.title); setDescription(item.description);
      setMaxAmount(String(item.maxAmount)); setIsFixed(item.isFixed); setDataSource(item.dataSource);
    } else if (visible && !item) {
      setCode(""); setTitle(""); setDescription(""); setMaxAmount(""); setIsFixed(false); setDataSource("manual");
    }
  }, [visible, item]);

  const handleSave = () => {
    if (!title.trim()) { Alert.alert("请填写条目名称"); return; }
    onSave({
      id: item?.id ?? uuid(),
      code: code.trim(),
      title: title.trim(),
      description: description.trim(),
      maxAmount: Number(maxAmount) || 0,
      isFixed,
      dataSource,
      sortOrder: item?.sortOrder ?? 0,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[EM.sheet, { backgroundColor: colors.background }]}>
          <View style={[EM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[EM.title, { color: colors.foreground }]}>{item ? "编辑条目" : "新增条目"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: accentColor }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>分组：{groupTitle}</Text>

            <View style={EM.fieldGroup}>
              <Text style={[EM.fieldLabel, { color: colors.muted }]}>编号（如 A1）</Text>
              <TextInput value={code} onChangeText={setCode} placeholder="A1"
                placeholderTextColor={colors.muted}
                style={[EM.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>

            <View style={EM.fieldGroup}>
              <Text style={[EM.fieldLabel, { color: colors.muted }]}>条目名称 *</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="如：大众点评提分"
                placeholderTextColor={colors.muted}
                style={[EM.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>

            <View style={EM.fieldGroup}>
              <Text style={[EM.fieldLabel, { color: colors.muted }]}>说明/备注</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder="详细说明（可选）"
                placeholderTextColor={colors.muted} multiline numberOfLines={2}
                style={[EM.input, { color: colors.foreground, borderColor: colors.border, minHeight: 60 }]} />
            </View>

            <View style={EM.fieldGroup}>
              <Text style={[EM.fieldLabel, { color: colors.muted }]}>最高金额（¥）</Text>
              <TextInput value={maxAmount} onChangeText={setMaxAmount} placeholder="0"
                placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                style={[EM.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>

            <View style={EM.fieldGroup}>
              <Text style={[EM.fieldLabel, { color: colors.muted }]}>数据来源</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {(Object.keys(DATA_SOURCE_LABELS) as PerformanceDataSource[]).map((src) => (
                  <TouchableOpacity key={src} onPress={() => { tap(); setDataSource(src); }}
                    style={[EM.chip, {
                      backgroundColor: dataSource === src ? DATA_SOURCE_COLORS[src] : colors.surface,
                      borderColor: dataSource === src ? DATA_SOURCE_COLORS[src] : colors.border,
                    }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: dataSource === src ? "#fff" : colors.muted }}>
                      {DATA_SOURCE_LABELS[src]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity onPress={() => { tap(); setIsFixed((v) => !v); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" }, { borderColor: isFixed ? accentColor : colors.border, backgroundColor: isFixed ? accentColor : "transparent" }]}>
                {isFixed && <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>✓</Text>}
              </View>
              <Text style={{ fontSize: 14, color: colors.foreground }}>固定金额（每月自动满额，无需填写）</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function LaborPerformanceScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const params = useLocalSearchParams<{ employeeId?: string; month?: string }>();
  const employeeId = params.employeeId ?? "";
  const now = new Date();
  const month = params.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const { employees } = useEmployeeStore();
  const { getTemplate, upsertTemplate } = usePerformanceTemplateStore();
  const { getRecord, upsertRecord } = usePerformanceRecordStore();
  const { getPaySlip, upsertPaySlip, buildPaySlipDraft } = usePaySlipStore();
  const { getAttendance } = useAttendanceStore();
  const { getReport } = useMonthlySummaryStore();

  const employee = employees.find((e) => e.id === employeeId);
  const template = getTemplate(employeeId);
  const record = getRecord(employeeId, month);
  const slip = getPaySlip(employeeId, month);
  const att = getAttendance(employeeId, month);
  const report = getReport(month);

  const deptColor = employee ? DEPT_COLORS[employee.dept] : colors.primary;

  // 模板编辑状态
  const [editMode, setEditMode] = useState(false);
  const [localGroups, setLocalGroups] = useState<PerformanceGroup[]>(template?.groups ?? []);
  const [editingItem, setEditingItem] = useState<{ item: PerformanceItem | null; groupId: string } | null>(null);

  // 当月实际金额（从 record 读取）
  const getActual = useCallback((itemId: string): number => {
    return record?.actuals[itemId] ?? 0;
  }, [record]);

  const getAutoNote = useCallback((itemId: string): string => {
    return record?.autoNotes[itemId] ?? "";
  }, [record]);

  const isOverride = useCallback((itemId: string): boolean => {
    return record?.overrides[itemId] ?? false;
  }, [record]);

  // 智能自动填充
  const getAutoValue = useCallback((item: PerformanceItem): { amount: number; note: string } => {
    if (item.isFixed) return { amount: item.maxAmount, note: "固定金额" };
    switch (item.dataSource) {
      case "revenue": {
        const rev = report?.totalRevenue ?? 0;
        if (item.tiers && item.tiers.length > 0) {
          const tier = [...item.tiers].reverse().find((t) => rev >= t.threshold);
          if (tier) {
            const amt = Math.round(rev * tier.rate);
            return { amount: Math.min(amt, item.maxAmount || amt), note: `营业额 ¥${rev.toFixed(0)} × ${(tier.rate * 100).toFixed(0)}% = ¥${amt}` };
          }
        }
        return { amount: 0, note: `本月营业额：¥${rev.toFixed(0)}` };
      }
      case "net_profit": {
        const profit = report?.netProfit ?? 0;
        if (item.tiers && item.tiers.length > 0) {
          const tier = [...item.tiers].reverse().find((t) => profit >= t.threshold);
          if (tier) {
            const amt = Math.round(profit * tier.rate);
            return { amount: Math.min(amt, item.maxAmount || amt), note: `净利润 ¥${profit.toFixed(0)} × ${(tier.rate * 100).toFixed(0)}% = ¥${amt}` };
          }
        }
        return { amount: 0, note: `本月净利润：¥${profit.toFixed(0)}` };
      }
      case "attendance_days": {
        const days = att?.attendanceDays ?? 0;
        return { amount: 0, note: `本月出勤：${days}天` };
      }
      default:
        return { amount: 0, note: "" };
    }
  }, [report, att]);

  // 计算绩效合计
  const totalPerformance = useMemo(() => {
    const groups = editMode ? localGroups : (template?.groups ?? []);
    let total = 0;
    for (const group of groups) {
      for (const item of group.items) {
        if (item.isFixed) { total += item.maxAmount; continue; }
        const actual = record?.actuals[item.id] ?? 0;
        total += actual;
      }
    }
    return total;
  }, [template, localGroups, record, editMode]);

  // 更新某条目实际金额
  const updateActual = (itemId: string, amount: number, override: boolean) => {
    const existing = record ?? {
      id: uuid(), employeeId, month,
      actuals: {}, overrides: {}, autoNotes: {}, totalPerformance: 0,
      updatedAt: new Date().toISOString(),
    };
    const newActuals = { ...existing.actuals, [itemId]: amount };
    const newOverrides = { ...existing.overrides, [itemId]: override };
    const newTotal = Object.values(newActuals).reduce((s, v) => s + v, 0);
    upsertRecord({ ...existing, actuals: newActuals, overrides: newOverrides, totalPerformance: newTotal });
  };

  // 自动填充所有智能条目
  const handleAutoFill = () => {
    const groups = template?.groups ?? [];
    const existing = record ?? {
      id: uuid(), employeeId, month,
      actuals: {}, overrides: {}, autoNotes: {}, totalPerformance: 0,
      updatedAt: new Date().toISOString(),
    };
    const newActuals = { ...existing.actuals };
    const newAutoNotes = { ...existing.autoNotes };
    for (const group of groups) {
      for (const item of group.items) {
        if (existing.overrides[item.id]) continue; // 跳过已手动覆盖的
        const { amount, note } = getAutoValue(item);
        if (item.dataSource !== "manual" || item.isFixed) {
          newActuals[item.id] = amount;
          newAutoNotes[item.id] = note;
        }
      }
    }
    const newTotal = Object.values(newActuals).reduce((s, v) => s + v, 0);
    upsertRecord({ ...existing, actuals: newActuals, autoNotes: newAutoNotes, totalPerformance: newTotal });
  };

  // 同步到薪资单
  const handleSyncToPaySlip = () => {
    if (!employee) return;
    const draft = buildPaySlipDraft(employee, month, att ?? null, totalPerformance, slip?.advanceAmount ?? 0);
    upsertPaySlip(draft);
    Alert.alert("已同步", `绩效 ¥${totalPerformance.toFixed(0)} 已写入 ${monthLabel(month)} 薪资单`);
  };

  // 保存模板
  const handleSaveTemplate = () => {
    if (!employee) return;
    const tpl: PerformanceTemplate = {
      id: template?.id ?? uuid(),
      employeeId,
      name: `${employee.code} 绩效模板`,
      groups: localGroups,
      updatedAt: new Date().toISOString(),
    };
    upsertTemplate(tpl);
    setEditMode(false);
  };

  const groups = editMode ? localGroups : (template?.groups ?? []);

  if (!employee) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>员工不存在</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>{employee.code} 绩效</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{monthLabel(month)}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {editMode ? (
            <Pressable onPress={handleSaveTemplate}><Text style={{ fontSize: 16, fontWeight: "700", color: deptColor }}>保存模板</Text></Pressable>
          ) : (
            <Pressable onPress={() => { tap(); setLocalGroups(template?.groups ?? []); setEditMode(true); }}>
              <IconSymbol name="pencil" size={20} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 员工信息卡 */}
        <View style={[S.empCard, { backgroundColor: deptColor + "0a", borderColor: deptColor + "33" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={[S.avatar, { backgroundColor: deptColor + "22" }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>{employee.code.slice(0, 2)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{employee.code} · {employee.realName}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{monthLabel(month)} 绩效汇总</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: deptColor }}>¥{totalPerformance.toFixed(0)}</Text>
              <Text style={{ fontSize: 10, color: colors.muted }}>绩效合计</Text>
            </View>
          </View>
          {/* 操作按钮 */}
          {!editMode && (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TouchableOpacity onPress={() => { tap(); handleAutoFill(); }}
                style={[S.actionBtn, { backgroundColor: colors.success + "22", borderColor: colors.success + "44" }]}>
                <IconSymbol name="bolt.fill" size={14} color={colors.success} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.success }}>智能填充</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { tap(); handleSyncToPaySlip(); }}
                style={[S.actionBtn, { backgroundColor: deptColor + "22", borderColor: deptColor + "44" }]}>
                <IconSymbol name="arrow.up.circle.fill" size={14} color={deptColor} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: deptColor }}>同步到薪资单</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 绩效分组 */}
        {groups.length === 0 ? (
          <View style={{ alignItems: "center", padding: 32, gap: 12 }}>
            <IconSymbol name="chart.bar.fill" size={48} color={colors.border} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>暂无绩效模板</Text>
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>点击右上角编辑图标，为该员工设置绩效模板</Text>
            <TouchableOpacity onPress={() => { tap(); setLocalGroups([]); setEditMode(true); }}
              style={[S.actionBtn, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "44" }]}>
              <IconSymbol name="plus" size={14} color={colors.primary} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>创建绩效模板</Text>
            </TouchableOpacity>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.id} style={[S.groupCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              {/* 分组标题 */}
              <View style={[S.groupHeader, { backgroundColor: deptColor + "10" }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>{group.title}</Text>
                {group.description ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{group.description}</Text> : null}
                {editMode && (
                  <TouchableOpacity onPress={() => {
                    tap();
                    setEditingItem({ item: null, groupId: group.id });
                  }} style={{ marginLeft: "auto" }}>
                    <IconSymbol name="plus.circle.fill" size={20} color={deptColor} />
                  </TouchableOpacity>
                )}
              </View>

              {/* 条目列表 */}
              {group.items.map((item) => {
                const autoVal = getAutoValue(item);
                const actual = item.isFixed ? item.maxAmount : getActual(item.id);
                const override = isOverride(item.id);
                const autoNote = autoVal.note || getAutoNote(item.id);

                return (
                  <View key={item.id} style={[S.itemRow, { borderTopColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {item.code ? <Text style={{ fontSize: 12, fontWeight: "700", color: deptColor }}>{item.code}</Text> : null}
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.title}</Text>
                        {item.isFixed && (
                          <View style={{ backgroundColor: "#52C41A22", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ fontSize: 9, color: colors.success, fontWeight: "700" }}>固定</Text>
                          </View>
                        )}
                        {item.dataSource !== "manual" && (
                          <View style={{ backgroundColor: DATA_SOURCE_COLORS[item.dataSource] + "22", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ fontSize: 9, color: DATA_SOURCE_COLORS[item.dataSource], fontWeight: "700" }}>自动</Text>
                          </View>
                        )}
                      </View>
                      {item.description ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{item.description}</Text> : null}
                      {autoNote ? <Text style={{ fontSize: 11, color: DATA_SOURCE_COLORS[item.dataSource], marginTop: 2 }}>{autoNote}</Text> : null}
                      {item.maxAmount > 0 && !item.isFixed && (
                        <Text style={{ fontSize: 10, color: colors.muted }}>最高 ¥{item.maxAmount}</Text>
                      )}
                    </View>

                    {/* 金额输入 */}
                    {editMode ? (
                      <TouchableOpacity onPress={() => { tap(); setEditingItem({ item, groupId: group.id }); }}
                        style={{ padding: 4 }}>
                        <IconSymbol name="pencil.circle" size={20} color={colors.muted} />
                      </TouchableOpacity>
                    ) : item.isFixed ? (
                      <Text style={{ fontSize: 16, fontWeight: "700", color: deptColor }}>¥{item.maxAmount}</Text>
                    ) : (
                      <View style={{ alignItems: "flex-end" }}>
                        <TextInput
                          value={actual > 0 ? String(actual) : ""}
                          onChangeText={(v) => updateActual(item.id, Number(v) || 0, true)}
                          placeholder="0"
                          placeholderTextColor={colors.border}
                          keyboardType="decimal-pad"
                          style={[S.amountInput, {
                            color: override ? colors.warning : colors.foreground,
                            borderColor: override ? colors.warning : colors.border,
                          }]}
                        />
                        {override && <Text style={{ fontSize: 9, color: colors.warning }}>已修改</Text>}
                      </View>
                    )}
                  </View>
                );
              })}

              {/* 分组合计 */}
              <View style={[S.groupTotal, { borderTopColor: deptColor + "33" }]}>
                <Text style={{ fontSize: 12, color: colors.muted }}>小计</Text>
                <Text style={{ fontSize: 15, fontWeight: "700", color: deptColor }}>
                  ¥{group.items.reduce((s, item) => {
                    if (item.isFixed) return s + item.maxAmount;
                    return s + getActual(item.id);
                  }, 0).toFixed(0)}
                </Text>
              </View>
            </View>
          ))
        )}

        {/* 编辑模式：新增分组 */}
        {editMode && (
          <TouchableOpacity onPress={() => {
            tap();
            const newGroup: PerformanceGroup = {
              id: uuid(), title: "新分组", description: "", items: [], sortOrder: localGroups.length,
            };
            setLocalGroups((prev) => [...prev, newGroup]);
          }} style={[S.addGroupBtn, { borderColor: deptColor + "66", backgroundColor: deptColor + "08" }]}>
            <IconSymbol name="plus.circle.fill" size={18} color={deptColor} />
            <Text style={{ fontSize: 14, fontWeight: "600", color: deptColor }}>新增绩效分组</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 条目编辑 Modal */}
      <ItemEditModal
        visible={!!editingItem}
        item={editingItem?.item ?? null}
        groupTitle={localGroups.find((g) => g.id === editingItem?.groupId)?.title ?? ""}
        accentColor={deptColor}
        colors={colors}
        onSave={(savedItem) => {
          if (!editingItem) return;
          setLocalGroups((prev) => prev.map((g) => {
            if (g.id !== editingItem.groupId) return g;
            const idx = g.items.findIndex((i) => i.id === savedItem.id);
            if (idx >= 0) {
              const items = [...g.items]; items[idx] = savedItem;
              return { ...g, items };
            }
            return { ...g, items: [...g.items, { ...savedItem, sortOrder: g.items.length }] };
          }));
          setEditingItem(null);
        }}
        onClose={() => setEditingItem(null)}
      />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  empCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: "center" },
  groupCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  groupHeader: { flexDirection: "row", alignItems: "center", padding: 12, flexWrap: "wrap" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  groupTotal: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderTopWidth: 1 },
  amountInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 15, fontWeight: "700", textAlign: "right", minWidth: 72 },
  addGroupBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", justifyContent: "center" },
});

const EM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: "700" },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
});
