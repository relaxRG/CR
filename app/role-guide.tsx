import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { BUSINESS_TABS, type BusinessTab } from "@/lib/sync/capabilities";

type TabGuide = {
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
};

const TAB_GUIDE: Record<BusinessTab, TabGuide> = {
  cocktail: { zh: "鸡尾酒", en: "Cocktail", descriptionZh: "配方、酒款、自制、酒单与采购", descriptionEn: "Recipes, bottles, homemade, menus and shopping" },
  wine: { zh: "葡萄酒", en: "Wine", descriptionZh: "葡萄酒档案、库存、采购与供应商关联", descriptionEn: "Wine catalog, inventory, purchasing and supplier links" },
  lab: { zh: "研发", en: "Lab", descriptionZh: "研发项目、批次、计划与自制研发数据", descriptionEn: "Projects, batches, plans and R&D data" },
  food: { zh: "餐食", en: "Food", descriptionZh: "菜单、食材、采购和食材库存", descriptionEn: "Menus, ingredients, purchasing and food inventory" },
  store: { zh: "门店", en: "Store", descriptionZh: "报表、员工、薪资、备用金、全部库存、店铺、账户与供应商", descriptionEn: "Reports, staff, payroll, petty cash, all inventory, operations, accounts and suppliers" },
};

const ROLE_GUIDE = {
  owner: {
    zh: "主设备：始终拥有五个业务Tab，并独占设备组、配对、备份、成员和主设备交接管理。",
    en: "Owner: always has all five business tabs and exclusively manages the device group, pairing, backups, members and ownership handoff.",
  },
  collaborator: {
    zh: "协作设备：由主设备勾选可用的业务Tab；获准Tab内可按协作角色处理业务，但不能管理设备组。",
    en: "Collaborator: the owner selects business tabs; permitted tabs are available for collaboration, but device-group management is unavailable.",
  },
  guest: {
    zh: "访客设备：由主设备勾选可查看的业务Tab；获准Tab内只读，不能创建、修改、导入、月结或管理设备。",
    en: "Guest: the owner selects readable business tabs; permitted tabs are read-only and cannot create, edit, import, close periods or manage devices.",
  },
};

function Check({ value }: { value: boolean }) {
  const colors = useColors();
  return <Text style={{ color: value ? colors.success : colors.muted, fontSize: 16, textAlign: "center" }}>{value ? "✓" : "–"}</Text>;
}

export default function RoleGuideScreen() {
  const colors = useColors();
  const { lang } = useI18n();
  const isEn = lang === "en";
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScreenContainer>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={[styles.backText, { color: colors.primary }]}>{isEn ? "‹ Back" : "‹ 返回"}</Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{isEn ? "Device Access" : "设备访问说明"}</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={[styles.intro, { color: colors.muted }]}>
          {isEn
            ? "Business access has exactly five top-level tabs. Internal pages inherit their parent tab and are never authorized separately."
            : "业务访问只有五个顶级Tab。内部页面自动继承所属Tab，不会再按总月报、时段经营分析、库存分类或薪资等单独授权。"}
        </Text>

        {(["owner", "collaborator", "guest"] as const).map((role) => (
          <View key={role} style={[styles.roleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.roleTitle, { color: colors.foreground }]}>{isEn ? role : role === "owner" ? "主设备" : role === "collaborator" ? "协作设备" : "访客设备"}</Text>
            <Text style={[styles.roleDescription, { color: colors.muted }]}>{isEn ? ROLE_GUIDE[role].en : ROLE_GUIDE[role].zh}</Text>
          </View>
        ))}

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{isEn ? "Five Business Tabs" : "五个业务Tab"}</Text>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {BUSINESS_TABS.map((tab, index) => {
            const item = TAB_GUIDE[tab];
            return (
              <View key={tab} style={[styles.tabRow, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined]}>
                <View style={{ flex: 2, paddingRight: 12 }}>
                  <Text style={[styles.tabName, { color: colors.foreground }]}>{isEn ? item.en : item.zh}</Text>
                  <Text style={[styles.tabDescription, { color: colors.muted }]}>{isEn ? item.descriptionEn : item.descriptionZh}</Text>
                </View>
                <View style={{ flex: 0.45, alignItems: "center" }}><Check value /></View>
                <View style={{ flex: 0.45, alignItems: "center" }}><Check value /></View>
                <View style={{ flex: 0.45, alignItems: "center" }}><Check value /></View>
              </View>
            );
          })}
        </View>

        <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.noticeTitle, { color: colors.foreground }]}>{isEn ? "Important" : "重要说明"}</Text>
          <Text style={[styles.noticeText, { color: colors.muted }]}>
            {isEn
              ? "The checks above mean a tab can be granted. The owner chooses the actual tabs for each collaborator or guest in Device Management. Store includes reports, staff, petty cash, all inventory and operations; a permitted Store tab cannot show an individual internal-page access error."
              : "上表表示五个Tab可以被授予。主设备会在“设备管理”中选择每台协作/访客设备实际可用的Tab。门店包含报表、员工、备用金、全部库存和店铺；只要门店已获准，任何内部页签都不能再显示单独的无权访问。"}
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  backBtn: { width: 64, paddingVertical: 4 },
  backText: { fontSize: 17, fontWeight: "400" },
  title: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  intro: { fontSize: 13, lineHeight: 20, marginBottom: 14 },
  roleCard: { borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth },
  roleTitle: { fontSize: 15, fontWeight: "600", marginBottom: 5 },
  roleDescription: { fontSize: 13, lineHeight: 19 },
  sectionTitle: { fontSize: 15, fontWeight: "600", marginTop: 10, marginBottom: 10 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tabRow: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 12 },
  tabName: { fontSize: 14, fontWeight: "600", marginBottom: 3 },
  tabDescription: { fontSize: 12, lineHeight: 17 },
  notice: { borderRadius: 12, padding: 14, marginTop: 16, borderWidth: StyleSheet.hairlineWidth },
  noticeTitle: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  noticeText: { fontSize: 13, lineHeight: 20 },
});
