import { describe, expect, it, vi } from "vitest";
import { runArchiveResourcePreflight } from "../scripts/cloudflare/archive-resource-preflight.mjs";

type ApiResult = { success: boolean; result: unknown; errors?: Array<{ message: string }> };

function json(result: ApiResult, status = 200) {
  return new Response(JSON.stringify({ errors: [], ...result }), { status, headers: { "content-type": "application/json" } });
}

function createFetch({ missing = false }: { missing?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method || "GET";
    if (url.endsWith("/accounts")) return json({ success: true, result: [{ id: "account-1" }] });
    if (url.includes("/d1/database") && method === "GET") return json({ success: true, result: missing ? [] : [{ name: "cocktail-r-db", uuid: "d1-1" }] });
    if (url.includes("/r2/buckets") && method === "GET") return json({ success: true, result: missing ? { buckets: [] } : { buckets: [{ name: "cocktail-r-archives" }] } });
    if (url.includes("/storage/kv/namespaces") && method === "GET") return json({ success: true, result: missing ? [] : [{ id: "kv-1", title: "cocktail-r-cache" }] });
    if (url.endsWith("/d1/database") && method === "POST") return json({ success: true, result: { name: "cocktail-r-db", uuid: "d1-created" } });
    if (url.endsWith("/r2/buckets") && method === "POST") return json({ success: true, result: { name: "cocktail-r-archives" } });
    if (url.endsWith("/storage/kv/namespaces") && method === "POST") return json({ success: true, result: { id: "kv-created", title: "cocktail-r-cache" } });
    throw new Error(`Unhandled request ${method} ${url}`);
  });
}

const env = { CLOUDFLARE_API_TOKEN: "test-token", CLOUDFLARE_ACCOUNT_ID: "account-1" };

describe("归档Cloudflare资源预检", () => {
  it("默认只读检查缺失资源且绝不发送POST", async () => {
    const fetchImpl = createFetch({ missing: true });
    const report = await runArchiveResourcePreflight({ env, fetchImpl, argv: [] });

    expect(report.mode).toBe("check");
    expect(report.deploymentReady).toBe(false);
    expect(report.resources.map((resource) => resource.status)).toEqual(["missing", "missing", "missing"]);
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "POST" }));
  });

  it("初始化必须同时具备命令确认和环境确认，避免检查误创建生产资源", async () => {
    await expect(runArchiveResourcePreflight({ env, fetchImpl: createFetch({ missing: true }), argv: ["--apply"] }))
      .rejects.toThrow("Resource creation is blocked");
    await expect(runArchiveResourcePreflight({ env, fetchImpl: createFetch({ missing: true }), argv: ["--apply", "--confirm-production-resources"] }))
      .rejects.toThrow("Resource creation is blocked");
  });

  it("任一资源只读预检不可用时拒绝初始化，避免部分创建生产资源", async () => {
    const fetchImpl = createFetch({ missing: true });
    fetchImpl.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method || "GET";
      if (url.includes("/r2/buckets") && method === "GET") {
        return json({ success: false, result: null, errors: [{ message: "R2 permission denied" }] }, 403);
      }
      if (url.endsWith("/accounts")) return json({ success: true, result: [{ id: "account-1" }] });
      if (url.includes("/d1/database") && method === "GET") return json({ success: true, result: [] });
      if (url.includes("/storage/kv/namespaces") && method === "GET") return json({ success: true, result: [] });
      throw new Error(`unexpected ${method} ${url}`);
    });

    await expect(runArchiveResourcePreflight({
      env: { ...env, CLOUDFLARE_RESOURCE_INITIALIZATION: "ALLOW" },
      fetchImpl,
      argv: ["--apply", "--confirm-production-resources"],
    })).rejects.toThrow("Resource initialization is blocked");
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("显式双重确认时只创建缺失的D1、R2和KV资源", async () => {
    const fetchImpl = createFetch({ missing: true });
    const report = await runArchiveResourcePreflight({
      env: { ...env, CLOUDFLARE_RESOURCE_INITIALIZATION: "ALLOW" },
      fetchImpl,
      argv: ["--apply", "--confirm-production-resources"],
    });

    expect(report).toEqual(expect.objectContaining({ mode: "apply", deploymentReady: true }));
    expect(report.resources.map((resource) => resource.status)).toEqual(["created", "created", "created"]);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3);
  });
});
