import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, longtext, bigint, uniqueIndex } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 云端同步表:每个用户的每个 AsyncStorage 键存一行 JSON 快照。
 * (userId, storageKey) 唯一,last-write-wins。
 */
export const syncData = mysqlTable(
  "sync_data",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    storageKey: varchar("storageKey", { length: 128 }).notNull(),
    value: longtext("value").notNull(),
    clientUpdatedAt: bigint("clientUpdatedAt", { mode: "number" }).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [uniqueIndex("sync_user_key_idx").on(t.userId, t.storageKey)],
);

export type SyncData = typeof syncData.$inferSelect;

/** 应用级配置(如 ownerOpenId 访问白名单) */
export const appConfig = mysqlTable("app_config", {
  id: int("id").autoincrement().primaryKey(),
  configKey: varchar("configKey", { length: 64 }).notNull().unique(),
  configValue: text("configValue"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
