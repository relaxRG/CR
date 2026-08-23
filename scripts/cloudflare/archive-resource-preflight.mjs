#!/usr/bin/env node

const API_BASE = "https://api.cloudflare.com/client/v4";
const APPLY_CONFIRMATION = "ALLOW";

function parseArgs(argv) {
  const args = new Set(argv);
  return Object.freeze({
    apply: args.has("--apply"),
    confirmProductionResources: args.has("--confirm-production-resources"),
  });
}

function resourceNames(env) {
  return Object.freeze({
    d1: env.CLOUDFLARE_ARCHIVE_D1_NAME || "cocktail-r-db",
    r2: env.CLOUDFLARE_ARCHIVE_R2_BUCKET || "cocktail-r-archives",
    kv: env.CLOUDFLARE_ARCHIVE_KV_NAMESPACE || "cocktail-r-cache",
  });
}

async function api(fetchImpl, token, path, options = {}) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const message = payload?.errors?.map((entry) => entry.message).join("; ") || `HTTP ${response.status}`;
    throw new Error(`${options.method || "GET"} ${path} failed: ${message}`);
  }
  return payload.result;
}

function asArray(result, nestedKey) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.[nestedKey])) return result[nestedKey];
  return [];
}

async function resolveAccountId(fetchImpl, token, env) {
  if (env.CLOUDFLARE_ACCOUNT_ID) return env.CLOUDFLARE_ACCOUNT_ID;
  const accounts = asArray(await api(fetchImpl, token, "/accounts"), "result");
  if (accounts.length !== 1 || !accounts[0]?.id) {
    throw new Error("Set CLOUDFLARE_ACCOUNT_ID explicitly when the token can access zero or multiple accounts.");
  }
  return accounts[0].id;
}

function toStatus(kind, name, existing, created = false, unavailableReason) {
  return Object.freeze({ kind, name, status: unavailableReason ? "unavailable" : existing ? (created ? "created" : "ready") : "missing", unavailableReason });
}

/**
 * @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} ArchiveResourceFetch
 */

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: ArchiveResourceFetch,
 *   argv?: string[],
 * }} options
 */
export async function runArchiveResourcePreflight({ env = process.env, fetchImpl = fetch, argv = [] } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required for Cloudflare resource preflight.");

  const flags = parseArgs(argv);
  if (flags.apply && (!flags.confirmProductionResources || env.CLOUDFLARE_RESOURCE_INITIALIZATION !== APPLY_CONFIRMATION)) {
    throw new Error("Resource creation is blocked. Use --apply --confirm-production-resources and set CLOUDFLARE_RESOURCE_INITIALIZATION=ALLOW.");
  }
  if (flags.apply) {
    const readOnlyPreflight = await runArchiveResourcePreflight({ env, fetchImpl, argv: [] });
    const unavailable = readOnlyPreflight.resources.filter((resource) => resource.status === "unavailable");
    if (unavailable.length > 0) {
      throw new Error(`Resource initialization is blocked until all read checks succeed: ${unavailable.map((resource) => resource.kind).join(", ")}.`);
    }
  }

  const accountId = await resolveAccountId(fetchImpl, token, env);
  const names = resourceNames(env);
  const resources = [];

  let d1;
  try {
    const d1List = asArray(await api(fetchImpl, token, `/accounts/${accountId}/d1/database?name=${encodeURIComponent(names.d1)}`), "result");
    d1 = d1List.find((entry) => entry?.name === names.d1);
    if (!d1 && flags.apply) d1 = await api(fetchImpl, token, `/accounts/${accountId}/d1/database`, { method: "POST", body: { name: names.d1 } });
    resources.push(toStatus("d1", names.d1, d1, Boolean(d1 && d1List.length === 0 && flags.apply)));
  } catch (error) {
    resources.push(toStatus("d1", names.d1, null, false, error instanceof Error ? error.message : "D1 check failed"));
  }

  let r2;
  try {
    const r2List = asArray(await api(fetchImpl, token, `/accounts/${accountId}/r2/buckets`), "buckets");
    r2 = r2List.find((entry) => entry?.name === names.r2);
    if (!r2 && flags.apply) r2 = await api(fetchImpl, token, `/accounts/${accountId}/r2/buckets`, { method: "POST", body: { name: names.r2 } });
    resources.push(toStatus("r2", names.r2, r2, Boolean(r2 && !r2List.some((entry) => entry?.name === names.r2) && flags.apply)));
  } catch (error) {
    resources.push(toStatus("r2", names.r2, null, false, error instanceof Error ? error.message : "R2 check failed"));
  }

  let kv;
  try {
    const kvList = asArray(await api(fetchImpl, token, `/accounts/${accountId}/storage/kv/namespaces?per_page=100`), "result");
    kv = kvList.find((entry) => entry?.title === names.kv);
    if (!kv && flags.apply) kv = await api(fetchImpl, token, `/accounts/${accountId}/storage/kv/namespaces`, { method: "POST", body: { title: names.kv } });
    resources.push(toStatus("kv", names.kv, kv, Boolean(kv && !kvList.some((entry) => entry?.title === names.kv) && flags.apply)));
  } catch (error) {
    resources.push(toStatus("kv", names.kv, null, false, error instanceof Error ? error.message : "KV check failed"));
  }

  const report = Object.freeze({
    mode: flags.apply ? "apply" : "check",
    accountId,
    resources,
    deploymentReady: resources.every((resource) => resource.status === "ready" || resource.status === "created"),
    next: flags.apply
      ? "Run D1 migrations, update deployment-only binding values, then deploy from the approved release runner."
      : "Review this report. To create only missing resources, re-run with --apply --confirm-production-resources and CLOUDFLARE_RESOURCE_INITIALIZATION=ALLOW.",
  });
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runArchiveResourcePreflight({ argv: process.argv.slice(2) })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Archive resource preflight failed");
      process.exitCode = 1;
    });
}
