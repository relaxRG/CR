const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * 将标准或URL安全Base64解码为ArrayBuffer，不依赖浏览器全局atob。
 * 供Expo原生、Web与Node测试环境共用；格式错误会显式抛错给调用方处理。
 */
export function decodeBase64ToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || /[^A-Za-z0-9+/=]/.test(normalized)) {
    throw new Error("文件内容不是有效的Base64数据");
  }
  const firstPadding = normalized.indexOf("=");
  if (firstPadding >= 0 && /[^=]/.test(normalized.slice(firstPadding))) {
    throw new Error("文件Base64填充格式无效");
  }

  const withoutPadding = normalized.replace(/=/g, "");
  if (withoutPadding.length % 4 === 1) {
    throw new Error("文件Base64长度无效");
  }
  const padded = withoutPadding.padEnd(Math.ceil(withoutPadding.length / 4) * 4, "=");
  const paddingBytes = padded.endsWith("==") ? 2 : padded.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((padded.length / 4) * 3 - paddingBytes);

  let outputIndex = 0;
  for (let index = 0; index < padded.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(padded[index]);
    const b = BASE64_ALPHABET.indexOf(padded[index + 1]);
    const c = padded[index + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(padded[index + 2]);
    const d = padded[index + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(padded[index + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new Error("文件Base64包含无法解码的字符");
    }
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (chunk >> 16) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (chunk >> 8) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = chunk & 0xff;
  }
  return bytes.buffer;
}
