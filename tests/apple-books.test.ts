import { describe, expect, it } from "vitest";
import { parseAppleBooksExcerpt } from "@/lib/import/apple-books";

describe("parseAppleBooksExcerpt (Bug 9)", () => {
  it("解析中文摘录尾注（书名+作者+版权句）", () => {
    const text = `金色幻想
45ml 金酒
15ml 柠檬汁

"摘录来自
The Japanese Art of the Cocktail
Masahiro Urushido
此内容可能受版权保护。`;
    const r = parseAppleBooksExcerpt(text);
    expect(r).not.toBeNull();
    expect(r!.bookTitle).toBe("The Japanese Art of the Cocktail");
    expect(r!.bookAuthor).toBe("Masahiro Urushido");
    expect(r!.cleanText).toContain("45ml 金酒");
    expect(r!.cleanText).not.toContain("摘录来自");
    expect(r!.cleanText).not.toContain("版权保护");
    expect(r!.rawText).toContain("摘录来自");
  });

  it("解析英文摘录尾注（Excerpt From）", () => {
    const text = `Penicillin
60ml blended scotch

Excerpt From
Death & Co
David Kaplan
This material may be protected by copyright.`;
    const r = parseAppleBooksExcerpt(text);
    expect(r).not.toBeNull();
    expect(r!.bookTitle).toBe("Death & Co");
    expect(r!.bookAuthor).toBe("David Kaplan");
    expect(r!.cleanText).toContain("blended scotch");
    expect(r!.cleanText).not.toContain("Excerpt From");
  });

  it("无作者行（书名后直接版权句）", () => {
    const text = `内格罗尼配方正文

摘录来自
鸡尾酒法典
此内容可能受版权保护。`;
    const r = parseAppleBooksExcerpt(text);
    expect(r).not.toBeNull();
    expect(r!.bookTitle).toBe("鸡尾酒法典");
    expect(r!.bookAuthor).toBe("");
  });

  it("疑似正文的作者行（含句号长句）不当作者", () => {
    const text = `正文

摘录来自
某本书
这是一段很长的、明显不是作者名的句子。它包含标点。
此内容可能受版权保护。`;
    const r = parseAppleBooksExcerpt(text);
    expect(r).not.toBeNull();
    expect(r!.bookTitle).toBe("某本书");
    expect(r!.bookAuthor).toBe("");
  });

  it("普通文本（无尾注标记）返回 null", () => {
    expect(parseAppleBooksExcerpt("60ml 金酒\n30ml 柠檬汁\n摇和法")).toBeNull();
    expect(parseAppleBooksExcerpt("")).toBeNull();
  });
});
