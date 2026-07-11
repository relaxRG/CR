import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { codexFamilyLabel } from "@/lib/recipes/types";

/**
 * 六大母配方(Cocktail Codex)结构说明内容库(双语)。
 * 依据:Death & Co《Cocktail Codex》(2018) 官方六族定义;
 * 交叉佐证:Gary Regan《The Joy of Mixology》家族分类法、David Wondrich《Imbibe!》历史谱系。
 */
interface FamilyDoc {
  formulaZh: string;
  formulaEn: string;
  bodyZh: string;
  bodyEn: string;
}

const FAMILY_DOCS: Record<string, FamilyDoc> = {
  "古典 Old-Fashioned": {
    formulaZh: "结构公式:烈酒 + 糖 + 苦精(+ 水/冰稀释)",
    formulaEn: "Formula: Spirit + Sugar + Bitters (+ dilution)",
    bodyZh:
      "古典族是「鸡尾酒」一词最初的定义(1806 年《The Balance and Columbian Repository》:烈酒、糖、水、苦精)。核心逻辑是以极少的糖与苦精调味,烘托而非掩盖基酒本味,是六族中最直接呈现烈酒个性的骨架。\n\n判定要点:无柑橘酸;甜源为糖/糖浆(Duo/Trio 类以利口酒作甜源亦归此族);苦精作结构性调味。\n\n代表成员:Old Fashioned、Sazerac、Champagne Cocktail、Mint Julep、Toddy、Godfather、Rusty Nail(后两者为利口酒甜源的 Duo 变体)。\n\n文献依据:《Cocktail Codex》Ch.1;David Wondrich《Imbibe!》考证其为一切美式鸡尾酒的源头形态。",
    bodyEn:
      "The Old-Fashioned is the original definition of the word \"cocktail\" (The Balance and Columbian Repository, 1806: spirit, sugar, water, bitters). Its core logic: season the spirit with minimal sugar and bitters to showcase — not mask — the base. It is the most spirit-forward of the six templates.\n\nMarkers: no citrus acid; sweetness from sugar/syrup (Duos/Trios sweetened by liqueur also belong here); bitters as structural seasoning.\n\nMembers: Old Fashioned, Sazerac, Champagne Cocktail, Mint Julep, Toddy, Godfather, Rusty Nail.\n\nSources: Cocktail Codex Ch.1; David Wondrich, Imbibe! — the root form of all American cocktails.",
  },
  "马天尼 Martini": {
    formulaZh: "结构公式:烈酒 + 加强型葡萄酒/苦味修饰(搅拌,无柑橘)",
    formulaEn: "Formula: Spirit + Fortified wine / bitter modifier (stirred, no citrus)",
    bodyZh:
      "马天尼族的本质是「烈酒与开胃酒的对话」:以味美思、雪莉等加强型葡萄酒(或金巴利类苦味修饰)平衡基酒,而非用糖或酸。源自 1870-80 年代的 Manhattan 与 Martinez,是搅拌短饮的正统骨架。\n\n判定要点:含 fortified(味美思/雪莉/基纳酒)或苦味修饰酒;无柑橘;通常搅拌。\n\n代表成员:Martini、Manhattan、Negroni、Boulevardier、Rob Roy、Adonis、Bamboo、Martinez。\n\n文献依据:《Cocktail Codex》Ch.2;Wondrich 考证 Martini 系 Manhattan 换基酒的直系后裔;Negroni 由 Milano-Torino/Americano 加金酒演化(1919,佛罗伦萨)。",
    bodyEn:
      "The Martini template is a dialogue between spirit and aromatized wine: vermouth, sherry or a bitter aperitif balances the base instead of sugar or acid. Born of the 1870s-80s Manhattan and Martinez, it is the canonical stirred, boozy frame.\n\nMarkers: fortified wine (vermouth/sherry/quinquina) or bitter modifier; no citrus; usually stirred.\n\nMembers: Martini, Manhattan, Negroni, Boulevardier, Rob Roy, Adonis, Bamboo, Martinez.\n\nSources: Cocktail Codex Ch.2; Wondrich traces the Martini as the Manhattan's gin-based descendant; the Negroni evolved from the Milano-Torino/Americano (Florence, 1919).",
  },
  "大吉利 Daiquiri": {
    formulaZh: "结构公式:烈酒 + 柑橘酸 + 糖(经典 Sour 比例 2 : ¾ : ¾)",
    formulaEn: "Formula: Spirit + Citrus + Sugar (classic sour ratio 2 : ¾ : ¾)",
    bodyZh:
      "大吉利族即 Sour(酸酒)家族:烈酒、柑橘、糖三角平衡,是全部酸甜短饮的母体。Gary Regan 称之为 New Orleans Sour 谱系的核心。摇和出杯,酸与甜互为镜像。\n\n判定要点:含柠檬/青柠等柑橘酸;甜源为糖/糖浆;摇和。\n\n代表成员:Daiquiri、Whiskey Sour、Gimlet、Southside、Caipirinha、Bee's Knees(蜂蜜作糖)、Tiki 系(菠萝/椰子/法勒纳姆延伸)。\n\n文献依据:《Cocktail Codex》Ch.3;《The Joy of Mixology》Sours 家族;Difford's Guide 将 Margarita 类利口酒甜源者另归 Sidecar 支。",
    bodyEn:
      "The Daiquiri template is the sour family: a triangle of spirit, citrus and sugar — the mother of all shaken sweet-and-sour drinks. Gary Regan places it at the heart of the New Orleans Sour lineage.\n\nMarkers: citrus acid (lemon/lime); sweetness from sugar/syrup; shaken.\n\nMembers: Daiquiri, Whiskey Sour, Gimlet, Southside, Caipirinha, Bee's Knees, and the Tiki branch (pineapple/coconut/falernum extensions).\n\nSources: Cocktail Codex Ch.3; The Joy of Mixology (Sours); Difford's Guide assigns liqueur-sweetened sours (e.g. Margarita) to the Sidecar branch.",
  },
  "边车 Sidecar": {
    formulaZh: "结构公式:烈酒 + 柑橘酸 + 利口酒作甜源",
    formulaEn: "Formula: Spirit + Citrus + Liqueur as sweetener",
    bodyZh:
      "边车族与大吉利同为酸酒骨架,分野在甜源:以橙皮利口酒等风味利口酒替代糖,甜的同时叠加第二重风味。源头可追溯至 19 世纪 Brandy Crusta(Wondrich 考证),1920 年代定型为 Sidecar。\n\n判定要点:含柑橘酸;甜源为利口酒(无糖浆);摇和。\n\n代表成员:Sidecar、Margarita、White Lady、Cosmopolitan、Kamikaze、Corpse Reviver No.2、Aviation。\n\n文献依据:《Cocktail Codex》Ch.4;《Imbibe!》Crusta→Sidecar 演化链;Margarita 即换特其拉+青柠的 Sidecar(Codex 官方例证)。",
    bodyEn:
      "The Sidecar shares the sour skeleton with the Daiquiri; the split is the sweetener: an orange (or other flavored) liqueur replaces sugar, adding a second layer of flavor. Wondrich traces the root to the 19th-century Brandy Crusta, codified as the Sidecar in the 1920s.\n\nMarkers: citrus acid; liqueur as the sweet source (no syrup); shaken.\n\nMembers: Sidecar, Margarita, White Lady, Cosmopolitan, Kamikaze, Corpse Reviver No.2, Aviation.\n\nSources: Cocktail Codex Ch.4; Imbibe! (Crusta→Sidecar chain); the Margarita is the Codex's own example of a tequila-lime Sidecar.",
  },
  "高球 Highball": {
    formulaZh: "结构公式:烈酒 + 气泡/延长剂(长饮,直调)",
    formulaEn: "Formula: Spirit + Carbonated lengthener (long, built)",
    bodyZh:
      "高球族是「烈酒 + 大量非酒精延长剂」的长饮骨架,以气泡稀释与清爽为目的。Codex 将 Collins、Fizz、Buck/Mule、Spritz 乃至咖啡/茶延长的长饮统归此族。\n\n判定要点:含苏打水/汤力/姜汁啤酒/香槟等碳酸延长剂(或大量果汁延长);长饮杯型;多为直调。\n\n代表成员:Whisky Highball、Gin & Tonic、Tom Collins、Ramos Gin Fizz、Moscow Mule、Dark 'n' Stormy、Mojito、Americano、Paloma。\n\n文献依据:《Cocktail Codex》Ch.5;Regan 分类中的 Collinses/Fizzes/Bucks 支系与其对应。",
    bodyEn:
      "The Highball template is the long-drink frame of spirit plus a large non-alcoholic lengthener, built for dilution and refreshment. The Codex folds Collinses, Fizzes, Bucks/Mules and Spritzes into this family.\n\nMarkers: carbonated lengthener (soda/tonic/ginger beer/champagne) or generous juice; long glass; usually built.\n\nMembers: Whisky Highball, Gin & Tonic, Tom Collins, Ramos Gin Fizz, Moscow Mule, Dark 'n' Stormy, Mojito, Americano, Paloma.\n\nSources: Cocktail Codex Ch.5; corresponds to Regan's Collinses/Fizzes/Bucks branches.",
  },
  "菲兹 Flip": {
    formulaZh: "结构公式:烈酒/加强酒 + 全蛋或乳脂 + 糖(浓郁质地)",
    formulaEn: "Formula: Spirit/fortified + Whole egg or dairy + Sugar (rich texture)",
    bodyZh:
      "Flip 族以「质地」为核心:全蛋或奶油赋予酒体丝绒般的厚度,糖与香料收尾,是六族中唯一以口感构造为定义的家族。源自殖民地时期的热蛋酒,19 世纪定型为摇和冷饮。\n\n判定要点:含全蛋/蛋黄或奶油乳脂(蛋清单独打泡的 Fizz 不算);常撒肉豆蔻等香料。\n\n代表成员:Brandy Flip、Eggnog、Alexander、Grasshopper、White Russian、Piña Colada、Irish Coffee、Espresso Martini(Codex 官方归族)。\n\n文献依据:《Cocktail Codex》Ch.6;Rusty Barrel 六族专题对 White Russian/Espresso Martini 归 Flip 的论证。",
    bodyEn:
      "The Flip template is defined by texture: whole egg or cream gives a velvet body, finished with sugar and spice — the only family defined by mouthfeel. Rooted in colonial hot flips, codified as a shaken cold drink in the 19th century.\n\nMarkers: whole egg/yolk or dairy cream (egg-white-only Fizzes excluded); often dusted with nutmeg.\n\nMembers: Brandy Flip, Eggnog, Alexander, Grasshopper, White Russian, Piña Colada, Irish Coffee, Espresso Martini (per the Codex).\n\nSources: Cocktail Codex Ch.6; Rusty Barrel's six-family series on White Russian/Espresso Martini as Flips.",
  },
};

/** 详情页 Codex 家族徽章:点按弹出母配方结构说明浮层(与 VariantBadge 浮层同视觉风格) */
export function CodexFamilyBadge({ family }: { family: string }) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = React.useState(false);

  const raw = (family ?? "").trim();
  const doc = FAMILY_DOCS[raw];
  const label = codexFamilyLabel(raw, lang);
  if (!label) return null;

  const openSheet = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(true);
  };

  return (
    <>
      <Pressable
        onPress={doc ? openSheet : undefined}
        hitSlop={6}
        style={({ pressed }) => [pressed && doc ? { opacity: 0.6 } : null]}
      >
        <View
          className="px-2.5 py-1 rounded-full border flex-row items-center"
          style={{ borderColor: colors.primary, backgroundColor: colors.primary + "15", gap: 3 }}
        >
          <Text className="text-xs font-medium" style={{ color: colors.primary }}>
            {label}
          </Text>
          {doc ? <IconSymbol name="info.circle.fill" size={11} color={colors.primary} /> : null}
        </View>
      </Pressable>

      {doc ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
          <View
            className="bg-background rounded-t-3xl"
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <View className="flex-row items-center justify-between px-5 pt-1 pb-3">
              <Text
                className="text-lg font-bold text-foreground"
                numberOfLines={1}
                style={{ flex: 1, lineHeight: 26 }}
              >
                {t("codex.sheet.title", { name: label })}
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={10}
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <IconSymbol name="xmark.circle.fill" size={26} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView
              style={{ maxHeight: 480 }}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              <Text className="text-[15px] font-semibold" style={{ color: colors.primary, lineHeight: 22 }}>
                {lang === "en" ? doc.formulaEn : doc.formulaZh}
              </Text>
              <Text className="text-[15px] text-foreground mt-3" style={{ lineHeight: 24 }}>
                {lang === "en" ? doc.bodyEn : doc.bodyZh}
              </Text>
              <Text className="text-xs text-muted mt-3" style={{ lineHeight: 18 }}>
                {t("codex.sheet.hint")}
              </Text>
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    marginBottom: 6,
  },
});
