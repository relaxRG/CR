import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, appConfig, syncData } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.

/* ===================== 云端同步 ===================== */

/** 拉取用户全部同步键值 */
export async function getSyncData(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      storageKey: syncData.storageKey,
      value: syncData.value,
      clientUpdatedAt: syncData.clientUpdatedAt,
    })
    .from(syncData)
    .where(eq(syncData.userId, userId));
}

/** 批量 upsert 同步键值(last-write-wins:仅当传入的 clientUpdatedAt 更新时覆盖) */
export async function upsertSyncData(
  userId: number,
  entries: { storageKey: string; value: string; clientUpdatedAt: number }[],
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const entry of entries) {
    const existing = await db
      .select({ id: syncData.id, clientUpdatedAt: syncData.clientUpdatedAt })
      .from(syncData)
      .where(and(eq(syncData.userId, userId), eq(syncData.storageKey, entry.storageKey)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(syncData).values({
        userId,
        storageKey: entry.storageKey,
        value: entry.value,
        clientUpdatedAt: entry.clientUpdatedAt,
      });
    } else if (entry.clientUpdatedAt >= existing[0].clientUpdatedAt) {
      await db
        .update(syncData)
        .set({ value: entry.value, clientUpdatedAt: entry.clientUpdatedAt })
        .where(eq(syncData.id, existing[0].id));
    }
  }
}

/* ===================== 访问控制(owner) ===================== */

export async function getAppConfigValue(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ configValue: appConfig.configValue })
    .from(appConfig)
    .where(eq(appConfig.configKey, key))
    .limit(1);
  return rows.length > 0 ? rows[0].configValue : null;
}

export async function setAppConfigValue(key: string, value: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select({ id: appConfig.id })
    .from(appConfig)
    .where(eq(appConfig.configKey, key))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(appConfig).values({ configKey: key, configValue: value });
  } else {
    await db.update(appConfig).set({ configValue: value }).where(eq(appConfig.id, existing[0].id));
  }
}
