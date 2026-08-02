import { ScrollView, Text, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

type PermRow = {
  feature: string;
  featureEn: string;
  owner: boolean;
  collaborator: boolean;
  guest: boolean;
};

const PERM_ROWS: PermRow[] = [
  { feature: "查看配方库", featureEn: "View Recipes", owner: true, collaborator: true, guest: true },
  { feature: "新建配方", featureEn: "Add Recipe", owner: true, collaborator: true, guest: false },
  { feature: "编辑配方", featureEn: "Edit Recipe", owner: true, collaborator: true, guest: false },
  { feature: "删除配方", featureEn: "Delete Recipe", owner: true, collaborator: true, guest: false },
  { feature: "收藏 / 评分 / 做过", featureEn: "Favorite / Rating / Made", owner: true, collaborator: true, guest: true },
  { feature: "查看酒款库", featureEn: "View Bottles", owner: true, collaborator: true, guest: true },
  { feature: "新建 / 编辑酒款", featureEn: "Add / Edit Bottle", owner: true, collaborator: true, guest: false },
  { feature: "删除酒款", featureEn: "Delete Bottle", owner: true, collaborator: true, guest: false },
  { feature: "查看自制品", featureEn: "View Homemade", owner: true, collaborator: true, guest: true },
  { feature: "新建 / 编辑自制品", featureEn: "Add / Edit Homemade", owner: true, collaborator: true, guest: false },
  { feature: "研发室（查看）", featureEn: "Lab (View)", owner: true, collaborator: true, guest: true },
  { feature: "研发室（新建项目）", featureEn: "Lab (New Project)", owner: true, collaborator: true, guest: false },
  { feature: "书库（查看）", featureEn: "Books (View)", owner: true, collaborator: true, guest: true },
  { feature: "书库（导入图书）", featureEn: "Books (Import)", owner: true, collaborator: true, guest: false },
  { feature: "门店酒单", featureEn: "Menu", owner: true, collaborator: true, guest: true },
  { feature: "采购清单", featureEn: "Shopping", owner: true, collaborator: true, guest: true },
  { feature: "邀请 / 管理设备", featureEn: "Manage Devices", owner: true, collaborator: false, guest: false },
  { feature: "转移主设备权限", featureEn: "Transfer Owner", owner: true, collaborator: false, guest: false },
  { feature: "数据备份 / 恢复", featureEn: "Backup / Restore", owner: true, collaborator: false, guest: false },
  { feature: "同步设置", featureEn: "Sync Settings", owner: true, collaborator: false, guest: false },
];

const ROLE_LABELS = {
  owner: { zh: "主设备", en: "Owner" },
  collaborator: { zh: "协作者", en: "Collaborator" },
  guest: { zh: "访客", en: "Guest" },
};

const ROLE_DESC = {
  owner: {
    zh: "拥有全部权限，可邀请其他设备、管理角色、备份数据。您的多台设备（iPhone/iPad/Mac）均可设为主设备。",
    en: "Full access. Can invite devices, manage roles, and backup data. Multiple personal devices can all be set as owner.",
  },
  collaborator: {
    zh: "可查看和编辑大部分内容，但不能管理设备或备份数据。适合团队成员设备。",
    en: "Can view and edit most content, but cannot manage devices or backup. Suitable for team member devices.",
  },
  guest: {
    zh: "仅可查看内容，不可新建、编辑或删除任何数据。收藏、评分、做过标记仅在本设备保留。适合展示用设备。",
    en: "View-only access. Cannot create, edit, or delete data. Favorites, ratings, and 'made' marks are local-only. Suitable for display devices.",
  },
};

function Check({ value }: { value: boolean }) {
  const colors = useColors();
  return (
    <Text style={{ color: value ? colors.success : colors.muted, fontSize: 16, textAlign: "center" }}>
      {value ? "✓" : "–"}
    </Text>
  );
}

export default function RoleGuideScreen() {
  const colors = useColors();
  const { lang } = useI18n();
  const isEn = lang === "en";

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* 标题 */}
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
          {isEn ? "Role Permissions" : "角色权限说明"}
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 20 }}>
          {isEn
            ? "Choose the right role when inviting a new device."
            : "邀请新设备时，根据用途选择合适的角色。"}
        </Text>

        {/* 角色说明卡片 */}
        {(["owner", "collaborator", "guest"] as const).map((role) => (
          <View
            key={role}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              padding: 14,
              marginBottom: 12,
              borderWidth: 0.5,
              borderColor: colors.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
              <View
                style={{
                  backgroundColor:
                    role === "owner"
                      ? colors.primary
                      : role === "collaborator"
                        ? colors.success
                        : colors.muted,
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  marginRight: 8,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
                  {isEn ? ROLE_LABELS[role].en : ROLE_LABELS[role].zh}
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 18 }}>
              {isEn ? ROLE_DESC[role].en : ROLE_DESC[role].zh}
            </Text>
          </View>
        ))}

        {/* 权限对比表 */}
        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, marginTop: 8, marginBottom: 10 }}>
          {isEn ? "Permission Comparison" : "权限对比"}
        </Text>
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 12,
            borderWidth: 0.5,
            borderColor: colors.border,
            overflow: "hidden",
          }}
        >
          {/* 表头 */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: colors.border,
              paddingVertical: 8,
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ flex: 2, fontSize: 12, fontWeight: "600", color: colors.foreground }}>
              {isEn ? "Feature" : "功能"}
            </Text>
            {(["owner", "collaborator", "guest"] as const).map((role) => (
              <Text
                key={role}
                style={{ flex: 1, fontSize: 11, fontWeight: "600", color: colors.foreground, textAlign: "center" }}
              >
                {isEn ? ROLE_LABELS[role].en : ROLE_LABELS[role].zh}
              </Text>
            ))}
          </View>
          {/* 表格行 */}
          {PERM_ROWS.map((row, idx) => (
            <View
              key={row.feature}
              style={{
                flexDirection: "row",
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderTopWidth: idx === 0 ? 0 : 0.5,
                borderTopColor: colors.border,
                backgroundColor: idx % 2 === 0 ? "transparent" : colors.background,
              }}
            >
              <Text style={{ flex: 2, fontSize: 13, color: colors.foreground }}>
                {isEn ? row.featureEn : row.feature}
              </Text>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Check value={row.owner} />
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Check value={row.collaborator} />
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Check value={row.guest} />
              </View>
            </View>
          ))}
        </View>

        {/* 个人偏好说明 */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 12,
            padding: 14,
            marginTop: 16,
            borderWidth: 0.5,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>
            {isEn ? "Personal Preferences (Device-Isolated)" : "个人偏好（按设备隔离）"}
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 20 }}>
            {isEn
              ? "Favorites, ratings, and 'made' marks are stored separately per device role. Owner devices (your iPhone/iPad/Mac) share the same preferences. Collaborator and guest devices each maintain their own independent preferences."
              : "收藏、评分、「做过」标记按设备角色独立存储。主设备（您的 iPhone/iPad/Mac）之间共享同一份偏好数据；协作者和访客设备各自维护独立的偏好，互不干扰。"}
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
