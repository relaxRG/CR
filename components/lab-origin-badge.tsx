import { router } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useLabStore } from "@/lib/lab/store";

/**
 * 「源自研发项目」回链标注:
 * 正式配方(由研发定稿转正生成)的详情页展示来源项目与迭代轮数,点按跳回项目时间线。
 */
export function LabOriginBadge({ recipeId }: { recipeId: string }) {
  const colors = useColors();
  const { t } = useI18n();
  const { projects, batchesOf } = useLabStore();

  const origin = useMemo(() => {
    const project = projects.find((p) => p.finalizedRecipeId === recipeId);
    if (!project) return null;
    return { project, batchCount: batchesOf(project.id).length };
  }, [projects, batchesOf, recipeId]);

  if (!origin) return null;

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: "/lab/[id]", params: { id: origin.project.id } })
      }
      style={({ pressed }) => [
        styles.badge,
        { backgroundColor: "#8B5CF614", borderColor: "#8B5CF655" },
        pressed && { opacity: 0.7 },
      ]}
    >
      <IconSymbol name="flask.fill" size={13} color="#8B5CF6" />
      <Text className="text-xs font-medium" style={{ color: "#8B5CF6", lineHeight: 16, flexShrink: 1 }} numberOfLines={1}>
        {t("lab.origin.badge")} · {t("lab.origin.detail", { name: origin.project.name, n: origin.batchCount })}
      </Text>
      <IconSymbol name="chevron.right" size={10} color="#8B5CF6" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 10,
  },
});
