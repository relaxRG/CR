/**
 * 员工档案卡（只读展示）
 * 顺序与编辑表单一致：基本信息 → 部门与类型 → 工资设置 → 银行卡信息
 *   → 调休规则 → 补贴设置 → 工作绩效 → 业绩绩效
 *   → 社保（五险）→ 住房公积金 → 个人所得税
 *   → 身份证 → 健康证 → 紧急联系方式 → 备注 → 状态
 * 右上角「编辑」按钮跳转编辑表单（Modal），保存后自动返回本页
 */
import React from "react";
import { formatMoney } from "@/lib/utils";
import {
  Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useEmployeeStore, useCustomDeptStore } from "@/lib/labor/store";
import {
  DEPT_COLORS, EMPLOYEE_TYPE_LABELS, EMPLOYEE_TYPE_COLORS,
  INCOME_TAX_BRACKETS,
  REVENUE_KPI_SOURCE_LABELS, REVENUE_KPI_CALC_TYPE_LABELS,
  WEEKDAY_LABELS,
} from "@/lib/labor/types";

export default function LaborEmployeeProfileScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { employees } = useEmployeeStore();
  const { resolveEmployeeDept } = useCustomDeptStore();

  const emp = id ? employees.find((e) => e.id === id) : null;

  if (!emp) {
    return (
      <ScreenContainer>
        <View style={[S.navbar, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
          </Pressable>
          <Text style={[S.navTitle, { color: colors.foreground }]}>员工档案</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>员工不存在</Text>
        </View>
      </ScreenContainer>
    );
  }

  const dept = resolveEmployeeDept(emp);
  const deptColor = dept.color ?? DEPT_COLORS[emp.dept] ?? colors.primary;
  const isFulltime = emp.type === "fulltime" || emp.type === "longterm_parttime";
  const typeColor = EMPLOYEE_TYPE_COLORS[emp.type] ?? colors.primary;

  return (
    <ScreenContainer>
      {/* ── 标题栏 ── */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>员工档案</Text>
        <Pressable
          onPress={() => router.push({ pathname: "/labor-employee-form", params: { id: emp.id } } as any)}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.primary }}>编辑</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>

        {/* ── 员工头像卡（顶部大卡） ── */}
        <View style={[S.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[S.heroAvatar, { backgroundColor: deptColor + "22" }]}>
            <Text style={{ fontSize: 24, fontWeight: "800", color: deptColor }}>
              {emp.code.slice(0, 2)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>{emp.code}</Text>
              <Text style={{ fontSize: 15, color: colors.muted }}>{emp.realName}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <Chip label={dept.name} color={deptColor} />
              <Chip label={EMPLOYEE_TYPE_LABELS[emp.type]} color={typeColor} />
              <Chip
                label={emp.active ? "在职" : "离职"}
                color={emp.active ? colors.success : colors.error}
              />
            </View>
            {emp.phone ? (
              <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>📱 {emp.phone}</Text>
            ) : null}
          </View>
        </View>

        {/* ── 基本信息 ── */}
        <SectionCard title="基本信息" colors={colors}>
          <InfoRow label="员工代号" value={emp.code} colors={colors} />
          <InfoRow label="真实姓名" value={emp.realName} colors={colors} />
          <InfoRow label="联系方式" value={emp.phone || "—"} colors={colors} />
        </SectionCard>

        {/* ── 部门与类型 ── */}
        <SectionCard title="部门与类型" colors={colors}>
          <InfoRow label="部门" colors={colors} value="">
            <Chip label={dept.name} color={deptColor} />
          </InfoRow>
          <InfoRow label="类型" colors={colors} value="">
            <Chip label={EMPLOYEE_TYPE_LABELS[emp.type]} color={typeColor} />
          </InfoRow>
        </SectionCard>

        {/* ── 工资设置 ── */}
        <SectionCard title="工资设置" colors={colors}>
          {emp.type === "longterm_parttime" && (
            <InfoRow label="月度固定薪资" value={`¥${emp.monthlyFixedSalary ?? 0}`} colors={colors} />
          )}
          {isFulltime && (
            <>
              <InfoRow label="底薪（月）" value={`¥${emp.baseSalary}`} colors={colors} />
              {/* 灵活工时（已删除默认工时展示，全部改用灵活工时规则） */}
              {(!emp.weeklyHoursRules || emp.weeklyHoursRules.length === 0) && (
                <InfoRow label="灵活工时" value="未配置工时规则" colors={colors} />
              )}
              {emp.weeklyHoursRules && emp.weeklyHoursRules.length > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={[S.infoLabel, { color: colors.foreground }]}>灵活工时规则</Text>
                  <View style={{ gap: 4, marginTop: 4 }}>
                    {emp.weeklyHoursRules.map((rule) => {
                      const fromLabel = WEEKDAY_LABELS[rule.fromDay] ?? String(rule.fromDay);
                      const toLabel = WEEKDAY_LABELS[rule.toDay] ?? String(rule.toDay);
                      return (
                        <Text key={rule.id} style={{ fontSize: 13, color: colors.muted }}>
                          {fromLabel} ~ {toLabel}：{rule.hours}h / 天
                        </Text>
                      );
                    })}
                  </View>
                </View>
              )}
              <InfoRow label="月休息天数" value={`${emp.restDaysPerMonth} 天`} colors={colors} />
            </>
          )}
          {emp.type === "parttime" ? (
            <>
              <InfoRow label="计费模式" value={emp.parttimeMode === "daily" ? "按天结算" : "按小时结算"} colors={colors} />
              {emp.parttimeMode === "daily" ? (
                <InfoRow label="兼职日薪" value={`¥${emp.baseSalary} / 天`} colors={colors} />
              ) : (
                <InfoRow label="兼职时薪" value={`¥${emp.overtimeHourlyRate} / 小时`} colors={colors} />
              )}
            </>
          ) : (
            <>
              <InfoRow label="正常时薪（参考）" value={`¥${emp.hourlyRate} / 小时`} colors={colors} />
              {isFulltime && (
                <InfoRow label="加班时薪（实际计算）" value={`¥${emp.overtimeHourlyRate} / 小时`} colors={colors} />
              )}
            </>
          )}
        </SectionCard>

        {/* ── 银行卡信息 ── */}
        {emp.bankAccounts && emp.bankAccounts.length > 0 && (
          <SectionCard title="银行卡信息" colors={colors}>
            {emp.bankAccounts.map((account) => (
              <View key={account.id} style={[S.bankCard, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "33" }]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{account.accountName}</Text>
                    {account.isDefault && <Chip label="默认" color={colors.primary} small />}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{account.bankName}</Text>
                  <Text style={{ fontSize: 13, color: colors.foreground, marginTop: 2, letterSpacing: 1 }}>
                    {account.cardNumber.replace(/(.{4})/g, "$1 ").trim()}
                  </Text>
                  {account.note ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{account.note}</Text> : null}
                </View>
              </View>
            ))}
          </SectionCard>
        )}

        {/* ── 调休规则 ── */}
        {isFulltime && emp.compOffRule && (
          <SectionCard title="调休规则" colors={colors}>
            <InfoRow
              label="加班换休"
              value={emp.compOffRule.enabled ? `已开启 · ${emp.compOffRule.hoursPerDay}小时加班换一天休` : "未开启"}
              colors={colors}
            />
          </SectionCard>
        )}

        {/* ── 补贴设置 ── */}
        {emp.allowanceRules && emp.allowanceRules.length > 0 && (
          <SectionCard title="补贴设置" colors={colors}>
            {emp.allowanceRules.map((rule) => (
              <InfoRow
                key={rule.id}
                label={rule.label}
                value={`¥${rule.amount} / ${rule.unit === "per_day" ? "天" : "月"}`}
                colors={colors}
              />
            ))}
          </SectionCard>
        )}

        {/* ── 工作绩效 ── */}
        {emp.workKPIRules && emp.workKPIRules.length > 0 && (
          <SectionCard title="工作绩效" colors={colors}>
            {emp.workKPIRules.map((rule) => (
              <View key={rule.id} style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>
                  {rule.name || "未命名"} · {rule.cycle === "monthly" ? "每月" : "每季度"}
                </Text>
                {rule.tiers.sort((a, b) => a.sortOrder - b.sortOrder).map((tier) => (
                  <View key={tier.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tier.amount > 0 ? colors.success : tier.amount < 0 ? colors.error : colors.muted }} />
                    <Text style={{ fontSize: 13, color: colors.foreground, width: 60 }}>{tier.label}</Text>
                    <Text style={{ fontSize: 13, fontWeight: "500", color: tier.amount > 0 ? colors.success : tier.amount < 0 ? colors.error : colors.muted }}>
                      {tier.amount > 0 ? `+¥${tier.amount}` : tier.amount < 0 ? `-¥${Math.abs(tier.amount)}` : "¥0"}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </SectionCard>
        )}

        {/* ── 业绩绩效 ── */}
        {emp.revenueKPIRules && emp.revenueKPIRules.length > 0 && (
          <SectionCard title="业绩绩效" colors={colors}>
            {emp.revenueKPIRules.map((rule) => (
              <View key={rule.id} style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 2 }}>
                  {rule.name || "未命名"}
                </Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>
                  {REVENUE_KPI_SOURCE_LABELS[rule.source]} · {REVENUE_KPI_CALC_TYPE_LABELS[rule.calcType]}
                </Text>
                {rule.tiers.map((tier) => (
                  <Text key={tier.id} style={{ fontSize: 12, color: colors.foreground }}>
                    ≥¥{tier.threshold.toLocaleString()} → {rule.calcType === "percentage" ? `${tier.amount}%` : `+¥${tier.amount}`}
                  </Text>
                ))}
              </View>
            ))}
          </SectionCard>
        )}

        {/* ── 社保（五险）── */}
        {emp.socialInsurance?.enabled && (
          <SectionCard title="社保（五险）" colors={colors}>
            {emp.socialInsurance.city ? (
              <InfoRow label="城市" value={emp.socialInsurance.city} colors={colors} />
            ) : null}
            {emp.socialInsurance.base > 0 && (
              <InfoRow label="社保基数" value={`¥${emp.socialInsurance.base.toLocaleString()}`} colors={colors} />
            )}
            {emp.socialInsurance.dataSource && (
              <InfoRow
                label="数据来源"
                value={emp.socialInsurance.dataSource === "builtin" ? "内置数据 2025年" : emp.socialInsurance.dataSource === "network" ? "联网更新" : "手动修改"}
                colors={colors}
              />
            )}
            <View style={{ gap: 2, marginTop: 4 }}>
              {(["pension", "medical", "unemployment", "workInjury", "maternity"] as const).map((key) => {
                const item = emp.socialInsurance![key];
                if (!item?.enabled) return null;
                return (
                  <View key={key} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>{item.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>
                      个人 {(item.employeeRate * 100).toFixed(2)}% · 单位 {(item.employerRate * 100).toFixed(2)}%
                    </Text>
                  </View>
                );
              })}
            </View>
          </SectionCard>
        )}

        {/* ── 住房公积金 ── */}
        {emp.socialInsurance?.housingFund?.enabled && (
          <SectionCard title="住房公积金" colors={colors}>
            {emp.socialInsurance.housingFund.base > 0 && (
              <InfoRow label="公积金基数" value={`¥${emp.socialInsurance.housingFund.base.toLocaleString()}`} colors={colors} />
            )}
            <InfoRow
              label="缴存比例"
              value={`个人 ${(emp.socialInsurance.housingFund.employeeRate * 100).toFixed(0)}% · 单位 ${(emp.socialInsurance.housingFund.employerRate * 100).toFixed(0)}%`}
              colors={colors}
            />
          </SectionCard>
        )}

        {/* ── 个人所得税 ── */}
        {emp.incomeTax?.enabled && (
          <SectionCard title="个人所得税" colors={colors}>
            <InfoRow label="起征点" value={`¥${emp.incomeTax.threshold.toLocaleString()} / 月`} colors={colors} />
            {emp.incomeTax.specialDeductions > 0 && (
              <InfoRow label="专项附加扣除" value={`¥${emp.incomeTax.specialDeductions} / 月`} colors={colors} />
            )}
            {emp.incomeTax.dataSource && (
              <InfoRow
                label="数据来源"
                value={emp.incomeTax.dataSource === "builtin" ? "全国统一 2025年" : "手动修改"}
                colors={colors}
              />
            )}
            {/* 税率表（内置，只读展示） */}
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>税率表（系统内置 · 2025年）</Text>
              <View style={{ flexDirection: "row", paddingHorizontal: 4, paddingBottom: 4 }}>
                <Text style={{ flex: 3, fontSize: 10, color: colors.muted }}>月应纳税所得额</Text>
                <Text style={{ flex: 1, fontSize: 10, color: colors.muted, textAlign: "center" }}>税率</Text>
                <Text style={{ flex: 1.5, fontSize: 10, color: colors.muted, textAlign: "right" }}>速算扣除数</Text>
              </View>
              {INCOME_TAX_BRACKETS.map((b, i) => (
                <View key={i} style={{ flexDirection: "row", paddingVertical: 4, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "44" }}>
                  <Text style={{ flex: 3, fontSize: 11, color: colors.foreground }}>
                    {b.max === Infinity ? `超过 ¥${(b.min / 12).toLocaleString()}` : `¥${(b.min / 12).toLocaleString()} ~ ¥${(b.max / 12).toLocaleString()}`}
                  </Text>
                  <Text style={{ flex: 1, fontSize: 11, color: colors.primary, textAlign: "center" }}>{(b.rate * 100).toFixed(0)}%</Text>
                  <Text style={{ flex: 1.5, fontSize: 11, color: colors.muted, textAlign: "right" }}>¥{formatMoney((b.quickDeduction / 12))}</Text>
                </View>
              ))}
            </View>
          </SectionCard>
        )}

        {/* ── 身份证 ── */}
        {(emp.idNumber || emp.idCardFrontUrl || emp.idCardBackUrl) && (
          <SectionCard title="身份证" colors={colors}>
            {emp.realName && <InfoRow label="真实姓名" value={emp.realName} colors={colors} />}
            {emp.idNumber && (
              <InfoRow
                label="身份证号"
                value={emp.idNumber.length >= 6
                  ? emp.idNumber.slice(0, 6) + "****" + emp.idNumber.slice(-4)
                  : emp.idNumber}
                colors={colors}
              />
            )}
            {(emp.idCardFrontUrl || emp.idCardBackUrl) && (
              <View style={{ marginBottom: 8 }}>
                <Text style={[S.infoLabel, { color: colors.foreground, marginBottom: 8 }]}>身份证照片</Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <PhotoView label="正面" uri={emp.idCardFrontUrl ?? ""} colors={colors} />
                  <PhotoView label="反面" uri={emp.idCardBackUrl ?? ""} colors={colors} />
                </View>
              </View>
            )}
          </SectionCard>
        )}

        {/* ── 健康证 ── */}
        {(emp.healthCertExpiry || emp.healthCertUrl) && (
          <SectionCard title="健康证" colors={colors}>
            {emp.healthCertExpiry && (
              <InfoRow label="有效期至" value={emp.healthCertExpiry} colors={colors} />
            )}
            {emp.healthCertUrl && (
              <View style={{ marginBottom: 8 }}>
                <Text style={[S.infoLabel, { color: colors.foreground, marginBottom: 8 }]}>健康证照片</Text>
                <PhotoView label="健康证" uri={emp.healthCertUrl} colors={colors} />
              </View>
            )}
          </SectionCard>
        )}

        {/* ── 紧急联系方式 ── */}
        {(emp.actualAddress || emp.emergencyContactName || emp.emergencyContactPhone) && (
          <SectionCard title="紧急联系方式" colors={colors}>
            {emp.actualAddress && <InfoRow label="实际住址" value={emp.actualAddress} colors={colors} />}
            {emp.emergencyContactName && <InfoRow label="紧急联系人" value={emp.emergencyContactName} colors={colors} />}
            {emp.emergencyContactRelation && <InfoRow label="关系" value={emp.emergencyContactRelation} colors={colors} />}
            {emp.emergencyContactPhone && <InfoRow label="联系电话" value={emp.emergencyContactPhone} colors={colors} />}
          </SectionCard>
        )}

        {/* ── 备注 ── */}
        {emp.notes ? (
          <SectionCard title="备注" colors={colors}>
            <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 20 }}>{emp.notes}</Text>
          </SectionCard>
        ) : null}

        {/* ── 状态 ── */}
        <SectionCard title="状态" colors={colors}>
          <InfoRow label="在职状态" colors={colors} value="">
            <Chip label={emp.active ? "在职" : "离职"} color={emp.active ? colors.success : colors.error} />
          </InfoRow>
          {emp.joinDate && <InfoRow label="入职日期" value={emp.joinDate} colors={colors} />}
          {emp.leaveDate && <InfoRow label="离职日期" value={emp.leaveDate} colors={colors} />}
          {emp.createdAt && (
            <InfoRow label="创建时间" value={emp.createdAt.slice(0, 10)} colors={colors} />
          )}
        </SectionCard>

      </ScrollView>
    </ScreenContainer>
  );
}

// ─── 小标签 Chip ──────────────────────────────────────────────────────────────
function Chip({ label, color, small }: { label: string; color: string; small?: boolean }) {
  return (
    <View style={{
      paddingHorizontal: small ? 7 : 10,
      paddingVertical: small ? 2 : 4,
      borderRadius: 8,
      backgroundColor: color + "22",
    }}>
      <Text style={{ fontSize: small ? 10 : 12, fontWeight: "700", color }}>{label}</Text>
    </View>
  );
}

// ─── 信息行 ──────────────────────────────────────────────────────────────────
function InfoRow({
  label, value, colors, valueColor, children,
}: {
  label: string;
  value: string;
  colors: any;
  valueColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={S.infoRow}>
      <Text style={[S.infoLabel, { color: colors.foreground }]}>{label}</Text>
      {children ?? (
        <Text style={{ fontSize: 14, color: valueColor ?? colors.muted, flex: 1, textAlign: "right" }} numberOfLines={3}>
          {value || "—"}
        </Text>
      )}
    </View>
  );
}

// ─── 照片展示 ─────────────────────────────────────────────────────────────────
function PhotoView({ label, uri, colors }: { label: string; uri: string; colors: any }) {
  if (!uri) {
    return (
      <View style={{ alignItems: "center", gap: 4 }}>
        <View style={{ width: 100, height: 70, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 10, color: colors.muted }}>{label}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <Image source={{ uri }} style={{ width: 100, height: 70, borderRadius: 10 }} resizeMode="cover" />
      <Text style={{ fontSize: 10, color: colors.muted }}>{label}</Text>
    </View>
  );
}

// ─── SectionCard ─────────────────────────────────────────────────────────────
function SectionCard({ title, children, colors }: {
  title: string; children: React.ReactNode; colors: any;
}) {
  return (
    <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[S.sectionTitle, { color: colors.muted }]}>{title.toUpperCase()}</Text>
      <View style={{ marginTop: 10 }}>
        {children}
      </View>
    </View>
  );
}

// ─── 样式 ─────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  navbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: { fontSize: 17, fontWeight: "600" },
  heroCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 14,
    borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12,
  },
  heroAvatar: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
  },
  sectionCard: {
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase",
  },
  infoRow: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.06)",
    gap: 8,
  },
  infoLabel: {
    fontSize: 13, fontWeight: "500", minWidth: 80,
  },
  bankCard: {
    flexDirection: "row", alignItems: "flex-start",
    borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8,
  },
});
