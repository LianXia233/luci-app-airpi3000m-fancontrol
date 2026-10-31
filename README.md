<div align="center">

# 🌀 luci-app-airpi3000m-fancontrol

**专为 Airpi AP3000M 5G CPE 量身打造的现代风扇温控管理系统 · LuCI 原生 JS 架构 + Rust 高性能常驻守护**

[![编译与发布](https://img.shields.io/github/actions/workflow/status/LianXia233/luci-app-airpi3000m-fancontrol/build.yml?branch=main&label=CI%20Build&style=flat-square&logo=githubactions&logoColor=white)](https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/actions/workflows/build.yml)
[![平台架构](https://img.shields.io/badge/Target-MediaTek%20Filogic%20MT7981B-FF6B35?style=flat-square)](#-一-硬件规格与设备拓扑)
[![内核支持](https://img.shields.io/badge/Kernel-Linux%206.6%20~%206.18+-brightgreen?style=flat-square)](#-六-深度技术解析与避坑指南)
[![前端技术](https://img.shields.io/badge/LuCI-Native%20JS%20(No%20Compat)-purple?style=flat-square)](#-四-五大现代化标签页架构)
[![核心守护](https://img.shields.io/badge/Daemon-Rust%20(Static%20musl)-DEA584?style=flat-square&logo=rust&logoColor=white)](#-五-rust-温控守护进程-airpi-fanctl)
[![许可证](https://img.shields.io/badge/License-GPL--2.0-blue.svg?style=flat-square)](LICENSE)

<p align="center">
  <b>8G / 16G eMMC 闪存驱动自适应识别 · 集成硬件 PWM 与 GPIO 软中断 PWM 双驱动链路</b><br>
  四温区动态仲裁 · 4 档智能曲线与无级调速 · 零依赖 Rust 常驻守护 · 软硬件三层散热安全兜底
</p>

</div>

---

> [!CAUTION]
> **专机专用硬件重要提示**：
> 本插件专为 **Airpi AP3000M 5G CPE**（设备树标识：`airpi,ap3000m`）深度定制开发。底层 GPIO 编号（GPIO 540）、硬件 PWM sysfs 节点与四温区硬件传感器链路均严格匹配该机型，**严禁安装至其他非同构硬件设备**。

---

## 📸 界面预览

<div align="center">
  <img src="docs/preview-fancontrol.png" alt="Airpi AP3000M 散热控制台预览" width="880" style="max-width: 100%; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.15);" />
  <p><sub>图 1：Airpi AP3000M 风扇温控控制台（展示动态转子动画、设定与实测回读并列、四温区热源监视与实时走势图）</sub></p>
</div>

- **全状态同屏座舱**：设定占空比与接口实测回读并列展示，拒绝虚假转速估算；
- **原生单轮询架构**：全页面仅挂载单一轮询回调，离开页面或切入浏览器后台自动销毁，零多余资源开销；
- **深浅色自适应**：自动探测当前 LuCI 主题底色明暗，遵循 `prefers-reduced-motion` 动效偏好，移动端 ≤640px 自动切为单列自适应布局。

---

## 🌟 核心特性亮点

| 特性维度 | 说明与设计规范 |
|:---|:---|
| 🧠 **闪存驱动自适应识别** | 启动期自动读取 eMMC 容量进行驱动决策（`16GB` $\rightarrow$ 软件 GPIO 软中断 PWM；`8GB` $\rightarrow$ 硬件 PWM）；支持 WebUI 界面手动强制覆盖。 |
| 🦀 **Rust 高性能常驻守护** | 核心调度由静态链接的纯 Rust 二进制程序 `/usr/bin/airpi-fanctl` 承载，零第三方依赖；在**所有模式（含手动与无级）下全天候常驻**，持续采样、持续上报，杜绝频繁拉起退出。 |
| 🌡️ **四路温区动态仲裁** | 全景采集 **CPU 核心、以太网 PHY、Wi-Fi 射频芯片与 5G 蜂窝模组** 四路温度，自动选取最高温区驱动阶梯占空比；各路异常独立隔离，不合格读数如实展示但绝不混入调速。 |
| 📈 **温控阶梯完全可配** | `85/60/50 ℃ → 255/192/128/64` 预设阶梯阈值与占空比全量开放为 UCI 选项，支持启停助推、降档迟滞（Hysteresis）与最小保持时间防抖。 |
| 🛡️ **软硬件三层散热兜底** | ① 传感器连续失效进入 `fail_duty` 满速保护；② 手动/无级档位超温由守护进程临时强行接管降温；③ 服务停止时保留 `stop_duty` 保底风力而非归零停转。 |
| 🎛️ **丰富调速档位与无级滑块** | 支持静音 (25%)、巡航 (50%)、强冷 (75%)、全速 (100%) 四档快捷预设与 0~255 自由无级调速，设定值与接口实测并列显示。 |
| 🧭 **5 标签页现代架构 (v7.0+)** | 彻底剥离过时的 `luci-compat`，采用原生 Client-Side JS 架构；标签页切换不重建表单、不重复下发指令，URL Hash 保持刷新记忆。 |

---

## 🖥️ 一、 硬件规格与设备拓扑

| 硬件规格项 | 详细技术参数 |
|:---|:---|
| **适配设备** | Airpi AP3000M 5G 蜂窝无线路由器 / CPE |
| **主控芯片** | 联发科 MediaTek Filogic MT7981B（双核 ARM Cortex-A53 @ 1.3GHz） |
| **目标架构与包格式** | `mediatek/filogic` · `aarch64_cortex-a53` |
| **内存与闪存** | 1GB DDR4 · 8GB 或 16GB eMMC 闪存 |
| **散热硬件特性** | 主动 PWM 可控静音散热风扇（主板无独立 Tach 测速引脚） |
| **设备树标识** | `airpi,ap3000m`（主线 OpenWrt 25.12+ 原生支持） |

### 驱动决策与硬件链路

AP3000M 存在两款硬件版本，默认在「自动识别」模式下读取 `/sys/block/mmcblk0/size` 进行自适应配置：

```mermaid
graph TD
    A[启动服务 / 驱动检测] --> B{读取 eMMC 容量}
    B -- 容量匹配 16GB --> C[选用 软件 GPIO PWM 驱动]
    B -- 容量匹配 8GB --> D[选用 硬件 PWM 驱动]
    B -- 闪存容量无法识别 --> E{硬件接口探测}
    E -- 存在可用 hwmon / pwmchip --> D
    E -- 无可用硬件 PWM 节点 --> C
    C --> F[加载 kmod-airpi-gpio-fan 内核模块 (GPIO 540)]
    D --> G[绑定内核原生 pwm-fan hwmon 接口]

    classDef auto fill:#EAECEE,stroke:#5D6D7E,stroke-width:2px,color:#1B2631;
    classDef soft fill:#E8F8F5,stroke:#1ABC9C,stroke-width:2px,color:#0E6251;
    classDef hard fill:#FEFDE8,stroke:#F1C40F,stroke-width:2px,color:#7D6608;

    class A,B,E auto;
    class C,F soft;
    class D,G hard;
```

---

## ⚡ 二、 快速安装

前往 [GitHub Releases](https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases) 下载对应固件版本的安装包：

> [!WARNING]
> **内核模块对应关系与安装建议**：
> `kmod-airpi-gpio-fan` 是原生内核驱动模块，必须与目标固件的内核编译配置完全对齐才能正常挂载。
> - **如果使用的是本仓库 Release 匹配的官方 OpenWrt 镜像**：主包与 kmod 一同安装；
> - **如果使用的厂商/第三方定制固件已经内置了该驱动**（执行 `lsmod | grep airpi_gpio_fan` 有输出）：**只需安装 `luci-app-airpi-fancontrol` 主包即可，请勿覆盖安装 Release 的 kmod**，避免内核符号签名或 `struct module` 结构体大小不一致导致模块被拒加载。

### 方式 A：apk 系统 (OpenWrt 25.12+ / ImmortalWrt 快照)

```sh
# 安装应用主包与内核模块
apk add --allow-untrusted ./luci-app-airpi-fancontrol-*.apk ./kmod-airpi-gpio-fan-*.apk

# 清理缓存并平滑重载服务
rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache/
/etc/init.d/rpcd reload
```

### 方式 B：opkg 系统 (OpenWrt 24.10.x 及更早)

```sh
# 安装应用主包与内核模块
opkg install ./luci-app-airpi-fancontrol_*.ipk ./kmod-airpi-gpio-fan_*.ipk

# 清理缓存并平滑重载服务
rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache/
/etc/init.d/rpcd reload
```

安装完成后刷新浏览器，进入侧边栏：**状态** → **风扇控制** 即可进入控制中心。

---

## 🌡️ 三、 智能温控曲线与多源仲裁

温控守护进程默认每 **8 秒**（`auto_interval`，可在 2–300 秒范围内自由调节）轮询全量温度源，**自动选取其中的最高温区作为调速依据**：

### 1. 默认调速阶梯规范

| 判定条件（最高温度 $T$） | PWM 占空比 | 输出比例 | 档位定义 | 运行状态与特征 |
|:---|:---:|:---:|:---:|:---|
| **$T > 85^\circ\text{C}$** | `255 / 255` | 100% | **全速** | 极限高负载全力排热，启动紧急散热保护 |
| **$60^\circ\text{C} < T \le 85^\circ\text{C}$** | `192 / 255` | 75% | **强冷** | 模组或 Wi-Fi 高吞吐下载场景 |
| **$50^\circ\text{C} < T \le 60^\circ\text{C}$** | `128 / 255` | 50% | **巡航** | 日常轻中度网络负载，兼顾静音与风量 |
| **$T \le 50^\circ\text{C}$** | `64 / 255` | 25% | **静音** | 待机或夜间低负载，超低静音平稳运转 |

> **升档极速响应，降档迟滞保护**：当温度上升越过阈值时立即升档生效；当温度回落时，必须同时满足**降档迟滞**（低于阈值减去 `hysteresis`，默认 2℃）与**最小保持时间**（距上次调速不少于 `min_hold`，默认 30 秒），彻底杜绝转速频繁抖动。

### 2. 四路温度探测机制

| 温区来源 | 底层采集通道 | 过滤校验与降级说明 |
|:---|:---|:---|
| **CPU 核心** | `/sys/class/thermal/thermal_zone*/temp` 及 CPU hwmon 节点 | 仅落在 $1 \sim 150^\circ\text{C}$ 区间的读数有效，异常负值如实展示但排除出仲裁 |
| **Wi-Fi 射频** | 优先 `mt79xx`/`mt76xx` hwmon 的 `temp1_input`；回退 `iwpriv` | 优先无进程派生的 sysfs 读数，回退路径按 `slow_interval` 低频采样 |
| **网络 PHY** | 交换机芯片或 MDIO 总线 hwmon（如 `mdio_bus:*`） | 跨芯片取最高温，避免首个命中低估局部积热 |
| **5G 模组** | `ubus call modem_ctrl info` 提取基带温度 | 毫摄氏度与摄氏度自动换算归一化 |

---

## 🖥️ 四、 五大现代化标签页架构

页面入口位于：**状态 → 风扇控制**（`admin/status/airpi-fancontrol`），内部收敛为五大 Tab 标签：

| 标签页 | 核心展示与控制内容 | 数据流与机制 |
|:---|:---|:---|
| 📊 **运行概览** | 拟物风扇动态转子、设定与实测回读、控制链路状态、生效曲线档位、温度来源看板、实时走势折线图。 | `snapshot` 快照接口，5 秒低开销轮询 |
| 🎛️ **风扇控制** | 智能温控模式切换、4 档固定快捷预设（静音/巡航/强冷/全速）、0~255 无级调速滑块、退出自动确认弹窗。 | 直连 `set` / `auto` / `stepless` 调度命令 |
| 📈 **温控策略** | 3 段温度阈值与 4 档占空比自由编辑、控制周期、降档迟滞与保持时间；随手编辑实时重绘阶梯曲线。 | 对接 UCI `airpi-fan` 配置文件 |
| 🌡️ **传感器与监控** | 四路来源实测值、采样时效、不可用原因与底层路径；提供独立热源开关与低频采样周期调节。 | 结构化时效展示，明确标注无 tach 硬件限制 |
| 🛠️ **高级设置** | 驱动模式（自动/软PWM/硬PWM）、GPIO 编号与模拟周期设定、安全兜底参数调优、内核日志检索与配置导入导出。 | `hwdetect` 硬件自检与故障诊断 |

---

## 🦀 五、 Rust 温控守护进程 (`airpi-fanctl`)

核心调度程序位于 `/usr/bin/airpi-fanctl`，提供全功能 CLI 调试指令集：

```sh
airpi-fanctl daemon              # 温控守护前台主循环 (procd 常驻托管，任何模式均不退出)
airpi-fanctl snapshot            # 一次性读出前端所需完整状态快照 (秒级，零多余派生)
airpi-fanctl status              # 查看转速、档位码、生效驱动与运行状态
airpi-fanctl temp                # 输出当前最高温度与对应热源标识
airpi-fanctl temps               # 列出当前所有可用的温度源与实时读数
airpi-fanctl set <0-255> <0-3>   # 切换至固定档位并设定占空比 (服务常驻待命，不再暴力 stop)
airpi-fanctl auto                # 一键切回智能温控模式 (下一轮直接生效，无需重启服务)
airpi-fanctl stepless <0-255>    # 设定任意数值的无级占空比
airpi-fanctl hwdetect            # 打印 eMMC 大小、软硬件驱动与 PWM 接口底层检测全景
airpi-fanctl logs [n]            # 检索温控日志尾部 n 行 (默认 80 行)
airpi-fanctl reload              # 热重载配置 (运行中下一周期自动读取，未运行时自动拉起)
```

---

## ⚙️ 六、 深度技术解析与避坑指南

自 v4.0 起，`kmod-airpi-gpio-fan` 内核驱动采用**源码级接口自适应**：
1. **GPIO 申请接口自适应**：Linux 6.17+ 关闭 `CONFIG_GPIOLIB_LEGACY` 后，驱动自动由 `gpio_request` 整数路径切为描述符查找表路径（`gpiod_add_lookup_table`），无需改动设备树；
2. **高精度定时器**：针对内核 6.15+ 移除 `hrtimer_init` 的改动，代码通过预编译宏平滑兼容 `hrtimer_setup`。

### 为什么同一内核版本也会发生模块加载拒绝？

在 Linux 6.18+ 上排查发现，即使 `vermagic` 完全一致，内核仍可能拒绝加载模块并报错：
```text
.gnu.linkonce.this_module section size must match the kernel's built struct module size at run time
```

> **根因剖析**：`.gnu.linkonce.this_module` 区段本质上是内核 `struct module` 的实例化。其具体结构体大小由内核编译时的 Kconfig 选项（如 `CONFIG_EVENT_TRACING`、`CONFIG_DEBUG_INFO_BTF_MODULES` 等）决定。**同一份源码、同一个 vermagic，只要内核编译配置宏稍有不同，结构体尺寸便会相差数百字节**。因此，自建固件用户推荐直接将源码放入源码树一同编译打包，避免后期跨环境替换模块。

---

## 📂 仓库项目架构

```text
luci-app-airpi3000m-fancontrol/
├── .github/workflows/          # GitHub Actions 自动化构建
├── airpi-gpio-fan/             # 软 PWM 内核驱动源码 (kmod-airpi-gpio-fan)
│   ├── src/airpi-gpio-fan.c    # 高精度软中断 PWM 驱动实现
│   └── Makefile                # 内核模块编译规则
├── luci-app-airpi-fancontrol/  # LuCI 现代前端与配置工程
│   ├── files/etc/config/       # 默认 UCI 配置文件 (airpi-fan)
│   ├── files/etc/init.d/       # procd 服务脚本
│   ├── htdocs/resources/view/  # LuCI 原生 JS 前端视图
│   ├── src/                    # 核心 Rust 守护进程源码 (airpi-fanctl)
│   └── Makefile                # 顶层应用包编译定义
├── tools/                      # 硬件探测与开发辅助脚本
└── README.md                   # 说明文档
```

---

## 💖 致敬与鸣谢

* 👤 **[LianXia233](https://github.com/LianXia233)** — 主导完成 v4.0+ 原生 JS 架构重构、Rust 静态零依赖守护进程、闪存识别与多温区仲裁系统
* 🐧 **[OpenWrt](https://openwrt.org/)** / **[ImmortalWrt](https://immortalwrt.org/)** — 开放强大的路由系统生态与 Filogic 平台支持

---

> 📜 **开源许可**：本项目基于 [GNU General Public License v2.0 (GPL-2.0)](LICENSE) 协议发布。
