import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type RegistryEntry = {
  backend: string;
  key: string;
  status: string;
  classification: string;
  dynamic: boolean;
  ownerFiles: string[];
  purgeOn: string[];
};

type Registry = {
  version: number;
  entryCount: number;
  dynamicEntryCount: number;
  entries: RegistryEntry[];
};

const registryPath = join(process.cwd(), "docs/local-storage-registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Registry;

describe("storage registry governance", () => {
  it("registers every dynamic key with an owner and an explicit cleanup lifecycle", () => {
    const dynamicEntries = registry.entries.filter((entry) => entry.dynamic);
    expect(dynamicEntries).toHaveLength(registry.dynamicEntryCount);
    for (const entry of dynamicEntries) {
      expect(entry.ownerFiles.length, entry.key).toBeGreaterThan(0);
      expect(entry.purgeOn.length, entry.key).toBeGreaterThan(0);
    }
  });

  it("treats every SecureStore key as a governed credential with a complete lifecycle", () => {
    const secureEntries = registry.entries.filter((entry) => entry.backend === "SecureStore");
    expect(secureEntries.length).toBeGreaterThan(0);
    for (const entry of secureEntries) {
      expect(entry.classification, entry.key).toBe("S2-credential");
      expect(entry.status, entry.key).not.toBe("unresolved");
      expect(entry.purgeOn, entry.key).toEqual(expect.arrayContaining(["logout", "leave-group", "switch-complete"]));
    }
  });

  it("normalizes device credentials and group-switch tickets into readable patterns", () => {
    expect(registry.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ backend: "SecureStore", key: "cf.sync.{deviceId|groupId|deviceName}", status: "pattern" }),
      expect.objectContaining({ backend: "SecureStore", key: "cf.sync.groupSwitchTicket.{switchId}", status: "pattern" }),
      expect.objectContaining({ backend: "SecureStore", key: "cf.sync.deviceToken", status: "resolved" }),
    ]));
  });
});
