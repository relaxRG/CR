import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();

if (!existsSync(resolve(root, ".git"))) {
  console.log("[git-hooks] 非Git工作树，跳过本地钩子安装。");
  process.exit(0);
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: root,
  stdio: "inherit",
});

console.log("[git-hooks] 已启用 .githooks/pre-commit：Provider稳定性与高频渲染性能门禁将在提交前执行。");
