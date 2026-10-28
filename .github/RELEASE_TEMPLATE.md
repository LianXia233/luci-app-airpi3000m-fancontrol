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

> [!WARNING]
> **先确认固件是否已自带风扇驱动再决定装不装 kmod。** 内核模块必须与固件的
> 内核（版本**和编译配置**）一致才能加载：`vermagic` 相同不代表能加载，
> 配置不同会导致 `.gnu.linkonce.this_module section size must match` 拒绝。
> 本仓库 Release 的 kmod 由 CI 按官方固件内核配置构建并校验，适用于**官方
> OpenWrt 24.10.8 / 25.12.5 / ImmortalWrt 同期或更新的快照固件**。
> 若 `lsmod | grep airpi_gpio_fan` 有输出（厂商 / 自建固件内置了该模块），
> **只安装 luci-app，不要安装本 Release 的 kmod**——覆盖后模块将无法加载，
> 风扇会停在 `stop_duty`。自建固件请在镜像构建时直接纳入本仓库的包。
> 若安装后日志出现上述拒绝信息，执行
> `apk del kmod-airpi-gpio-fan && cp /rom/lib/modules/$(uname -r)/airpi-gpio-fan.ko /lib/modules/$(uname -r)/airpi-gpio-fan.ko && /etc/init.d/airpi-fancontrol restart`
> 恢复固件自带模块（仅适用于固件内置该模块的设备）。

## 安装方法

```sh
# OpenWrt 25.12 / ImmortalWrt（apk）
apk add --allow-untrusted ./luci-app-airpi-fancontrol_*_openwrt-25.12.apk \
                          ./kmod-airpi-gpio-fan_*_openwrt-25.12.apk

# OpenWrt 24.10 及更早（ipk）
opkg install ./luci-app-airpi-fancontrol_*_openwrt-24.10.ipk \
             ./kmod-airpi-gpio-fan_*_openwrt-24.10.ipk
```

安装完成后刷新浏览器缓存，在 **状态 → 风扇控制** 查看运行状态并调整驱动参数（状态座舱与硬件总线配置已合并到同一页面，v6.0.0 起不再有独立的「风扇设置」子菜单）。命令行可用 `/etc/init.d/airpi-fancontrol restart` 重启服务。
