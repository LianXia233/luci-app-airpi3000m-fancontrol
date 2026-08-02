# luci-app-airpi3000m-fancontrol

Airpi AP3000M 专用的 OpenWrt 风扇控制插件，提供 LuCI 网页界面与温度自动调速守护进程。

[![编译与发布](https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/actions/workflows/build.yml/badge.svg)](https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/actions/workflows/build.yml)
[![许可证](https://img.shields.io/badge/license-GPL--2.0-blue.svg)](LICENSE)

> **本插件为 Airpi AP3000M 专用，不适用于其他机型。**
> 其中的 GPIO 引脚编号、PWM sysfs 路径、温度传感器探测顺序均按该设备适配，装到别的路由器上不会工作。
> <span style="color:#d00;"><strong>温馨提示：</strong>目前还没有进行实机测试，不保证功能可用。</span>
> <span style="color:#d00;">如需使用，请先确认你的设备、内核版本和驱动环境与本项目匹配。</span>
> <span style="color:#d00;">若遇到异常，请以实际日志和设备表现为准，谨慎安装与升级。</span>

---

## 设备信息

| 项目 | 参数 |
| --- | --- |
| 型号 | Airpi AP3000M 5G CPE |
| 主控 | MediaTek MT7981B（双核 ARM Cortex-A53） |
| OpenWrt 目标平台 | `mediatek/filogic` |
| 软件包架构 | `aarch64_cortex-a53` |
| 内存 / 存储 | 1GB DDR4 / 8GB 或 16GB eMMC |
| 散热 | PWM 控制风扇 |
| 设备树标识 | `airpi,ap3000m` |

OpenWrt 主线自 25.12 起已内置该设备支持。

---

## 功能特性

- **双驱动支持**，默认自动识别，也可在网页端手动切换：
  - **硬件 PWM**：检测到内核 `pwm-fan`（hwmon）接口时优先使用
  - **软件 PWM**：未检测到硬件接口时使用本项目的 `kmod-airpi-gpio-fan` GPIO 位翻转驱动
- **四档手动调速**：静音 25% / 低速 50% / 常速 75% / 全速 100%
- **无极调速**：滑块任意设定 0–255 占空比
- **智能温控**：按温度曲线自动调速
- **多温度源自动回退**：CPU → Wi-Fi 芯片 → 网络 PHY，并支持切换到 5G 模组温度
- **实时状态显示**：当前转速、当前模式、当前温度及温度来源

---

## 软件包组成

| 软件包 | 架构 | 说明 |
| --- | --- | --- |
| `luci-app-airpi-fancontrol` | `all` | LuCI 网页界面、温控守护进程、init 脚本 |
| `kmod-airpi-gpio-fan` | `aarch64_cortex-a53` | GPIO 软件 PWM 内核驱动（仅软 PWM 模式需要） |

依赖：`luci-compat`、`luci-lua-runtime`、`kmod-hwmon-pwmfan`。

---

## 安装

前往 [Releases](https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases) 页面下载对应格式的安装包。

| 固件版本 | 包格式 | 包管理器 |
| --- | --- | --- |
| OpenWrt 25.12.x 及更新 | `.apk` | `apk` |
| OpenWrt 24.10.x 及更早 | `.ipk` | `opkg` |

```sh
# OpenWrt 25.12 及以上
apk add --allow-untrusted ./luci-app-airpi-fancontrol-*.apk ./kmod-airpi-gpio-fan-*.apk

# OpenWrt 24.10 及以下
opkg install ./luci-app-airpi-fancontrol_*.ipk ./kmod-airpi-gpio-fan_*.ipk
```

安装完成后刷新浏览器缓存，在 **状态 → 风扇控制** 查看运行状态，在 **状态 → 风扇设置** 调整驱动参数。

> **内核模块与内核版本严格绑定。** `kmod-airpi-gpio-fan` 必须与本机固件的内核版本一致才能加载，请务必下载与固件大版本匹配的那一份。若只使用硬件 PWM 模式，可以不装这个内核模块。

---

## 使用说明

### 选择风扇驱动

默认的「自动识别」模式会检测可写的 `pwm-fan` hwmon 接口：检测到则使用硬件 PWM，否则加载并使用软件 PWM。也可在 **状态 → 风扇设置** 中手动选择：

- **使用 PWM 驱动**：强制使用已检测到的硬件 PWM 控制器
- **使用软 PWM 模拟驱动**：强制使用 GPIO 高频翻转模拟 PWM

选择软 PWM 后可继续配置：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 风扇 GPIO | `540` | 驱动风扇的 GPIO 编号 |
| 模拟 PWM 周期(μs) | `15000` | 周期越大越容易啸叫，越小 CPU 占用越高 |

修改参数后需先「保存并应用」，再点击 **重新应用新的参数** 卸载并重新加载驱动才会生效。

### 调速模式

| 模式 | 占空比 | 说明 |
| --- | --- | --- |
| 静音 | 64 / 255（约 25%） | 最低转速 |
| 低速 | 128 / 255（约 50%） | |
| 常速 | 192 / 255（约 75%） | |
| 全速 | 255 / 255（100%） | |
| 无极 | 0–255 任意 | 滑块自定义 |
| 智能 | 自动 | 按下方温度曲线自动调节 |

### 智能温控曲线

守护进程 `fancts.sh` 每 8 秒采样一次温度，按下表调整占空比：

| 温度区间 | 占空比 | 约合转速 |
| --- | --- | --- |
| > 85 °C | 255 | 100% |
| 60 – 85 °C | 192 | 75% |
| 50 – 60 °C | 128 | 50% |
| ≤ 50 °C | 64 | 25% |

### 温度来源

`get_sys_temp.sh` 按以下顺序探测，取第一个落在 1 °C – 150 °C 合理区间的读数：

1. **CPU**：`/sys/class/thermal/thermal_zone0/temp`
2. **Wi-Fi 芯片**：MTK 驱动 `iwpriv ra0/rax0/rai0 stat`
3. **网络 PHY**：`/sys/class/hwmon/hwmon1/temp1_input`

若已插入 5G 模组，还可在界面上切换为 **模组温度**，通过 `AT^CHIPTEMP?` 读取模组芯片温度。

---

## 配置文件

配置位于 `/etc/config/airpi-fan`：

```
config fan 'settings'
	option fan_driver 'auto'      # auto | softpwm | pwm
	option fan_gpio   '540'       # 软 PWM 使用的 GPIO 编号
	option fan_freq   '15000'     # 软 PWM 周期，单位微秒
	option fan_enable '1'         # 风扇总开关
```

该文件已登记为 conffile，升级插件时不会被覆盖。

### 服务管理

```sh
/etc/init.d/airpi-fancontrol start     # 启动
/etc/init.d/airpi-fancontrol stop      # 停止（并将转速降到最低）
/etc/init.d/airpi-fancontrol restart   # 重启
/etc/init.d/airpi-fancontrol enable    # 开机自启
```

### 内核模块参数

```sh
insmod airpi-gpio-fan.ko fangpio=540 cycle=255 period=15000 fanen=1
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `fangpio` | 540 | 输出 PWM 的 GPIO 编号 |
| `cycle` | 255 | 占空比最大值 |
| `period` | 15000 | PWM 周期（微秒） |
| `fanen` | 1 | 1 = 启用，0 = 强制输出低电平 |

加载后通过 `/sys/kernel/duty_cycle` 直接控制转速：

```sh
echo 128 > /sys/kernel/duty_cycle    # 设为 50%
cat /sys/kernel/duty_cycle           # 读取当前值
```

---

## 自行编译

### 通过 GitHub Actions

推送 `v` 开头的 tag 即自动编译并发布：

```sh
git tag v3.1.0
git push origin v3.1.0
```

也可在 Actions 页面手动运行 **编译与发布**，填入发布标签即可创建 Release；留空则仅上传构建产物。

### 通过 OpenWrt SDK 本地编译

```sh
# 以 25.12.5 filogic SDK 为例
wget https://downloads.openwrt.org/releases/25.12.5/targets/mediatek/filogic/openwrt-sdk-25.12.5-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst
tar --zstd -xf openwrt-sdk-*.tar.zst && cd openwrt-sdk-*/

./scripts/feeds update -a && ./scripts/feeds install -a

git clone https://github.com/LianXia233/luci-app-airpi3000m-fancontrol.git /tmp/airpi
ln -s /tmp/airpi/luci-app-airpi-fancontrol package/luci-app-airpi-fancontrol
ln -s /tmp/airpi/airpi-gpio-fan            package/airpi-gpio-fan

make defconfig
echo 'CONFIG_PACKAGE_luci-app-airpi-fancontrol=m' >> .config
echo 'CONFIG_PACKAGE_kmod-airpi-gpio-fan=m'       >> .config
make defconfig

make package/luci-app-airpi-fancontrol/compile V=s
make package/airpi-gpio-fan/compile V=s
```

产物位于 `bin/packages/aarch64_cortex-a53/base/` 与 `bin/targets/mediatek/filogic/packages/`。

### 并入固件源码树编译

将两个包目录复制到源码树的 `package/` 下，然后在 `make menuconfig` 中勾选：

- `LuCI → 3. Applications → luci-app-airpi-fancontrol`
- `Kernel modules → Other modules → kmod-airpi-gpio-fan`

---

## 常见问题

**「模拟PWM内核未加载」一直是红色**

说明 `airpi-gpio-fan.ko` 没有成功 insmod。依次检查：

```sh
lsmod | grep -i airpi              # 是否已加载
logread | grep airpi_gpio_fan      # 查看驱动日志
ls /sys/kernel/duty_cycle          # sysfs 节点是否存在
```

最常见的原因是内核模块与当前内核版本不匹配，重新下载对应固件版本的包即可。

**风扇有啸叫声**

软 PWM 模式下适当调低「模拟 PWM 周期」，或改用硬件 PWM 驱动。

**温度一直显示 null**

说明所有温度源都读不到有效值。手动执行 `/usr/bin/get_sys_temp.sh -s` 查看返回的数值与来源标签进行排查。

**风扇不转 / 一直全速**

先使用默认的「自动识别」模式。若手动指定驱动，确认硬件 PWM 模式存在 `pwm-fan` hwmon 接口，软件 PWM 模式则需要成功加载 `airpi-gpio-fan.ko`。

---

## 目录结构

```
.
├── .github/workflows/build.yml       自动编译与发布流程
├── airpi-gpio-fan/                   GPIO 软 PWM 内核驱动
│   ├── Makefile                      OpenWrt 内核模块打包定义
│   └── src/
│       ├── Makefile                  Kbuild 编译定义
│       └── airpi-gpio-fan.c          驱动源码
├── luci-app-airpi-fancontrol/        LuCI 应用
│   ├── Makefile                      OpenWrt 软件包定义
│   └── files/
│       ├── etc/config/airpi-fan      UCI 配置
│       ├── etc/init.d/airpi-fancontrol  服务脚本
│       ├── usr/bin/fancts.sh         温控守护进程
│       ├── usr/bin/get_sys_temp.sh   温度采集脚本
│       └── usr/lib/lua/luci/         控制器 / CBI 模型 / 视图
├── CHANGELOG.md                      更新日志
└── LICENSE                           GPL-2.0
```

---

## 许可证

本项目采用 [GPL-2.0-only](LICENSE) 许可证。
