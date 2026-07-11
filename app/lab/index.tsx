import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LabChangeChips } from "@/components/lab-change-chips";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useLabStore } from "@/lib/lab/store";
import { getLabTemplate } from "@/lib/lab/templates";
import { LAB_STATUS_ORDER, LabProject, LabProjectStatus } from "@/lib/lab/types";

const STATUS_COLORS: Record<LabProjectStatus, string> = {
  ideation: "#8B5CF6",
  testing: "#3B82F6",
  finalized: "#22C55E",
  archived: "#9CA3AF",
};

type Row =
  | { kind: "header"; status: LabProjectStatus; count: number }
  | { kind: "project"; project: LabProject };

export function LabIndexScreen({ embedded = false }: { embedded?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { projects, batchesOf } = useLabStore();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LabProjectStatus | null>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) || p.goal.toLowerCase().includes(q)
      );
    });
    const out: Row[] = [];
    for (const status of LAB_STATUS_ORDER) {
      const group = filtered
        .filter((p) => p.status === status)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (group.length === 0) continue;
      out.push({ kind: "header", status, count: group.length });
      for (const p of group) out.push({ kind: "project", project: p });
    }
    return out;
  }, [projects, query, statusFilter]);

  /** 各状态项目数(用于筛选 chip 显示计数) */
  const statusCounts = useMemo(() => {
    const m = new Map<LabProjectStatus, number>();
    for (const p of projects) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return m;
  }, [projects]);

  return (
    <ScreenContainer edges={embedded ? [] : ["top", "left", "right", "bottom"]}>
      {/* Header */}
      {!embedded && (
      <View className="px-5 pt-2 pb-3 flex-row items-end justify-between">
        <View className="flex-1">
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <IconSymbol name="chevron.left" size={26} color={colors.foreground} />
            </Pressable>
            <Text className="text-3xl font-bold text-foreground">{t("lab.title")}</Text>
          </View>
          <Text className="text-sm text-muted mt-1" style={{ marginLeft: 34 }}>
            {projects.length > 0
              ? t("lab.subtitle.count", { n: projects.length })
              : t("lab.subtitle.empty")}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/lab/new");
          }}
          style={({ pressed }) => [
            styles.newBtn,
            { backgroundColor: colors.primary },
            pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
          ]}
        >
          <IconSymbol name="plus" size={16} color="#FFFFFF" />
          <Text className="text-sm font-semibold" style={{ color: "#FFFFFF", lineHeight: 18 }}>
            {t("lab.new")}
          </Text>
        </Pressable>
      </View>
      )}

      {projects.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10" style={{ gap: 10 }}>
          <IconSymbol name="flask.fill" size={44} color={colors.muted} />
          <Text className="text-lg font-semibold text-foreground">{t("lab.empty.title")}</Text>
          <Text className="text-sm text-muted text-center" style={{ lineHeight: 20 }}>
            {t("lab.empty.desc")}
          </Text>
          <Pressable
            onPress={() => router.push("/lab/new")}
            style={({ pressed }) => [
              styles.emptyBtn,
              { backgroundColor: colors.primary },
              pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
            ]}
          >
            <Text className="text-base font-semibold" style={{ color: "#FFFFFF", lineHeight: 20 }}>
              {t("lab.new")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
        {/* 搜索框 */}
        <View
          className="mx-5 mb-2 flex-row items-center rounded-xl px-3"
          style={{ backgroundColor: colors.surface, height: 38, gap: 6 }}
        >
          <IconSymbol name="magnifyingglass" size={15} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("lab.search.ph")}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            className="flex-1 text-sm text-foreground"
            style={{ paddingVertical: 0, lineHeight: 18 }}
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <IconSymbol name="xmark.circle.fill" size={15} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        {/* 状态筛选 chip */}
        <View style={{ marginBottom: 4 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}
          >
            <Pressable
              onPress={() => setStatusFilter(null)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: statusFilter === null ? colors.primary : colors.surface,
                  borderColor: statusFilter === null ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                className="text-xs font-medium"
                style={{ color: statusFilter === null ? "#FFFFFF" : colors.muted, lineHeight: 16 }}
              >
                {t("lab.filter.all")} · {projects.length}
              </Text>
            </Pressable>
            {LAB_STATUS_ORDER.map((status) => {
              const count = statusCounts.get(status) ?? 0;
              if (count === 0) return null;
              const active = statusFilter === status;
              return (
                <Pressable
                  key={status}
                  onPress={() => setStatusFilter(active ? null : status)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? STATUS_COLORS[status] : colors.surface,
                      borderColor: active ? STATUS_COLORS[status] : colors.border,
                    },
                  ]}
                >
                  <Text
                    className="text-xs font-medium"
                    style={{ color: active ? "#FFFFFF" : colors.muted, lineHeight: 16 }}
                  >
                    {t(`lab.status.${status}` as "lab.status.testing")} · {count}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        {rows.length === 0 ? (
          <View className="flex-1 items-center justify-center px-10" style={{ gap: 8 }}>
            <IconSymbol name="magnifyingglass" size={30} color={colors.muted} />
            <Text className="text-sm text-muted text-center" style={{ lineHeight: 20 }}>
              {t("lab.search.noResult")}
            </Text>
          </View>
        ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) =>
            item.kind === "header" ? `h-${item.status}` : item.project.id
          }
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <View className="flex-row items-center mt-4 mb-2" style={{ gap: 6 }}>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: STATUS_COLORS[item.status],
                    }}
                  />
                  <Text className="text-sm font-semibold text-muted">
                    {t(`lab.status.${item.status}` as "lab.status.testing")} · {item.count}
                  </Text>
                </View>
              );
            }
            const p = item.project;
            const batches = batchesOf(p.id);
            const latest = batches[batches.length - 1];
            const tpl = p.templateId ? getLabTemplate(p.templateId) : undefined;
            return (
              <Pressable
                onPress={() => router.push({ pathname: "/lab/[id]", params: { id: p.id } })}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Text
                    className="text-base font-semibold text-foreground"
                    style={{ lineHeight: 22, flexShrink: 1 }}
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                  {tpl ? (
                    <Text className="text-xs text-muted" style={{ lineHeight: 16 }} numberOfLines={1}>
                      {lang === "en" ? tpl.name.en : tpl.name.zh}
                    </Text>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                    {batches.length > 0
                      ? t("lab.batchCount", { n: batches.length })
                      : t("lab.noBatch")}
                  </Text>
                  <IconSymbol name="chevron.right" size={13} color={colors.muted} />
                </View>
                {p.goal ? (
                  <Text
                    className="text-sm text-muted mt-1"
                    style={{ lineHeight: 19 }}
                    numberOfLines={2}
                  >
                    {p.goal}
                  </Text>
                ) : null}
                {latest ? (
                  <View className="mt-2 flex-row items-center" style={{ gap: 8 }}>
                    <Text className="text-xs font-semibold" style={{ color: colors.primary, lineHeight: 16 }}>
                      v{latest.seq}
                    </Text>
                    {latest.score !== null ? (
                      <View className="flex-row items-center" style={{ gap: 2 }}>
                        <IconSymbol name="star.fill" size={11} color="#F59E0B" />
                        <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                          {latest.score}
                        </Text>
                      </View>
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <LabChangeChips
                        changes={latest.changes}
                        isBaseline={latest.seq === 1}
                        max={2}
                      />
                    </View>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
        )}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  filterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  emptyBtn: {
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginTop: 6,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
});

export default LabIndexScreen;
