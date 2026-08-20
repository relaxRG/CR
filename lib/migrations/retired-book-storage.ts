const RETIRED_BOOK_EXACT_KEYS = new Set(["cocktail.books.v1"]);
const RETIRED_BOOK_PREFIXES = [
  "books.ch.",
  "cocktail.reader.highlights.v1.",
  "cocktail.reader.settings.v1.",
] as const;

/** 已删除书库的历史持久化命名空间；仅供一次性退役清理使用。 */
export function isRetiredBookStorageKey(key: string): boolean {
  return RETIRED_BOOK_EXACT_KEYS.has(key) || RETIRED_BOOK_PREFIXES.some((prefix) => key.startsWith(prefix));
}
