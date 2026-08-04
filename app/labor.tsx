/**
 * 员工管理主界面 v2
 * 横滑三页：排班表 / 员工档案（含发薪卡片）/ 薪资预支
 * 顶部：总览卡片（本月人力成本 / 在职人数 / 出勤人数）
 * 员工档案：自定义分组 + 拖拽排序（长按移动）
 */
import React, { useMemo, useRef, useState } from "react";
import {
  Alert, Dimensions, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEmployeeStore, useEmployeeGroupStore, useAttendanceStore,
  usePaySlipStore, useShiftStore,
} from "@/lib/labor/store";
import { useSalaryAdvanceStore } from "@/lib/labor/advance-store";
import { usePettyCashStore } from "@/lib/store/petty-store";
import {
  Employee, EmployeeGroup, DEPT_COLORS, DEPT_LABELS, monthLabel,
  DEFAULT_EMPLOYEE_GROUPS,
} from "@/lib/labor/types";

const { width: SCREEN_W } = Dimensions.get("window");
const NOON_COLOR = "#FF9500";
const EVE_COLOR = "#5856D6";

// ─── 月份工具 ─────────────────────────────────────────────────────────────────
function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ─── 总览卡片 ─────────────────────────────────────────────────────────────────
function OverviewCard({ month, colors }: { month: string; colors: any }) {
  const { employees } = useEmployeeStore();
  const { paySlips } = usePaySlipStore();
  const { records: attendances } = useAttendanceStore();

  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);
  const monthSlips = useMemo(() => paySlips.filter((s) => s.month === month), [paySlips, month]);
  const totalSalary = useMemo(() => monthSlips.reduce((s, p) => s + p.finalSalary, 0), [monthSlips]);
  const totalPending = useMemo(() => monthSlips.reduce((s, p) => s + Math.max(0, p.finalSalary - p.advanceAmount), 0), [monthSlips]);
  const attendCount = useMemo(() => attendances.filter((a) => a.month === month).length, [attendances, month]);

  return (
    <View style={[OV.card, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
      <Text style={[OV.title, { color: colors.primary }]}>{monthLabel(month)} 人力总览</Text>
      <View style={OV.row}>
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>在职人数</Text>
          <Text style={[OV.value, { color: colors.foreground }]}>{activeEmployees.length}<Text style={OV.unit}>人</Text></Text>
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>已录考勤</Text>
          <Text style={[OV.value, { color: colors.foreground }]}>{attendCount}<Text style={OV.unit}>人</Text></Text>
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>薪资合计</Text>
          <Text style={[OV.value, { color: colors.primary }]}>
            {totalSalary > 0 ? `¥${totalSalary.toFixed(0)}` : "—"}
          </Text>
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>待发</Text>
          <Text style={[OV.value, { color: totalPending > 0 ? "#FF9500" : colors.muted }]}>
            {totalPending > 0 ? `¥${totalPending.toFixed(0)}` : "—"}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── 个人发薪卡片（嵌入员工档案页） ──────────────────────────────────────────
function PaySlipMiniCard({ employee, month, colors }: { employee: Employee; month: string; colors: any }) {
  const { getPaySlip } = usePaySlipStore();
  const { getAttendance } = useAttendanceStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const slip = getPaySlip(employee.id, month);
  const att = getAttendance(employee.id, month);
  const deptColor = DEPT_COLORS[employee.dept];

  return (
    <TouchableOpacity
      onPress={() => { tap(); router.push({ pathname: "/labor-attendance", params: { employeeId: employee.id, month } } as any); }}
      style={[PC.card, { backgroundColor: colors.surface, borderColor: deptColor + "33" }]}>
      {/* 员工信息行 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={[PC.avatar, { backgroundColor: deptColor + "22" }]}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: deptColor }}>{employee.code.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{employee.code}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{employee.realName}</Text>
            {employee.defaultSession && (
              <View style={{ backgroundColor: (employee.defaultSession === "午" ? NOON_COLOR : EVE_COLOR) + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: employee.defaultSession === "午" ? NOON_COLOR : EVE_COLOR }}>{employee.defaultSession}班</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11, color: colors.muted }}>
            {DEPT_LABELS[employee.dept]} · {employee.type === "fulltime" ? `底薪¥${employee.baseSalary}` : `时薪¥${employee.hourlyRate}/h`}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {slip ? (
            <>
              <Text style={{ fontSize: 16, fontWeight: "800", color: deptColor }}>¥{slip.finalSalary.toFixed(0)}</Text>
              <Text style={{ fontSize: 10, color: colors.muted }}>最终薪资</Text>
            </>
          ) : att ? (
            <>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.muted }}>¥{att.attendanceSalary.toFixed(0)}</Text>
              <Text style={{ fontSize: 10, color: colors.muted }}>考勤薪资</Text>
            </>
          ) : (
            <Text style={{ fontSize: 11, color: colors.border }}>未录入</Text>
          )}
        </View>
      </View>

      {/* 薪资明细行（有数据时显示） */}
      {slip && (
        <View style={[PC.detailRow, { borderTopColor: colors.border }]}>
          {att && <View style={PC.detailItem}><Text style={PC.detailLabel}>出勤</Text><Text style={[PC.detailValue, { color: colors.foreground }]}>{att.attendanceDays}天</Text></View>}
          {att && att.overtimeHours > 0 && <View style={PC.detailItem}><Text style={PC.detailLabel}>加班</Text><Text style={[PC.detailValue, { color: "#FF3B30" }]}>+{att.overtimeHours.toFixed(1)}h</Text></View>}
          {slip.performanceBonus > 0 && <View style={PC.detailItem}><Text style={PC.detailLabel}>绩效</Text><Text style={[PC.detailValue, { color: "#34C759" }]}>+¥{slip.performanceBonus.toFixed(0)}</Text></View>}
          {slip.advanceAmount > 0 && <View style={PC.detailItem}><Text style={PC.detailLabel}>预支</Text><Text style={[PC.detailValue, { color: "#FF9500" }]}>-¥{slip.advanceAmount.toFixed(0)}</Text></View>}
          <View style={PC.detailItem}>
            <Text style={PC.detailLabel}>待发</Text>
            <Text style={[PC.detailValue, { color: deptColor }]}>¥{Math.max(0, slip.finalSalary - slip.advanceAmount).toFixed(0)}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── 员工档案页（第二页） ─────────────────────────────────────────────────────
function EmployeeRosterPage({ month, colors }: { month: string; colors: any }) {
  const { employees } = useEmployeeStore();
  const { groups, toggleCollapse, moveEmployeeToGroup } = useEmployeeGroupStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);

  // 将员工按分组排列（未分组的放最后）
  const sortedGroups = useMemo(() =>
    [...groups].sort((a, b) => a.sortOrder - b.sortOrder),
    [groups]
  );

  const ungroupedEmployees = useMemo(() => {
    const allGroupedIds = new Set(groups.flatMap((g) => g.employeeIds));
    return activeEmployees.filter((e) => !allGroupedIds.has(e.id));
  }, [activeEmployees, groups]);

  const getGroupEmployees = (group: EmployeeGroup): Employee[] => {
    return group.employeeIds
      .map((id) => activeEmployees.find((e) => e.id === id))
      .filter((e): e is Employee => !!e);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      {/* 添加员工按钮 */}
      <TouchableOpacity onPress={() => { tap(); router.push("/labor-employee-form" as any); }}
        style={[{ flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.primary + "66", backgroundColor: colors.primary + "08" }]}>
        <IconSymbol name="plus.circle.fill" size={20} color={colors.primary} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.primary }}>添加员工</Text>
      </TouchableOpacity>

      {/* 分组列表 */}
      {sortedGroups.map((group) => {
        const empList = getGroupEmployees(group);
        if (empList.length === 0) return null;
        return (
          <View key={group.id} style={[{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }]}>
            {/* 分组标题 */}
            <TouchableOpacity onPress={() => { tap(); toggleCollapse(group.id); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: group.color + "10" }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: group.color }} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: group.color }}>{group.name}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 2 }}>({empList.length}人)</Text>
              <IconSymbol name={group.collapsed ? "chevron.right" : "chevron.down"} size={14} color={colors.muted} style={{ marginLeft: "auto" }} />
            </TouchableOpacity>
            {/* 员工卡片 */}
            {!group.collapsed && empList.map((emp) => (
              <View key={emp.id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <PaySlipMiniCard employee={emp} month={month} colors={colors} />
              </View>
            ))}
          </View>
        );
      })}

      {/* 未分组员工 */}
      {ungroupedEmployees.length > 0 && (
        <View style={[{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: colors.muted + "10" }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.muted }}>未分组</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>({ungroupedEmployees.length}人)</Text>
          </View>
          {ungroupedEmployees.map((emp) => (
            <View key={emp.id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <PaySlipMiniCard employee={emp} month={month} colors={colors} />
            </View>
          ))}
        </View>
      )}

      {activeEmployees.length === 0 && (
        <View style={{ alignItems: "center", padding: 40 }}>
          <IconSymbol name="person.2.fill" size={56} color={colors.border} />
          <Text style={{ fontSize: 18, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>暂无员工档案</Text>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 8 }}>
            点击上方按钮添加员工，设置底薪、时薪等参数
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── 薪资预支页（第三页） ─────────────────────────────────────────────────────
function AdvancePage({ month, colors }: { month: string; colors: any }) {
  const { employees } = useEmployeeStore();
  const { advances, addAdvance, updateAdvance, deleteAdvance, getAdvancesForMonth } = useSalaryAdvanceStore();
  const { records: pettyRecords } = usePettyCashStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  // 本月预支记录（含备用金 K1 自动匹配）
  const monthAdvances = useMemo(() => {
    return advances.filter((a) => a.deductMonth === month || a.date.startsWith(month));
  }, [advances, month]);

  // 从备用金 K1 记录中自动识别预支（description 包含员工代号）
  const pettyK1Records = useMemo(() => {
    return pettyRecords.filter((r) => r.code === "K1" && r.date.startsWith(month));
  }, [pettyRecords, month]);

  const totalAdvance = useMemo(() => monthAdvances.reduce((s, a) => s + a.amount, 0), [monthAdvances]);

  const getEmployee = (id: string) => employees.find((e) => e.id === id);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      {/* 汇总卡片 */}
      <View style={[{ borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#AF52DE" + "33", backgroundColor: "#AF52DE" + "08" }]}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }}>{monthLabel(month)} 薪资预支</Text>
        <Text style={{ fontSize: 28, fontWeight: "800", color: "#AF52DE", marginTop: 4 }}>
          {totalAdvance > 0 ? `¥${totalAdvance.toFixed(0)}` : "—"}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{monthAdvances.length} 笔预支记录</Text>
      </View>

      {/* 备用金 K1 自动识别提示 */}
      {pettyK1Records.length > 0 && (
        <View style={[{ borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#FF9500" + "44", backgroundColor: "#FF9500" + "08" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <IconSymbol name="bolt.fill" size={14} color="#FF9500" />
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#FF9500" }}>备用金 K1 记录（{pettyK1Records.length}笔）</Text>
          </View>
          {pettyK1Records.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, color: colors.foreground }}>{r.description || "固定兼职"}</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#FF9500" }}>¥{r.amount.toFixed(0)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 预支记录列表 */}
      {monthAdvances.length > 0 ? (
        <View style={[{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }]}>
          {monthAdvances.map((adv, i) => {
            const emp = getEmployee(adv.employeeId);
            const deptColor = emp ? DEPT_COLORS[emp.dept] : colors.muted;
            return (
              <View key={adv.id} style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <View style={[{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: deptColor + "22" }]}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: deptColor }}>{emp?.code.slice(0, 2) ?? "?"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{emp?.code ?? "未知员工"} · {adv.date.slice(5)}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{adv.notes || (adv.paidViaPetty ? "备用金支付" : "手动录入")}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: "#AF52DE" }}>¥{adv.amount.toFixed(0)}</Text>
                  <View style={[{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: adv.status === "deducted" ? "#34C75922" : "#FF950022" }]}>
                    <Text style={{ fontSize: 10, fontWeight: "600", color: adv.status === "deducted" ? "#34C759" : "#FF9500" }}>
                      {adv.status === "deducted" ? "已扣除" : "待扣除"}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={{ alignItems: "center", padding: 32 }}>
          <IconSymbol name="creditcard.fill" size={48} color={colors.border} />
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>本月暂无预支记录</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>可前往预支管理页面添加</Text>
        </View>
      )}

      {/* 跳转到完整预支管理 */}
      <TouchableOpacity onPress={() => { tap(); router.push("/labor-advances" as any); }}
        style={[{ flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#AF52DE" + "44", backgroundColor: "#AF52DE" + "08" }]}>
        <IconSymbol name="creditcard.fill" size={18} color="#AF52DE" />
        <Text style={{ fontSize: 14, fontWeight: "600", color: "#AF52DE" }}>前往完整预支管理</Text>
        <IconSymbol name="chevron.right" size={14} color="#AF52DE" style={{ marginLeft: "auto" }} />
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
const PAGES = [
  { key: "schedule", label: "排班表", icon: "calendar.badge.clock" },
  { key: "roster",   label: "员工档案", icon: "person.2.fill" },
  { key: "advances", label: "薪资预支", icon: "creditcard.fill" },
] as const;
type PageKey = typeof PAGES[number]["key"];

const PAGE_COLORS: Record<PageKey, string> = {
  schedule: "#34C759",
  roster:   "#007AFF",
  advances: "#AF52DE",
};

export default function LaborScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const month = currentMonthStr();
  const [activePage, setActivePage] = useState<PageKey>("schedule");
  const scrollRef = useRef<ScrollView>(null);

  const pageIndex = PAGES.findIndex((p) => p.key === activePage);

  const handleTabPress = (key: PageKey) => {
    tap();
    setActivePage(key);
    const idx = PAGES.findIndex((p) => p.key === key);
    scrollRef.current?.scrollTo({ x: idx * SCREEN_W, animated: true });
  };

  const handleScroll = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    const key = PAGES[idx]?.key;
    if (key && key !== activePage) setActivePage(key);
  };

  const activeColor = PAGE_COLORS[activePage];

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>员工管理</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={() => { tap(); router.push("/labor-employee-form" as any); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="person.badge.plus" size={22} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => { tap(); router.push("/labor-schedule" as any); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="calendar.badge.clock" size={22} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {/* 总览卡片 */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        <OverviewCard month={month} colors={colors} />
      </View>

      {/* Tab 切换栏 */}
      <View style={[S.tabBar, { borderBottomColor: colors.border }]}>
        {PAGES.map((p) => {
          const active = activePage === p.key;
          const col = PAGE_COLORS[p.key];
          return (
            <TouchableOpacity key={p.key} onPress={() => handleTabPress(p.key)}
              style={[S.tabBtn, active && { borderBottomColor: col, borderBottomWidth: 2.5 }]}>
              <IconSymbol name={p.icon as any} size={16} color={active ? col : colors.muted} />
              <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? col : colors.muted, marginTop: 2 }}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 横滑内容区 */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexDirection: "row" }}>
        {/* 第一页：排班表（跳转） */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
            <View style={[{ borderRadius: 14, borderWidth: 1, borderColor: "#34C759" + "44", backgroundColor: "#34C759" + "08", padding: 20, alignItems: "center", gap: 12 }]}>
              <IconSymbol name="calendar.badge.clock" size={48} color="#34C759" />
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>排班表</Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>
                午/晚班分行 · 班次模板 · 快速填充 · 加班预警
              </Text>
              <TouchableOpacity onPress={() => { tap(); router.push("/labor-schedule" as any); }}
                style={[{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: "#34C759" }]}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>打开排班表</Text>
                <IconSymbol name="chevron.right" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
            {/* 快捷入口 */}
            <View style={[{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }]}>
              {[
                { icon: "clock.fill", color: "#FF9500", title: "考勤记录", sub: "查看打卡 · 加班记录", route: "/labor-attendance" },
                { icon: "chart.bar.fill", color: "#007AFF", title: "薪资核算", sub: "考勤工资 · 最终薪资", route: "/labor-attendance" },
              ].map((item, i, arr) => (
                <Pressable key={item.route + item.title} onPress={() => { tap(); router.push(item.route as any); }}
                  style={({ pressed }) => [{ flexDirection: "row" as const, alignItems: "center" as const, gap: 12, padding: 14, opacity: pressed ? 0.7 : 1 }, i < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                  <View style={[{ width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: item.color + "22" }]}>
                    <IconSymbol name={item.icon as any} size={20} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>{item.title}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{item.sub}</Text>
                  </View>
                  <IconSymbol name="chevron.right" size={16} color={colors.muted} />
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* 第二页：员工档案 */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <EmployeeRosterPage month={month} colors={colors} />
        </View>

        {/* 第三页：薪资预支 */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <AdvancePage month={month} colors={colors} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  tabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent", gap: 2 },
});

const OV = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  title: { fontSize: 13, fontWeight: "700", marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center" },
  item: { flex: 1, alignItems: "center" },
  divider: { width: StyleSheet.hairlineWidth, height: 32 },
  label: { fontSize: 10, marginBottom: 3 },
  value: { fontSize: 18, fontWeight: "800" },
  unit: { fontSize: 12, fontWeight: "400" },
});

const PC = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  detailItem: { alignItems: "center", minWidth: 52 },
  detailLabel: { fontSize: 10, color: "#999", marginBottom: 2 },
  detailValue: { fontSize: 13, fontWeight: "600" },
});
