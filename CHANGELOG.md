# 更新日志

本项目所有重要变更均记录于此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [3.4.2] - 2026-08-03

### 变更

- **UI 优化**：状态横幅从扁平单行字符串改为三列卡片布局（eMMC 闪存 / 硬件 PWM / 软件 PWM）
  - 每张卡片独立配色：蓝色系（eMMC）、绿色/红色（硬件PWM）、绿色/橙色（软件PWM）
  - 圆角 + 左侧彩色边框，分类标题 + 状态 + 详情三行结构，动态变色
- 更新 `fan_driver` 字段描述，提及 eMMC 容量自动检测逻辑

## [3.4.1] - 2026-08-03

### 修复

- **16GB 设备 `detect_hw_pwm()` 仍显示硬件 PWM 可用**：CBI 模型中的 `detect_hw_pwm()` 此前仅做纯路径探测，在 16GB eMMC 设备上即使 `selected_driver()` 已正确选择软件 PWM，状态横幅仍显示「硬件PWM可用」。现新增 eMMC 容量守卫：>25M 扇区（16GB）直接返回 nil，使硬件 PWM 标记为"不可用"

## [3.4.0] - 2026-08-03

### 新增

- **eMMC 容量自动识别驱动模式**：`selected_driver()` 在 auto 模式下通过 `/sys/block/mmcblk0/size` 检测 eMMC 容量
  - >25,000,000 扇区（16GB）→ 自动选择软件 PWM
  - ≤25,000,000 扇区（8GB）→ 自动选择硬件 PWM
  - 无法读取时回退到路径探测逻辑
- CBI 驱动状态横幅新增「eMMC 容量」行，显示闪存版本与对应驱动建议

### 变更

- Controller 新增 `detect_emmc_size()` 函数
- CBI 新增 `detect_emmc()` 函数

## [3.3.0] - 2026-08-03

### 修复

- **CBI section type 不匹配导致「尚无任何配置」**：`TypedSection` 此前使用 `type="settings"`，但 UCI config 的实际 type 为 `fan`，导致页面始终显示「尚无任何配置」。修正为 `TypedSection("fan")`

### 新增

- **软硬件 PWM 双模式 UI**：支持在同一页面内选择和配置硬件 PWM 或软件 PWM 驱动
  - 驱动状态横幅：实时显示硬件 PWM 可用性、软 PWM 内核状态、当前占空比
  - 硬件 PWM 模式：显示 PWM 芯片检测结果（hwmon pwm-fan / sysfs pwmchip）
  - 软件 PWM 模式：显示内核模块加载状态、当前占空比、GPIO 与周期参数
  - 「重新加载驱动」按钮：根据所选模式智能重载对应内核模块
- Controller `find_pwm_path()` 新增 sysfs pwmchip 探测（MT7981 内置 PWM 控制器）

### 变更

- Controller `find_pwm_path()` 扩展为双路径：hwmon pwm-fan → sysfs pwmchip 级联探测

## [3.2.0] - 2026-08-03

### 修复

- **init 脚本改为 procd 管理模式**：此前 `/usr/bin/fancts.sh &` 后台启动方式在父 shell 退出后守护进程会被杀死，导致风扇控制失效。现改为 `USE_PROCD=1`，由 procd 管理进程生命周期，崩溃自动重启，确保风扇持续受控
- **LuCI 手动调速适配 procd**：手动 / 无极模式停止守护进程时改用 `/etc/init.d/airpi-fancontrol stop` 替代 `kill -9`；智能模式切换时改用 `/etc/init.d/airpi-fancontrol start` 替代直接后台启动，与 procd 管理保持一致

### 变更

- init 脚本新增 `service_triggers()` 与 `reload_service()`，支持 UCI 配置变更后自动重载

## [3.1.0] - 2026-07-31

本次以「让项目能被正常编译和安装」为目标，修复了此前无法通过 OpenWrt SDK 构建的问题，并接入自动编译发布流程。

### 新增

- 接入 GitHub Actions 自动编译流程，基于 OpenWrt 官方 `mediatek/filogic` SDK 构建
- 同时产出两种安装包格式：OpenWrt 24.10.8 生成 `.ipk`、OpenWrt 25.12.5 生成 `.apk`
- 推送 `v` 开头的 tag 即自动创建 Release 并上传全部安装包，发布说明为中文
- 支持在 Actions 页面手动触发编译，可自选是否创建 Release
- 补充完整的中文 README，涵盖设备参数、安装方式、调速模式、温度曲线、配置项与常见问题
- 新增本更新日志文件
- 新增 GPL-2.0 许可证文件

### 变更

- 将内核模块从 LuCI 应用中拆分为独立软件包 `airpi-gpio-fan`，两者可各自单独编译安装
- LuCI 应用改用标准 `package.mk` 构建，不再依赖 LuCI feed 的 `luci.mk`，可直接放入任意 SDK 的 `package/` 目录编译
- 将 `/etc/config/airpi-fan` 登记为 conffile，升级插件时不再覆盖用户配置
- 新增安装后自动启用服务、卸载前自动停止服务的脚本
- 版本号统一升至 3.1.0

### 修复

- 修复 `include ../../luci.mk` 在 SDK 环境下路径无法解析、导致编译直接失败的问题
- 修复内核模块 Kbuild 文件名为 `airpi-gpio-fan-Makefile`、kbuild 找不到 `Makefile` 而无法编译的问题
- 补充缺失的 `include $(INCLUDE_DIR)/kernel.mk`，此前 `LINUX_DIR`、`LINUX_KARCH` 为空
- 修复依赖中使用了无效配置符号 `@TARGET_aarch64_cortex-a53`，会导致内核模块被静默跳过、永远不参与编译
- 补充缺失的 `luci-compat` 依赖。该包提供传统 CBI 框架，缺少时「风扇设置」页面在原版 24.10 / 25.12 固件上会直接报错
- 修复驱动通过 `kobject_create_and_add("kernel", NULL)` 创建 sysfs 节点的错误做法。`/sys/kernel` 已由内核自身创建，重复创建会失败，导致 `/sys/kernel/duty_cycle` 根本不存在；现改为挂载到内核导出的 `kernel_kobj` 上
- 增加对 Linux 6.15+ 的兼容。该版本起 `hrtimer_init()` 已被移除，现按内核版本自动切换到 `hrtimer_setup()`
- 增加模块参数合法性校验，避免 `period` 为 0 时在计算 PWM 频率处触发除零
- 清理驱动中未使用的变量与冗余的 `ktime` 计算，消除编译告警
- 移除指向不存在文件的 `PKG_LICENSE_FILES`

## [3.0.0] - 2026-01

### 变更

- 重构为统一的 AirPi 风扇控制软件包，同时支持软件 PWM 与硬件 PWM 两种驱动
- 统一温度采集脚本，支持 CPU、Wi-Fi 芯片、网络 PHY 三级回退
- LuCI 界面提供静音 / 低速 / 常速 / 全速 / 无极 / 智能六种调速方式

[3.4.2]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.4.2
[3.4.1]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.4.1
[3.4.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.4.0
[3.3.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.3.0
[3.2.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.2.0
[3.1.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.1.0
[3.0.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.0.0
