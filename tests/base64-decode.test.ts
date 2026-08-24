import { describe, expect, it } from "vitest";
import { decodeBase64ToArrayBuffer } from "@/lib/utils/base64";

function decodeText(base64: string): string {
  return new TextDecoder().decode(new Uint8Array(decodeBase64ToArrayBuffer(base64)));
}

describe("跨平台Base64解码", () => {
  it("不依赖浏览器atob即可解码标准与URL安全Base64", () => {
    expect(decodeText("SGVsbG8=")).toBe("Hello");
    expect(decodeText("5L2g5aW9")).toBe("你好");
    expect(decodeText("SGVsbG8")).toBe("Hello");
  });

  it("对格式损坏的Base64显式失败，而不是返回不完整文件内容", () => {
    expect(() => decodeBase64ToArrayBuffer("abcde")).toThrow(/长度无效/);
    expect(() => decodeBase64ToArrayBuffer("abc$def")).toThrow(/有效的Base64/);
    expect(() => decodeBase64ToArrayBuffer("ab=c")).toThrow(/填充格式无效/);
  });
});
