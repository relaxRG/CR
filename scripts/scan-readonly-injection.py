"""
扫描所有需要注入 isReadOnly 的业务页面，输出精确的注入方案。
"""
import re, os, json

# 已处理的页面（跳过）
ALREADY_DONE = {
    "app/labor.tsx",
    "app/monthly-summary.tsx",
    "app/(tabs)/store.tsx",
}

# 敏感操作关键词（写入/删除/编辑）
SENSITIVE_KEYWORDS = [
    'handleSave', 'handleDelete', 'handleEdit', 'upsert', 'deleteRecord',
    'onSave', 'onDelete', 'addRecord', 'updateRecord', 'removeRecord'
]

# 权限检查关键词
PERMISSION_KEYWORDS = ['hasFeature', 'useFeature', 'canWrite', 'isOwner', 'deviceRole', 'isGuest', 'isReadOnly']

# 扫描所有 app/ 下的 tsx 文件
scan_files = []
for root, dirs, files in os.walk('app'):
    dirs[:] = [d for d in dirs if d not in ['node_modules', '.expo', 'dev']]
    for f in files:
        if f.endswith('.tsx') and not f.startswith('_'):
            scan_files.append(os.path.join(root, f))

results = []
for filepath in sorted(scan_files):
    if filepath in ALREADY_DONE:
        continue
    try:
        with open(filepath) as f:
            content = f.read()
            lines = content.split('\n')
    except:
        continue

    has_sensitive = any(kw in content for kw in SENSITIVE_KEYWORDS)
    has_permission = any(re.search(kw, content) for kw in PERMISSION_KEYWORDS)

    if not has_sensitive or has_permission:
        continue

    # 分析注入策略
    has_use_colors = 'useColors' in content
    has_use_sync = 'useSync' in content
    has_import_use_feature = 'use-feature' in content

    # 找到 useColors 的 import 行（用于插入 useFeature import）
    colors_import_line = None
    for i, line in enumerate(lines):
        if "from \"@/hooks/use-colors\"" in line or "from '@/hooks/use-colors'" in line:
            colors_import_line = i + 1  # 1-indexed
            break

    # 找到主组件函数中 useColors() 调用的行（用于插入 useFeature 调用）
    colors_call_line = None
    for i, line in enumerate(lines):
        if re.search(r'const\s+colors\s*=\s*useColors\(\)', line):
            colors_call_line = i + 1  # 1-indexed
            break

    # 统计敏感操作数量
    sensitive_count = sum(content.count(kw) for kw in SENSITIVE_KEYWORDS)

    # 检查是否有 FAB 按钮（常见的写入入口）
    has_fab = 'fab' in content.lower() or 'FloatingActionButton' in content or 'FAB' in content
    has_add_btn = '新增' in content or '添加' in content or 'onPress.*add\|onPress.*new' in content.lower()

    results.append({
        'file': filepath,
        'sensitive_count': sensitive_count,
        'colors_import_line': colors_import_line,
        'colors_call_line': colors_call_line,
        'has_fab': has_fab,
        'has_add_btn': has_add_btn,
    })

# 按敏感操作数量降序排列
results.sort(key=lambda x: -x['sensitive_count'])

print(json.dumps(results, ensure_ascii=False, indent=2))
print(f"\n# 共 {len(results)} 个文件需要注入", file=__import__('sys').stderr)
