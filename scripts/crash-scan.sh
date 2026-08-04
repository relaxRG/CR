#!/bin/bash
set -e
cd /home/ubuntu/CR

FILES="app/labor.tsx app/labor-attendance.tsx app/labor-advances.tsx app/labor-employees.tsx app/labor-performance.tsx app/labor-schedule.tsx app/labor-salary-history.tsx app/labor-employee-form.tsx app/monthly-summary.tsx"

echo "=== 1. 非空断言操作符 (!) 可能导致崩溃 ==="
grep -n '[a-zA-Z0-9_)]!' $FILES | grep -v '//' | grep -v '!== \|!== \|!important\|!=\|! \|!$\|eslint\|@ts-' | head -20

echo ""
echo "=== 2. 直接访问数组 [0] 而不做空值检查 ==="
grep -n '\[0\]\.' $FILES | grep -v '//' | grep -v '?\.' | head -15

echo ""
echo "=== 3. useLocalSearchParams 参数未做空值检查 ==="
grep -n 'useLocalSearchParams\|params\.' $FILES | head -10

echo ""
echo "=== 4. JSON.parse 未包裹 try-catch ==="
grep -n 'JSON\.parse' $FILES | head -10

echo ""
echo "=== 5. 除法运算未检查除数为零 ==="
grep -n '/ [a-zA-Z]' $FILES | grep -v '//' | grep -v 'Math\|fontSize\|padding\|margin\|width\|height\|flex\|gap\|border\|radius\|opacity\|shadow\|elevation\|zIndex\|line' | head -20

echo ""
echo "=== 6. router.push 路由路径（检查是否都已注册）==="
grep -n 'router\.push' $FILES | grep -v '//' | head -20

echo ""
echo "=== 7. useSegments / usePathname 等可能返回 undefined ==="
grep -n 'useSegments\|usePathname\|useGlobalSearchParams' $FILES | head -5

echo ""
echo "=== 8. 渲染中直接调用可能抛出异常的函数 ==="
grep -n 'toFixed\|toLocaleString\|toString' $FILES | grep -v '//' | grep -v '??\|?.\||| ' | head -20
