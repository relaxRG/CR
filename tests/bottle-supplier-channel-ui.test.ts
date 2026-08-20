import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const detail = fs.readFileSync(path.join(root, "app/bottle/[id].tsx"), "utf8");
const channels = fs.readFileSync(path.join(root, "app/bottle-channels.tsx"), "utf8");

describe("酒款中国参考价与供应渠道 UI 契约", () => {
  it("将中国参考价卡固定在基础信息与评分之间，并以渠道管理作为唯一编辑入口", () => {
    const infoIndex = detail.indexOf('t("bottle.info")');
    const cardIndex = detail.indexOf('testID="bottle-china-reference-price-card"');
    const ratingIndex = detail.indexOf("{/* Rating */}");
    expect(infoIndex).toBeGreaterThan(-1);
    expect(cardIndex).toBeGreaterThan(infoIndex);
    expect(ratingIndex).toBeGreaterThan(cardIndex);
    expect(detail).toContain('testID="bottle-manage-supplier-channels"');
    expect(detail).toContain('supplierChannels.length === 0');
    expect(detail).not.toContain("{/* 供货渠道展示 */}");
  });

  it("渠道编辑支持多个采购名称，供应商和自采电商仍在同一表单中管理", () => {
    expect(channels).toContain("采购名称：");
    expect(channels).toContain("一行一个名称；可同时记录现名、旧名和简称");
    expect(channels).toContain('type === "supplier" ? "供应商采购名称（可选）"');
    expect(channels).toContain('type === "self" && (');
    expect(channels).toContain("购买链接（粘贴后一键跳转）");
  });

  it("渠道价格可查看完整变化，并禁止直接删除仍被使用的成本基准", () => {
    expect(channels).toContain("查看 {(ch.priceHistory ?? []).length} 条记录");
    expect(channels).toContain('>价格变化</Text>');
    expect(channels).toContain("请先切换成本基准");
    expect(channels).toContain("current渠道正在用于成本计算".replace("current", ""));
    expect(channels).toContain('resolveCostChannelId');
  });
});
