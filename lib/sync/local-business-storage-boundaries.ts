/**
 * 业务相关但必须保持设备本地的持久化状态。
 *
 * 此表是例外而非默认：任何新的 S1-business AsyncStorage 键必须进入 SYNC_KEYS，
 * 除非它在这里列出明确、可验证且不会造成跨设备事实不一致的原因。
 */
export const LOCAL_ONLY_BUSINESS_STORAGE_BOUNDARIES = {
  "monthly_report.raw_excel_archive.v1": {
    reason: "归档索引包含本机沙盒 Documents URI；原始文件尚未进入受访问控制的共享文件存储，单独同步索引会产生无效文件引用。",
    owner: "reports.monthly",
    requiredUpgrade: "先将原始Excel文件上传至受权限控制的共享对象存储，并以远端对象标识替换本机 URI 后才能纳入业务同步。",
  },
  "monthly_report.archive_remote_outbox.v1": {
    reason: "归档远端写入的设备本地操作队列，包含待提交的条件写入与冲突状态；同步它会导致另一台设备重复执行同一操作。",
    owner: "reports.monthly",
    requiredUpgrade: "保持按设备持久化；只有服务端权威归档索引和对象元数据可以跨设备同步。",
  },
} as const;

export type LocalOnlyBusinessStorageKey = keyof typeof LOCAL_ONLY_BUSINESS_STORAGE_BOUNDARIES;
