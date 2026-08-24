import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const detail = fs.readFileSync(path.join(root, "app/bottle/[id].tsx"), "utf8");
const channels = fs.readFileSync(path.join(root, "app/bottle-channels.tsx"), "utf8");

describe("酒款中国参考价与供应渠道 UI 契约", () => {
  it("将中国参考价卡固定在基础信息与评分之间，并以采购渠道查看作为唯一入口", () => {
    const infoIndex = detail.indexOf('t("bottle.info")');
    const cardIndex = detail.indexOf('testID="bottle-china-reference-price-card"');
    const ratingIndex = detail.indexOf("{/* Rating */}");
    expect(infoIndex).toBeGreaterThan(-1);
    expect(cardIndex).toBeGreaterThan(infoIndex);
    expect(ratingIndex).toBeGreaterThan(cardIndex);
    expect(detail).toContain('testID="bottle-manage-supplier-channels"');
    expect(detail).toContain('flexShrink: 1');
    expect(detail).toContain('alignSelf: "flex-start"');
    expect(detail).toContain('supplierChannels.length === 0');
    expect(detail).not.toContain("{/* 供货渠道展示 */}");
  });

  it("价格待确认提供人工确认或返回真实采购渠道修正的入口", () => {
    expect(detail).toContain('testID="bottle-price-alert-summary"');
    expect(detail).toContain("确认价格变动");
    expect(detail).toContain("前往采购渠道修正");
    expect(detail).toContain('resolvePriceAlert(alert.id, "confirmed_change")');
  });

  it("渠道、采购名称与价格变化仅由已链接采购投影，不再提供独立新增或手填价格表单", () => {
    expect(channels).toContain("由 {projectedPurchaseCount} 笔已链接进货自动汇总");
    expect(channels).toContain("在烈酒当月进货中完成酒库链接后，供应商、自采渠道、采购名称与价格历史会自动生成在这里。");
    expect(channels).toContain("更正名称、价格或日期请返回对应采购记录操作。");
    expect(channels).not.toContain("ChannelFormModal");
    expect(channels).not.toContain("添加第一个渠道");
    expect(channels).toContain("补充采购链接");
    expect(channels).toContain("供应商、采购名称、价格和价格历史仍只能由采购记录同步。");
  });

  it("渠道价格可查看完整变化，且只允许在真实采购渠道间切换成本基准", () => {
    expect(channels).toContain("查看价格变化 · {(channel.priceHistory ?? []).length} 笔");
    expect(channels).toContain('>价格变化</Text>');
    expect(channels).toContain("handleSetCostBasis(channel.id)");
    expect(channels).toContain("不在此页手动改价");
  });
});
