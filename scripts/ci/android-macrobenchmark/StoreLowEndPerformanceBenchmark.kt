// 模板文件：在 prebuild Android 项目内创建 :macrobenchmark 模块后放入对应 package。
// 目标：低端受控物理设备；禁止以模拟器数值作为性能基线。
package com.app.cocktailrecipes.macrobenchmark

import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val TARGET_PACKAGE = "com.app.cocktailrecipes"
private const val ITERATIONS = 7

@LargeTest
@RunWith(AndroidJUnit4::class)
class StoreLowEndPerformanceBenchmark {
  @get:Rule val benchmarkRule = MacrobenchmarkRule()

  @Test
  fun pettyCashLongList() = benchmarkRule.measureRepeated(
    packageName = TARGET_PACKAGE,
    metrics = listOf(StartupTimingMetric(), FrameTimingMetric()),
    compilationMode = CompilationMode.Partial(),
    startupMode = StartupMode.COLD,
    iterations = ITERATIONS,
    setupBlock = {
      pressHome()
      startActivityAndWait()
      device.wait(Until.hasObject(By.res("store-tab-petty")), 15_000)
      device.findObject(By.res("store-tab-petty")).click()
      device.wait(Until.hasObject(By.res("petty-ledger-list")), 15_000)
    },
  ) {
    val ledger = device.findObject(By.res("petty-ledger-list"))
    ledger.setGestureMargin(device.displayWidth / 6)
    ledger.fling(Direction.DOWN)
    ledger.fling(Direction.UP)
  }

  @Test
  fun inventoryLongList() = benchmarkRule.measureRepeated(
    packageName = TARGET_PACKAGE,
    metrics = listOf(StartupTimingMetric(), FrameTimingMetric()),
    compilationMode = CompilationMode.Partial(),
    startupMode = StartupMode.COLD,
    iterations = ITERATIONS,
    setupBlock = {
      pressHome()
      startActivityAndWait()
      device.wait(Until.hasObject(By.res("store-tab-inventory")), 15_000)
      device.findObject(By.res("store-tab-inventory")).click()
      device.wait(Until.hasObject(By.res("inventory-ledger-list")), 15_000)
    },
  ) {
    val ledger = device.findObject(By.res("inventory-ledger-list"))
    ledger.setGestureMargin(device.displayWidth / 6)
    ledger.fling(Direction.DOWN)
    ledger.fling(Direction.UP)
  }
}

/*
异常捕获要求：
1. Gradle 执行后保留 Macrobenchmark JSON 与每次迭代的 Perfetto trace。
2. CI 在每次场景前后执行 adb shell dumpsys meminfo TARGET_PACKAGE，记录 PSS。
3. 若 Gradle、校验器或设备掉线失败，run-android-low-end-performance.sh 收集：
   adb logcat -d -t 2000、adb bugreport、trace 文件、meminfo 和 benchmark JSON。
4. 正式运行时将 React Native testID 映射为上述资源 ID；在 app 中未提供这些 ID 前，模板不得宣称已可运行。
*/
