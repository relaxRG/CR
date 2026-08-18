import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const client = readFileSync("lib/cf-sync/client.ts", "utf8");
const worker = readFileSync("workers/cocktail-ai/worker-v4.js", "utf8");
const migration = readFileSync("workers/cocktail-ai/migrations/20260818_web_device_sessions.sql", "utf8");

describe("Web deviceToken 安全会话", () => {
  it("Web端不再将deviceToken写入AsyncStorage，并只保存短期内存票据", () => {
    expect(client).toContain("const webMemoryTickets = new Map<string, WebMemoryTicket>()");
    expect(client).toContain("if (Platform.OS === \"web\") return;");
    expect(client).not.toContain("AsyncStorage.setItem(DEVICE_TOKEN_KEY");
    expect(client).not.toContain("AsyncStorage.getItem(DEVICE_TOKEN_KEY");
    expect(client).toContain('AsyncStorage.removeItem(DEVICE_TOKEN_KEY)');
    expect(client).toContain('headers["X-Web-Device-Ticket"] = deviceInfo.webMemoryTicket');
    expect(client).toContain('credentials: Platform.OS === "web" ? "include" : undefined');
  });

  it("Worker签发HttpOnly Cookie会话和10分钟内存票据，并支持两者鉴权", () => {
    expect(worker).toContain('const WEB_DEVICE_SESSION_COOKIE = "cr_sync_session"');
    expect(worker).toContain("HttpOnly; Secure; SameSite=None");
    expect(worker).toContain("const WEB_DEVICE_MEMORY_TICKET_TTL_MS = 10 * 60 * 1000");
    expect(worker).toContain('headers.get("X-Web-Device-Ticket")');
    expect(worker).toContain("verifyRequestDevice(env, headers)");
    expect(worker).toContain("deviceToken: undefined, webMemoryTicket");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS web_device_sessions");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS web_device_memory_tickets");
  });
});
