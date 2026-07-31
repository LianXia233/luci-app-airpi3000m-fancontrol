# 更新日志

本项目所有重要变更均记录于此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

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

[3.1.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.1.0
[3.0.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.0.0
