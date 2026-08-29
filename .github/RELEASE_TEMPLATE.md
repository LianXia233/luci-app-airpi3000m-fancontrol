AirPi AP3000M 专用的 OpenWrt 风扇控制插件，提供 LuCI 网页界面与 Rust 温控守护进程。

> **仅适用于 AirPi AP3000M（MediaTek MT7981B / Filogic 平台）**，其他机型不适用。

## 该下载哪个文件

按自己的固件版本选择。**内核模块文件名中的数字即内核版本**，需与设备 `uname -r` 一致才能加载。

| 文件名后缀 | 适用固件 | 内核 | 包管理器 |
| --- | --- | --- | --- |
| `_openwrt-24.10.ipk` | OpenWrt 24.10.x | 6.6 | `opkg` |
| `_openwrt-25.12.apk` | OpenWrt 25.12.x | 6.12 | `apk` |
| `_immortalwrt-master.apk` | ImmortalWrt master 快照 | 6.18 | `apk` |

每个目标各含两个包：

- **`luci-app-airpi-fancontrol`**：LuCI 网页控制界面 + Rust 温控守护进程（aarch64_cortex-a53）
- **`kmod-airpi-gpio-fan`**：GPIO 软件 PWM 内核驱动（仅软件 PWM 模式需要）

> 若设备走硬件 PWM 模式（8GB eMMC 版本），可不安装内核模块。
> 自 v4.1.0 起内核模块已移除包管理器层面的 `kernel (=版本)` 硬依赖，但仍受 vermagic 校验约束。

## 安装方法

```sh
# OpenWrt 25.12 / ImmortalWrt（apk）
apk add --allow-untrusted ./luci-app-airpi-fancontrol_*_openwrt-25.12.apk \
                          ./kmod-airpi-gpio-fan_*_openwrt-25.12.apk

# OpenWrt 24.10 及更早（ipk）
opkg install ./luci-app-airpi-fancontrol_*_openwrt-24.10.ipk \
             ./kmod-airpi-gpio-fan_*_openwrt-24.10.ipk
```

安装完成后刷新浏览器缓存，在 **状态 → 风扇控制** 查看运行状态，在 **状态 → 风扇设置** 调整驱动参数。命令行可用 `/etc/init.d/airpi-fancontrol restart` 重启服务。
