import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File as FSFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

// ── Key groups ──────────────────────────────────────────────────────────────
const RECIPE_KEYS = [
  "cocktail.recipes", "cocktail.categories", "cocktail.seeded",
  "cocktail.tags", "cocktail.tagGroups", "cocktail_waldorf_imported_v1",
];
const BOTTLE_KEYS = [
  "cocktail.bottles", "cocktail.bottles.seeded", "cocktail.bottles.waldorf.v1",
  "bottles.material.migrated.v8", "bottles.material.migrated.v9",
  "bottles.taxonomy.categories.v1", "bottles.taxonomy.styles.v1",
];
const PREP_KEYS = [
  "homemade.preps.v1", "homemade.seeded.v1", "homemade.sections.v1",
  "homemade.types.v1", "homemade.taxonomy.v2",
  "homemade.waldorf.v1", "homemade.waldorf.v2", "homemade.source.v3",
];
const LAB_KEYS = ["cocktail.lab.projects", "cocktail.lab.batches"];
const BOOK_KEYS = ["cocktail.books.v1"];
const MISC_KEYS = ["menu_store_v1", "shopping_store_v1", "cocktail.iceSettings.v2", "card.tag.settings.v2"];
const SYNC_BASE_KEYS = [
  "cocktail.recipes","cocktail.categories","cocktail.tags","cocktail.tagGroups",
  "cocktail.seeded","cocktail_waldorf_imported_v1","cocktail.bottles",
  "cocktail.bottles.seeded","cocktail.bottles.waldorf.v1","homemade.preps.v1",
  "homemade.seeded.v1","homemade.sections.v1","homemade.types.v1",
  "homemade.taxonomy.v2","homemade.waldorf.v1","bottles.taxonomy.categories.v1",
  "bottles.taxonomy.styles.v1","cocktail.lab.projects","cocktail.lab.batches",
  "app.lang.v1","cocktail.books.v1","menu_store_v1","shopping_store_v1",
  "cocktail.iceSettings.v2",
];
const ALL_KEYS = [
  ...RECIPE_KEYS, ...BOTTLE_KEYS, ...PREP_KEYS, ...LAB_KEYS, ...BOOK_KEYS, ...MISC_KEYS,
  ...SYNC_BASE_KEYS.map((k) => `sync.ts.${k}`),
  "sync.lastPulledAt",
];

// ── Helpers ──────────────────────────────────────────────────────────────────
async function readKeys(keys: string[]): Promise<Record<string, unknown>> {
  const pairs = await AsyncStorage.multiGet(keys);
  const result: Record<string, unknown> = {};
  for (const [k, v] of pairs) {
    if (v !== null) {
      try { result[k] = JSON.parse(v); } catch { result[k] = v; }
    }
  }
  return result;
}

async function exportBackup(): Promise<void> {
  const data = await readKeys(ALL_KEYS);
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2);
  const filename = `cocktail-r-backup-${new Date().toISOString().slice(0, 10)}.json`;

  if (Platform.OS === "web") {
    // Web: trigger download via anchor
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const cacheFile = new FSFile(Paths.cache, filename);
  await cacheFile.write(json);
  const path = cacheFile.uri;
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: filename });
  }
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DataManagerScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useI18n();
  const [exporting, setExporting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleExport = async () => {
    tap();
    setExporting(true);
    try {
      await exportBackup();
    } catch {
      Alert.alert(t("dataManager.export.error"));
    } finally {
      setExporting(false);
    }
  };

  const confirmClear = (keys: string[], messageKey: string) => {
    tap();
    const doDelete = async () => {
      await AsyncStorage.multiRemove(keys);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t("dataManager.cleared"));
    };
    if (Platform.OS === "web") {
      if (window.confirm(t(messageKey as any))) void doDelete();
    } else {
      Alert.alert(
        t("common.delete"),
        t(messageKey as any),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("common.delete"), style: "destructive", onPress: () => void doDelete() },
        ],
      );
    }
  };

  const sections: {
    titleKey: string;
    descKey: string;
    icon: string;
    iconBg: string;
    keys: string[];
    confirmKey: string;
  }[] = [
    { titleKey: "dataManager.clearRecipes", descKey: "dataManager.clearRecipes.desc", icon: "list.bullet", iconBg: colors.primary, keys: RECIPE_KEYS, confirmKey: "dataManager.confirm.recipes" },
    { titleKey: "dataManager.clearBottles", descKey: "dataManager.clearBottles.desc", icon: "wineglass.fill", iconBg: "#8B5CF6", keys: BOTTLE_KEYS, confirmKey: "dataManager.confirm.bottles" },
    { titleKey: "dataManager.clearPreps", descKey: "dataManager.clearPreps.desc", icon: "flask.fill", iconBg: "#F59E0B", keys: PREP_KEYS, confirmKey: "dataManager.confirm.preps" },
    { titleKey: "dataManager.clearLab", descKey: "dataManager.clearLab.desc", icon: "cross.vial", iconBg: "#10B981", keys: LAB_KEYS, confirmKey: "dataManager.confirm.lab" },
    { titleKey: "dataManager.clearBooks", descKey: "dataManager.clearBooks.desc", icon: "book.fill", iconBg: "#EC4899", keys: BOOK_KEYS, confirmKey: "dataManager.confirm.books" },
  ];

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>{t("common.back")}</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>{t("dataManager.title")}</Text>
        </View>

        {/* Export Section */}
        <View style={styles.sectionLabel}>
          <Text style={[styles.sectionLabelText, { color: colors.muted }]}>{t("dataManager.export")}</Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            onPress={handleExport}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            disabled={exporting}
          >
            <View style={[styles.iconWrap, { backgroundColor: "#0EA5E9" }]}>
              {exporting
                ? <ActivityIndicator size="small" color="#fff" />
                : <IconSymbol name="square.and.arrow.up" size={18} color="#FFFFFF" />
              }
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.foreground }]}>{t("dataManager.export")}</Text>
              <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>
                {t("dataManager.export.desc")}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Selective Clear Section */}
        <View style={styles.sectionLabel}>
          <Text style={[styles.sectionLabelText, { color: colors.muted }]}>{t("dataManager.clearSection")}</Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {sections.map((s, i) => (
            <View key={s.titleKey}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
              <Pressable
                onPress={() => confirmClear(s.keys, s.confirmKey)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: s.iconBg }]}>
                  <IconSymbol name={s.icon as any} size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>{t(s.titleKey as any)}</Text>
                  <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>
                    {t(s.descKey as any)}
                  </Text>
                </View>
              </Pressable>
            </View>
          ))}
        </View>

        {/* Clear All Section */}
        <View style={styles.sectionLabel}>
          <Text style={[styles.sectionLabelText, { color: colors.muted }]}>{t("me.clearData")}</Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            onPress={() => confirmClear(ALL_KEYS, "dataManager.confirm.all")}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.error }]}>
              <IconSymbol name="trash.fill" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.error }]}>{t("dataManager.clearAll")}</Text>
              <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>
                {t("dataManager.clearAll.desc")}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Factory Reset Section */}
        <View style={styles.sectionLabel}>
          <Text style={[styles.sectionLabelText, { color: colors.muted }]}>{t("dataManager.dangerZone")}</Text>
        </View>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            onPress={() => {
              tap();
              if (Platform.OS === "web") {
                if (window.confirm(t("dataManager.confirm.reset"))) {
                  setResetting(true);
                  AsyncStorage.clear()
                    .then(() => {
                      Alert.alert(t("dataManager.reset.done"));
                    })
                    .catch(() => Alert.alert(t("dataManager.export.error")))
                    .finally(() => setResetting(false));
                }
              } else {
                Alert.alert(
                  t("dataManager.reset.title"),
                  t("dataManager.confirm.reset"),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    {
                      text: t("dataManager.reset.confirm"),
                      style: "destructive",
                      onPress: () => {
                        setResetting(true);
                        AsyncStorage.clear()
                          .then(() => {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            Alert.alert(t("dataManager.reset.done"));
                          })
                          .catch(() => Alert.alert(t("dataManager.export.error")))
                          .finally(() => setResetting(false));
                      },
                    },
                  ],
                );
              }
            }}
            disabled={resetting}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: "#FF3B30" }]}>
              {resetting
                ? <ActivityIndicator size="small" color="#fff" />
                : <IconSymbol name="arrow.counterclockwise" size={18} color="#FFFFFF" />
              }
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: "#FF3B30" }]}>{t("dataManager.reset.title")}</Text>
              <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>
                {t("dataManager.reset.desc")}
              </Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  backBtn: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backText: { fontSize: 16, marginLeft: 2 },
  title: { fontSize: 28, fontWeight: "700" },
  sectionLabel: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  sectionLabelText: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  card: { marginHorizontal: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 16, fontWeight: "600", marginBottom: 2 },
  rowDesc: { fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 64 },
});
