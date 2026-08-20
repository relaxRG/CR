import { Redirect } from "expo-router";

/** 旧资料库深链兼容：唯一目标为当前鸡尾酒聚合工作台。 */
export default function LegacyLibraryRedirect() {
  return <Redirect href="/cocktail" />;
}
