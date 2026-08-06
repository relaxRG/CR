/**
 * 设备权限配置页
 *
 * 功能：
 * 1. 查看指定设备的当前角色和功能权限
 * 2. 自定义角色显示名称（本地存储）
 * 3. 开关各功能模块的同步权限（写入 allowedKeys）
 * 4. 转移主设备权限（owner → 本机降级为 collaborator）
 */
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import {
  kickDevice,
  updateDeviceRole,
  type DeviceRole,
  type RemoteDevice,
  listDevices,
  getDeviceInfo,
} from "@/lib/cf-sync/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// ─── 功能模块定义（全覆盖 SYNC_KEYS 中所有 100 个键）─────────────────────────────
export type FeatureKey =
  | "recipes"        // 配方库
  | "bottles"        // 酒款库
  | "homemade"       // 自制品
  | "lab"            // 研发室
  | "books"          // 书库
  | "menu"           // 门店酒单 + 套餐
  | "shopping"       // 采购清单
  | "wine"           // 葡萄酒库
  | "food"           // 餐食菜单
  | "spirits"        // 烈酒库存
  | "beer"           // 啤酒库存
  | "fruit"          // 水果库存
  | "ice"            // 冰块库存
  | "equipment"      // 器具库存
  | "store_ops"      // 门店运营（月报/备用金/库存管理）
  | "labor"          // 员工管理（排班/考勤/底薪）
  | "payroll"        // 薪资数据（薪资单/预支/全局设置）
  | "prefs";         // 偏好设置（收藏/评分/语言）

export const FEATURE_MODULES: {
  key: FeatureKey;
  labelZh: string;
  labelEn: string;
  icon: string;
  color: string;
  descZh: string;
  descEn: string;
  storageKeys: string[];
}[] = [
  {
    key: "recipes",
    labelZh: "配方库",
    labelEn: "Recipes",
    icon: "🍸",
    color: "#0A84FF",
    descZh: "配方、分类、标签、偏好",
    descEn: "Recipes, categories, tags, prefs",
    storageKeys: [
      "cocktail.recipes",
      "cocktail.categories",
      "cocktail.tags",
      "cocktail.tagGroups",
      "cocktail.categoryGroups",
      "cocktail.seeded",
      "cocktail_waldorf_imported_v1",
    ],
  },
  {
    key: "bottles",
    labelZh: "酒款库",
    labelEn: "Bottles",
    icon: "🍾",
    color: "#FF9500",
    descZh: "酒款信息、分类体系",
    descEn: "Bottle info, taxonomy",
    storageKeys: [
      "cocktail.bottles",
      "cocktail.bottles.seeded",
      "cocktail.bottles.waldorf.v1",
      "bottles.taxonomy.categories.v1",
      "bottles.taxonomy.styles.v1",
    ],
  },
  {
    key: "homemade",
    labelZh: "自制品",
    labelEn: "Homemade",
    icon: "🧪",
    color: "#34C759",
    descZh: "自制配料、分类、来源",
    descEn: "Homemade preps, categories, sources",
    storageKeys: [
      "homemade.preps.v1",
      "homemade.seeded.v1",
      "homemade.sections.v1",
      "homemade.types.v1",
      "homemade.taxonomy.v2",
      "homemade.waldorf.v1",
      "homemade.waldorf.v2",
      "homemade.source.v3",
    ],
  },
  {
    key: "lab",
    labelZh: "研发室",
    labelEn: "Lab",
    icon: "⚗️",
    color: "#5856D6",
    descZh: "研发项目、批次记录、研发计划",
    descEn: "Lab projects, batches, plans",
    storageKeys: ["cocktail.lab.projects", "cocktail.lab.batches", "lab.plan.v1"],
  },
  {
    key: "books",
    labelZh: "书库",
    labelEn: "Books",
    icon: "📚",
    color: "#FF2D55",
    descZh: "酒小课、EPUB 书籍",
    descEn: "Books and EPUB library",
    storageKeys: ["cocktail.books.v1"],
  },
  {
    key: "menu",
    labelZh: "门店酒单",
    labelEn: "Menu",
    icon: "🗒️",
    color: "#FF6B35",
    descZh: "酒单内容、套餐配置",
    descEn: "Menu items and packages",
    storageKeys: ["menu_store_v1", "menu.packages.v1"],
  },
  {
    key: "shopping",
    labelZh: "采购清单",
    labelEn: "Shopping",
    icon: "🛒",
    color: "#30B0C7",
    descZh: "采购项目列表",
    descEn: "Shopping list",
    storageKeys: ["shopping_store_v1"],
  },
  {
    key: "wine",
    labelZh: "葡萄酒库",
    labelEn: "Wine",
    icon: "🍷",
    color: "#9B59B6",
    descZh: "葡萄酒款、快照、采购记录",
    descEn: "Wine bottles, snapshots, purchases",
    storageKeys: ["wine.bottles.v1", "wine.snapshots.v2", "wine.manual_purchases.v1"],
  },
  {
    key: "food",
    labelZh: "餐食菜单",
    labelEn: "Food",
    icon: "🍽️",
    color: "#E67E22",
    descZh: "菜单、食材、采购记录",
    descEn: "Food menu, ingredients, purchases",
    storageKeys: ["food.menu.v1", "food.ingredients.v2", "food.purchases.v1"],
  },
  {
    key: "spirits",
    labelZh: "烈酒库存",
    labelEn: "Spirits Inventory",
    icon: "🥃",
    color: "#C0392B",
    descZh: "烈酒库存、采购、台账、供应商",
    descEn: "Spirits stock, purchases, ledger, suppliers",
    storageKeys: [
      "spirits.items.v3",
      "spirits.purchases.v3",
      "spirits.ledger.v3",
      "spirits.refPrices.v1",
      "spirits.suppliers.v1",
      "spirits.groups.v1",
      "spirits.matchMemory.v1",
      "spirits.selfBuyConfig.v1",
      "spirits.customCategories.v1",
      "spirits.groupMatchMemory.v1",
      "spirits.snapshots.v1",
      "spirits.match_records.v1",
      "supplier.match.memory.v1",
    ],
  },
  {
    key: "beer",
    labelZh: "啤酒库存",
    labelEn: "Beer Inventory",
    icon: "🍺",
    color: "#F39C12",
    descZh: "啤酒库存、交易记录、快照",
    descEn: "Beer stock, transactions, snapshots",
    storageKeys: ["beer.items.v1", "beer.transactions.v1", "beer.snapshots.v1"],
  },
  {
    key: "fruit",
    labelZh: "水果库存",
    labelEn: "Fruit Inventory",
    icon: "🍊",
    color: "#27AE60",
    descZh: "水果库存、交易记录、快照",
    descEn: "Fruit stock, transactions, snapshots",
    storageKeys: ["fruit.items.v1", "fruit.transactions.v1", "fruit.snapshots.v1"],
  },
  {
    key: "ice",
    labelZh: "冰块库存",
    labelEn: "Ice Inventory",
    icon: "❄️",
    color: "#3498DB",
    descZh: "冰块库存、冰泡设置、成本配置",
    descEn: "Ice inventory, bubble settings, cost config",
    storageKeys: ["ice.inv.items.v1", "ice.inv.tx.v1", "ice.inventory.v1", "cocktail.iceSettings.v2"],
  },
  {
    key: "equipment",
    labelZh: "器具库存",
    labelEn: "Equipment",
    icon: "🔧",
    color: "#7F8C8D",
    descZh: "器具设备清单",
    descEn: "Equipment inventory",
    storageKeys: ["equipment.inventory.v1"],
  },
  {
    key: "store_ops",
    labelZh: "门店运营",
    labelEn: "Store Operations",
    icon: "🏪",
    color: "#1ABC9C",
    descZh: "月报、备用金、供应商货款、库存管理、经营分析",
    descEn: "Monthly reports, petty cash, suppliers, inventory, analytics",
    storageKeys: [
      "store.revenue.v1",
      "store.petty.v1",
      "store.petty_categories.v1",
      "store.petty_inv_links.v1",
      "store.petty_labor_links.v1",
      "store.employee_name_aliases.v1",
      "store.inventory.v1",
      "monthly_summary.reports.v1",
      "monthly_summary.suppliers.v1",
      "monthly_summary.payments.v1",
      "monthly_summary.balances.v1",
      "monthly_summary.petty_configs.v1",
      "monthly_summary.inventory_configs.v1",
      "monthly_reports_v1",
      "period_analysis.reports.v1",
      "period_analysis.settings.v1",
      "schedule.business_hours.v1",
      "schedule.shift_templates.v1",
      "dish_analysis.snapshots.v1",
    ],
  },
  {
    key: "labor",
    labelZh: "员工管理",
    labelEn: "Staff Management",
    icon: "👥",
    color: "#2980B9",
    descZh: "员工档案、排班表、考勤记录、节假日配置",
    descEn: "Employees, shifts, attendance, holiday configs",
    storageKeys: [
      "labor_employees_v1",
      "labor_employee_groups_v1",
      "labor_shifts_v1",
      "labor_shift_templates_v1",
      "labor_attendance_v1",
      "labor_month_configs_v1",
      "labor_holiday_configs_v1",
      "labor_comp_off_v1",
      "labor_comp_off_entries_v1",
      "labor_holiday_comp_off_v1",
      "labor_unexplained_rest_alerts_v1",
      "labor_special_statuses_v1",
      "labor_custom_depts_v1",
      "labor_business_hours_v1",
      "labor_shift_groups_v1",
      "labor_fill_presets_v1",
    ],
  },
  {
    key: "payroll",
    labelZh: "薪资数据",
    labelEn: "Payroll",
    icon: "💰",
    color: "#E74C3C",
    descZh: "薪资单、预支记录、绩效模板、全局薪资设置",
    descEn: "Pay slips, advances, performance templates, global settings",
    storageKeys: [
      "labor_payslips_v1",
      "labor.salary_advances.v1",
      "labor.advance_categories.v1",
      "labor_performance_templates_v1",
      "labor_performance_records_v1",
      "labor_global_payroll_settings_v1",
    ],
  },
  {
    key: "prefs",
    labelZh: "偏好设置",
    labelEn: "Preferences",
    icon: "⭐",
    color: "#95A5A6",
    descZh: "收藏、评分、已制作、语言设置",
    descEn: "Favorites, ratings, made status, language",
    storageKeys: ["cocktail.prefs.v1", "app.lang.v1"],
  },
];

// ─── 自定义角色名称存储 ───────────────────────────────────────────────────────
const CUSTOM_ROLE_NAMES_KEY = "device.customRoleNames.v1";

export async function getCustomRoleName(deviceId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_ROLE_NAMES_KEY);
    if (!raw) return null;
    const map: Record<string, string> = JSON.parse(raw);
    return map[deviceId] ?? null;
  } catch {
    return null;
  }
}

export async function setCustomRoleName(deviceId: string, name: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_ROLE_NAMES_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    if (name.trim()) {
      map[deviceId] = name.trim();
    } else {
      delete map[deviceId];
    }
    await AsyncStorage.setItem(CUSTOM_ROLE_NAMES_KEY, JSON.stringify(map));
  } catch {}
}

// ─── allowedKeys ↔ FeatureKey 转换 ───────────────────────────────────────────
export function allowedKeysToFeatures(allowedKeys: string[] | null): Set<FeatureKey> {
  if (!allowedKeys) {
    // null = 全部权限
    return new Set(FEATURE_MODULES.map((m) => m.key));
  }
  const result = new Set<FeatureKey>();
  for (const mod of FEATURE_MODULES) {
    if (mod.storageKeys.some((k) => allowedKeys.includes(k))) {
      result.add(mod.key);
    }
  }
  return result;
}

export function featuresToAllowedKeys(features: Set<FeatureKey>): string[] | null {
  // 全部选中 → null（无限制）
  if (features.size === FEATURE_MODULES.length) return null;
  const keys: string[] = [];
  for (const mod of FEATURE_MODULES) {
    if (features.has(mod.key)) {
      keys.push(...mod.storageKeys);
    }
  }
  return keys;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RoleSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const params = useLocalSearchParams<{
    deviceId: string;
    deviceName: string;
    deviceRole: string;
    allowedKeys: string; // JSON string or ""
  }>();

  const deviceId = params.deviceId ?? "";
  const deviceName = params.deviceName ?? "";
  const initialRole = (params.deviceRole ?? "collaborator") as DeviceRole;
  const initialAllowedKeys: string[] | null = (() => {
    try {
      return params.allowedKeys ? JSON.parse(params.allowedKeys) : null;
    } catch {
      return null;
    }
  })();

  const [role, setRole] = useState<DeviceRole>(initialRole);
  const [enabledFeatures, setEnabledFeatures] = useState<Set<FeatureKey>>(
    allowedKeysToFeatures(initialAllowedKeys),
  );
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);
  const [isOwnerDevice, setIsOwnerDevice] = useState(false);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // 加载自定义角色名称
  useEffect(() => {
    void getCustomRoleName(deviceId).then((n) => setCustomName(n ?? ""));
  }, [deviceId]);

  // 检查当前设备是否是主设备
  useEffect(() => {
    void getDeviceInfo().then((info) => {
      setIsOwnerDevice(info?.role === "owner");
    });
  }, []);

  const toggleFeature = (key: FeatureKey) => {
    tap();
    setEnabledFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // 至少保留一个功能
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!isOwnerDevice) {
      Alert.alert(
        lang === "zh" ? "无权限" : "No Permission",
        lang === "zh" ? "只有主设备才能修改其他设备的权限。" : "Only the owner device can change permissions.",
      );
      return;
    }
    setSaving(true);
    try {
      const allowedKeys = featuresToAllowedKeys(enabledFeatures);
      await updateDeviceRole(deviceId, role, allowedKeys);
      await setCustomRoleName(deviceId, customName);
      tap();
      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        lang === "zh" ? "已保存" : "Saved",
        lang === "zh" ? "设备权限已更新。" : "Device permissions updated.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert(lang === "zh" ? "保存失败" : "Failed", String(e));
    } finally {
      setSaving(false);
    }
  };

  // 转移主设备权限
  const handleTransferOwner = () => {
    if (!isOwnerDevice) return;
    const msg = lang === "zh"
      ? `将主设备权限转移给「${deviceName}」？\n\n本机将降级为协作者，${deviceName} 将成为新的主设备，拥有全部管理权限。`
      : `Transfer owner role to "${deviceName}"?\n\nThis device will become a collaborator. "${deviceName}" will be the new owner with full admin access.`;
    Alert.alert(
      lang === "zh" ? "转移主设备权限" : "Transfer Owner",
      msg,
      [
        { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
        {
          text: lang === "zh" ? "确认转移" : "Transfer",
          style: "destructive",
          onPress: () => void doTransferOwner(),
        },
      ],
    );
  };

  const doTransferOwner = async () => {
    setSaving(true);
    try {
      // 1. 将目标设备升级为 owner
      await updateDeviceRole(deviceId, "owner", null);
      // 2. 本机本地角色降级为 collaborator（写入 SecureStore / AsyncStorage）
      const localInfo = await getDeviceInfo();
      if (localInfo) {
        const key = "cf.sync.deviceRole";
        if (Platform.OS === "web") {
          await AsyncStorage.setItem(key, "collaborator");
        } else {
          await SecureStore.setItemAsync(key, "collaborator");
        }
      }
      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        lang === "zh" ? "转移成功" : "Transfer Complete",
        lang === "zh"
          ? `已将主设备权限转移给「${deviceName}」。本机已降级为协作者，请重新进入设备管理页面查看最新状态。`
          : `Owner role transferred to "${deviceName}". This device is now a collaborator. Please reopen Device Manager to see the updated status.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert(lang === "zh" ? "转移失败" : "Failed", String(e));
    } finally {
      setSaving(false);
    }
  };

  const ROLE_OPTIONS: { value: DeviceRole; labelZh: string; labelEn: string; color: string; descZh: string; descEn: string }[] = [
    {
      value: "collaborator",
      labelZh: "协作者",
      labelEn: "Collaborator",
      color: "#34C759",
      descZh: "可读写选定功能模块",
      descEn: "Read & write selected modules",
    },
    {
      value: "guest",
      labelZh: "访客",
      labelEn: "Guest",
      color: "#FF9500",
      descZh: "只读，不同步回主设备",
      descEn: "Read-only, no push back",
    },
  ];

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => { tap(); router.back(); }}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left.forwardslash.chevron.right" size={20} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {deviceName}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {lang === "zh" ? "权限配置" : "Permission Settings"}
          </Text>
        </View>
        <Pressable
          onPress={() => { tap(); void handleSave(); }}
          disabled={saving || !isOwnerDevice}
          style={({ pressed }) => [styles.saveBtn, { opacity: pressed || saving || !isOwnerDevice ? 0.5 : 1 }]}
        >
          <Text style={[styles.saveBtnText, { color: colors.primary }]}>
            {saving ? (lang === "zh" ? "保存中…" : "Saving…") : (lang === "zh" ? "保存" : "Save")}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* 非主设备提示 */}
        {!isOwnerDevice && (
          <View style={[styles.warnCard, { backgroundColor: "#FF950020", borderColor: "#FF9500" }]}>
            <Text style={{ color: "#FF9500", fontSize: 13, lineHeight: 18 }}>
              {lang === "zh"
                ? "⚠️ 只有主设备才能修改其他设备的权限。当前设备不是主设备，以下设置为只读。"
                : "⚠️ Only the owner device can change permissions. This device is not the owner, settings are read-only."}
            </Text>
          </View>
        )}

        {/* 自定义角色名称 */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            {lang === "zh" ? "自定义角色名称" : "Custom Role Name"}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              value={customName}
              onChangeText={setCustomName}
              placeholder={lang === "zh" ? "例如：吧台设备、厨房 iPad…" : "e.g. Bar iPad, Kitchen Device…"}
              placeholderTextColor={colors.muted}
              style={[styles.textInput, { color: colors.foreground, borderColor: colors.border }]}
              editable={isOwnerDevice}
              returnKeyType="done"
              maxLength={20}
            />
            <Text style={[styles.hint, { color: colors.muted }]}>
              {lang === "zh"
                ? "仅在本机显示，不影响同步功能。留空则显示系统角色名。"
                : "Displayed locally only. Leave empty to use the system role name."}
            </Text>
          </View>
        </View>

        {/* 角色选择（非 owner 设备才可切换） */}
        {role !== "owner" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              {lang === "zh" ? "角色类型" : "Role Type"}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {ROLE_OPTIONS.map((opt, idx) => (
                <View key={opt.value}>
                  {idx > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />}
                  <Pressable
                    onPress={() => { if (isOwnerDevice) { tap(); setRole(opt.value); } }}
                    style={({ pressed }) => [styles.roleRow, pressed && isOwnerDevice && { opacity: 0.7 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.roleLabel, { color: opt.color }]}>
                        {lang === "zh" ? opt.labelZh : opt.labelEn}
                      </Text>
                      <Text style={[styles.roleDesc, { color: colors.muted }]}>
                        {lang === "zh" ? opt.descZh : opt.descEn}
                      </Text>
                    </View>
                    {role === opt.value && (
                      <View style={[styles.checkDot, { backgroundColor: opt.color }]} />
                    )}
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 功能权限开关（访客不可写，仅展示） */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            {lang === "zh" ? "功能权限" : "Feature Permissions"}
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.muted }]}>
            {role === "guest"
              ? (lang === "zh" ? "访客设备只读，无法写入任何功能模块。" : "Guest devices are read-only for all modules.")
              : (lang === "zh" ? "关闭的模块将不会同步到该设备（拉取和推送均受限）。" : "Disabled modules will not sync to this device.")}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {FEATURE_MODULES.map((mod, idx) => (
              <View key={mod.key}>
                {idx > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 }} />}
                <View style={styles.featureRow}>
                  <Text style={styles.featureIcon}>{mod.icon}</Text>
                  <Text style={[styles.featureLabel, { color: colors.foreground }]}>
                    {lang === "zh" ? mod.labelZh : mod.labelEn}
                  </Text>
                  <Switch
                    value={enabledFeatures.has(mod.key)}
                    onValueChange={() => {
                      if (isOwnerDevice && role !== "guest") toggleFeature(mod.key);
                    }}
                    disabled={!isOwnerDevice || role === "guest"}
                    trackColor={{ false: colors.border, true: mod.color + "80" }}
                    thumbColor={enabledFeatures.has(mod.key) ? mod.color : colors.muted}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* 转移主设备权限（仅当前设备是 owner 且目标不是 owner 时显示） */}
        {isOwnerDevice && role !== "owner" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              {lang === "zh" ? "主设备权限" : "Owner Transfer"}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                onPress={() => { tap(); handleTransferOwner(); }}
                style={({ pressed }) => [styles.dangerRow, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.dangerIcon, { backgroundColor: "#FF950020" }]}>
                  <IconSymbol name="house.fill" size={18} color="#FF9500" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dangerLabel, { color: "#FF9500" }]}>
                    {lang === "zh" ? "转移主设备权限给此设备" : "Transfer Owner to This Device"}
                  </Text>
                  <Text style={[styles.dangerDesc, { color: colors.muted }]}>
                    {lang === "zh"
                      ? "本机将降级为协作者，此设备成为新主设备"
                      : "This device becomes owner; current device becomes collaborator"}
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600", lineHeight: 22 },
  subtitle: { fontSize: 12, lineHeight: 16 },
  saveBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  saveBtnText: { fontSize: 17, fontWeight: "600" },
  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginLeft: 4 },
  sectionDesc: { fontSize: 12, lineHeight: 16, marginBottom: 8, marginLeft: 4 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  warnCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  textInput: {
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hint: { fontSize: 12, lineHeight: 16, paddingHorizontal: 16, paddingVertical: 8 },
  roleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  roleLabel: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  roleDesc: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  checkDot: { width: 10, height: 10, borderRadius: 5 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  featureIcon: { fontSize: 22, width: 28, textAlign: "center" },
  featureLabel: { flex: 1, fontSize: 15, lineHeight: 20 },
  dangerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  dangerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dangerLabel: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  dangerDesc: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
