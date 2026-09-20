# 更新日志

本项目所有重要变更均记录于此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [6.0.0] - 2026-09-21

> [!NOTE]
> 本次为前端单页化改版：状态座舱、硬件总线看板与驱动参数表单合并到「状态 → 风扇控制」一页内，
> 独立的「状态 → 风扇设置」子菜单与 `settings.js` 视图一并移除。

### 新增

- **界面预览图**：新增 `docs/preview-fancontrol.png`（合并后的单页视图）；README 新增「界面预览」章节引用该截图
- **硬件 PWM 探测路径**：README 补充硬件 PWM 接口的完整探测顺序（hwmon `pwm1` → MT7981 `pwmchip*/pwm*/duty_cycle`）与 eMMC 容量不可读时的回退规则
- **温度采集细节**：补充读数有效区间 1–150 °C、模组温度单位换算规则、同名来源取最高值、Wi-Fi 仅取 `ra0`/`rax0`/`rai0` 中首个存在的接口
- **构建开关**：补充 `AIRPI_PREBUILT=1` 打包预编译 Rust 二进制的用法
- **目录结构**：补充 Rust 源码 `src/` 目录，修正 `files/usr/` 下 `bin` 与 `share` 的层级错位
- **Rust 守护进程章节**：新增 `airpi-fanctl` 专章，说明选用 Rust 的取舍（零第三方依赖、静态链接 musl、release 体积裁剪、内置单元测试）、10 个子命令的用法、`/etc/fanvall` 档位码映射、两种构建方式（SDK 交叉编译 / `AIRPI_PREBUILT` 打包，CI 采用后者以复用宿主 rustup）、本地开发命令，以及 `airpi-fanctl.sh` / `get_sys_temp.sh` 两个 shell 包装存在的 rpcd 授权原因
- **致谢**：README 新增「致谢」章节，说明本项目的源码与后续修改均基于 Manper 大佬的分享而来
- **状态座舱重构**：三列卡片式布局（风扇座舱 / 调速模式 / 温度传感），主占空比与运行模式直接由 `airpi-fanctl status` 的真实 `fanspd` 推导，4 秒轮询刷新
- **陶瓷风扇可视化**：7 叶陶瓷白 SVG 风扇，转子转速（0.24 ~ 1.40 秒 / 圈）与气流涟漪周期均由真实占空比反比驱动，停转时冻结动画而非维持空转
- **硬件拓扑与调制总线感知看板**：实时呈现 eMMC 容量规格、硬件 PWM 节点探测结果、GPIO 软中断模块加载状态，三张结论卡由 `airpi-fanctl hwdetect` 的真实输出驱动
- **实时 PWM 示波器**：按真实 `duty / 255` 生成方波（6 周期无缝滚动，脉宽 2 ~ 46px），并随轮询刷新占空比徽标

### 变更

- **kmod-airpi-gpio-fan 4.0.0：重写引脚申请路径，消除对 legacy GPIO 接口的单点依赖**
  - 此前实现虽然按内核版本在 `gpiod_*` 与整数 API 之间分支，但**始终用 `gpio_request()` 按编号占用引脚**。该接口自内核 6.17 起由新增的 `CONFIG_GPIOLIB_LEGACY` 门控，开关一旦关闭（`gpiolib-legacy.o` 不再编入内核），模块会以 `Unknown symbol gpio_request` 加载失败
  - 改为按**能力探测**而非版本号判断：`IS_ENABLED(CONFIG_GPIOLIB_LEGACY) || < 6.17` 走整数接口；6.17+ 且开关关闭时改走描述符路径 —— 用 `gpio_to_desc()` 定位所属 GPIO 控制器，经 `gpio_device_get_label()` / `gpio_device_get_base()` 换算出片内偏移，再由 `gpiod_add_lookup_table()` 绑定到驱动自带的 platform device（`platform_device_register_full()`），最后用 `gpiod_get_index()` 正式申请引脚。既不需要改设备树，也保留了 gpiolib 的引脚所有权保护
  - 移除了原实现中 `LINUX_VERSION_CODE >= KERNEL_VERSION(6,14,0)` 这一**无 API 依据的伪分界**（6.14 未变更任何 GPIO 消费者接口），并把版本相关条件编译收敛到 3 处，主逻辑零分支
  - 加载日志明确打印所走的路径与实际申请的引脚位置（控制器名 + 片内偏移），便于现场排障
- **修正占空比无法达到 100%**：原实现把时间片序号直接与占空比原值比较，255 个高电平片落在 256 片周期里，实际上限为 255/256（99.6%）。现改为把 `duty_cycle` 线性映射到固定的 256 片分辨率，写入 `cycle` 即为真正的持续高电平
- **`cycle` 参数语义自洽化**：原实现中 `PWM_TICKS` 固定为 256 而 `cycle` 可配置，二者并存时相互矛盾（例如 `cycle=100` 时仍有 155/256 的周期恒为低电平）。现在 `cycle` 只决定用户可见的值域上限，内部时间片分辨率恒为 256
- **消除定时器周期漂移**：`hrtimer_forward(timer, ktime_get(), ...)` 改为 `hrtimer_forward_now()`，以定时器自身的到期时间前推下一周期，不再把每次软中断的执行延迟累积成周期误差
- **消除并发数据竞争**：`duty_cycle_val` / `fanen` / `period` 的读取统一改为 `READ_ONCE()`、写入改为 `WRITE_ONCE()`；PWM 时间片计数器由函数内的 `static` 变量移入驱动实例结构体，为将来多风扇支持留出余地
- **`fanen` 改为带回调的参数**：由 `module_param_cb()` 接管，写 0 时立即输出低电平并 `hrtimer_cancel()` 停表（原实现是每个周期唤醒一次并持续空转），写 1 时重新起表
- **极端占空比不再占用定时器**：写入 0 或 `cycle` 时直接停表并输出恒定电平，写入中间值后自动恢复，省去无意义的中断开销
- **`fangpio` 降为只读参数**：原权限为 0644 但仅在 `init` 中读取，运行时修改无任何效果，属误导性接口
- **代码质量与错误处理**：`sysfs_emit()` 取代 `scnprintf()`；补齐初始化失败路径的资源回滚；`hrtimer` 改为单次初始化；移除 `-Wno-declaration-after-statement`（变量声明统一置于块首，恢复内核 C 风格）
- **`/sys/kernel/duty_cycle` 路径保持不变**，LuCI 前端与既有脚本无需任何改动
- **实机验证（AirPi AP3000M / ImmortalWrt SNAPSHOT / 内核 6.18.44）**：4.0.0 已完成加载、读写、卸载与资源清理的全流程实机验证
  - 描述符路径实测通过：加载日志打印 `legacy GPIO path: no`，并正确由全局编号推导出 `chip pinctrl_moore hwnum 28`（540 − 512 = 28），与 `/sys/kernel/debug/pinctrl/*/pinmux-pins` 中 `pin 28 (SPI2_MISO): GPIO pinctrl_moore:540` 完全吻合
  - legacy 路径同样实测通过：`legacy GPIO path: yes` 与 `GPIO 540 claimed through the legacy integer interface`
  - 卸载验证通过：`rmmod` 返回 0，`/sys/kernel/duty_cycle` 被移除、GPIO 被释放，`/proc/modules` 中不再出现 `[permanent]` 标记
  - **二次修正了"100% 占空比"修复自身的实现缺陷**：初版把写满占空比也交给停表路径处理，而停表固定输出低电平，导致写入 `cycle` 时风扇停转而非全速运转。现改为独立的"恒定电平"路径 —— 100% 输出持续高电平、0% 输出持续低电平，且两者都不再占用高分辨率定时器
  - 参数回调（`fanen` 写 0 立即输出低电平并停表、写 1 重新起表）、超范围写入钳制（9999 → 255）、非数字写入拒绝，均实测符合预期
- **补充编译约束说明**：实测确认产物除 vermagic 之外还须与目标内核的 `struct module` 布局一致，否则要么直接加载失败（`section size must match`），要么出现"能加载、能工作、但无法卸载"的 `[permanent]` 现象。README 增补了差异项对照表与自检命令（用 `readelf -SW/-rW` 核对 `this_module` 的段大小与重定位偏移）
- **界面合并为单页**：原「状态 → 风扇设置」整页并入「状态 → 风扇控制」，菜单仅保留 `admin/status/airpi-fancontrol` 一个入口。实现上把设置视图改为**纯对象**（不再 `view.extend` 注册框架），由主视图 `HWCfg.render.call()` 调用 —— 否则同一模块内第二个视图实例会接管主内容区，把状态座舱整片替换掉
- **驱动参数按策略条件显示**：`自动感知与适配` 下只显示调度策略与驱动热重载；选中「软件 PWM」后才展开 GPIO 编号与调制周期
- **包版本升至 6.0.0**，并在 `postinst` 中清理由 ≤ 5.x 升级上来的设备所残留的 `settings.js`

### 修正

- **调速模式名称**：README 表格中的「常速 / 全速」更正为与 `fancontrol.js` 一致的「常规 / 狂暴」
- **依赖说明**：补充遗漏的 `kmod-hwmon-pwmfan` 依赖
- **温度源路径**：此前称 CPU 固定读 `thermal_zone0`、PHY 固定读 `hwmon1`，实际为动态扫描全部 thermal zone 与 hwmon 设备（排除 `pwmfan` / `pwm-fan` / `fan`），已更正
- **停止行为**：`stop` 由笼统的「转速降到最低」更正为「硬件 PWM 降至 64，软件 PWM 写 0 停转」
- **温控区间边界**：按 `temp > 阈值` 的实际判定，将曲线表更正为 `> 85` / `> 60 且 ≤ 85` / `> 50 且 ≤ 60` / `≤ 50`
- **高亮配色**：最高温卡片高亮色由「蓝色」更正为「青色」（`--cy`，#22d3ee）
- **转速读数**：明确状态页 RPM 为按占空比换算的估算值，风扇未引出测速引脚、无真实转速反馈
- **窄屏下条件字段全部同时显示**：本文件为窄屏堆叠加的响应式规则 `.cbi-map .cbi-value { display: block !important; }`，会连同 LuCI 用于 `depends` 的 `.hidden` 一起强开 —— 表现为 `auto` 模式下硬件 PWM 与软件 PWM 两套互斥字段在窄屏同时出现（宽屏不受影响，只测宽屏无法发现）。现改为 `:not(.hidden)` 并补 `.cbi-value.hidden { display: none !important; }` 兜底
- **删除与看板重复的状态行**：表单内「硬件 PWM 挂载路径」「内核模块运行状态」两行只读状态与上方硬件看板卡片表达的是同一结论，已删除，信息统一由看板承载

### 移除

- **`tempsrc <cpu|modem>` 子命令**：该子命令把温度源标签写入 `/etc/fanvallv.conf`，但该文件从无任何代码读取。v3.6.0 起「多源取最大值」已是唯一既定策略，温度源切换开关早已从 UI 移除，此子命令与 `FANVALV_FILE` 常量一并删除。`airpi-fanctl` 的用法提示同步更新（并补上此前遗漏的 `legacy-temp` 分支）
- **UCI 选项 `fan_enable`**：自初始版本起即存在于 `/etc/config/airpi-fan` 且被 README 标注为「风扇总开关」，但全仓库无任何代码读取。作为会误导用户的占位项删除。注意：该文件是 conffile，升级时不会被覆盖，已安装设备上的残留选项无害
- 删除 `luci-app-airpi-fancontrol/README.md` 与 `luci-app-airpi-fancontrol/CHANGELOG.md`：子包内两份文档已与根目录长期不同步（子包 README 缺失界面预览与 CI 目标说明，子包 CHANGELOG 缺失整个 4.x 系列），统一以根目录文档为准。两个文件均未被 `Makefile` 的 `install` 段引用，删除不影响打包
- **独立设置视图**：`htdocs/luci-static/resources/view/airpi-fancontrol/settings.js` 与菜单节点 `admin/status/airpi-fancontrol-settings` 一并移除，其内容已并入状态页；`Makefile` 不再安装该文件。**注意**：已安装设备在升级后若仍保留该文件会被 `postinst` 删除，旧书签 `…/admin/status/airpi-fancontrol-settings` 将返回 404
- **失效预览图**：`docs/preview-fan-settings.png` 随设置页一同删除；`docs/preview-fancontrol.png` 刷新为合并后的单页截图

## [5.0.0] - 2026-08-25

### 变更

- 将 `fancts.sh`、温度采集和 LuCI 后端控制合并为无第三方 crate 依赖的 Rust 二进制 `airpi-fanctl`
- 保留 `/usr/bin/airpi-fanctl.sh` 与 `/usr/bin/get_sys_temp.sh` 兼容入口，LuCI ACL 和现有命令调用无需迁移
- 统一温度源、驱动选择和 PWM 写入逻辑，自动温控始终按可用传感器最高温度调速
- 修复手动调速与 procd 守护进程竞争及模组温度误解析问题；保留 AP3000M 专用 pwmchip 0..255 占空比接口
- 为转速、模式、GPIO、PWM 周期和驱动配置增加严格范围校验
- LuCI 包改为目标架构包，并通过 OpenWrt packages feed 的 Rust 工具链交叉编译

## [4.2.1] - 2026-08-10

### 修复

- **风扇状态页旋转扇叶不显示**：`fancontrol.js` 的 `drawFan()` 在 `render()` 末尾被直接调用，此时 canvas 尚未插入 DOM，`document.contains(canvas)` 判定为 false 后将 `animAlive` 置为 `false`，导致动画永久停止，扇叶与中心盖均无法绘制。改为通过 `requestAnimationFrame` 延迟启动绘制；`drawFan()` 在 canvas 未挂载时改为有限重试（最多 120 帧）而不是直接停止动画。
- **提升扇叶可见度（浅色主题）**：扇叶填充不透明度由 `0.65` 提升至 `0.9`；颜色随转速由青色平滑过渡到红色，与浅色背景对比更强；为扇叶增加半透明白色描边；收窄叶片弧度并让二次贝塞尔曲线终点与圆弧起点闭合相连，叶片形状更规整。中心盖阴影由纯灰改为半透明黑，避免浅色主题下发灰。

## [4.2.0] - 2026-08-09

### 新增

- **内核模块适配所有内核版本**：`airpi-gpio-fan.c` 全函数体完成 `gpio_set_value` → `gpiod_set_value` 条件分支
  - 内核 ≥6.14 使用 `gpio_to_desc()` + `gpiod_direction_output()` + `gpiod_set_value()` 描述符 API
  - 内核 <6.14 保持原有 `gpio_direction_output()` + `gpio_set_value()` 整数 API
  - 新增全局 `struct gpio_desc *fan_desc` 描述符指针（仅 `#if FAN_USE_GPIOD` 时编译）
  - `MODULE_IMPORT_NS("GPIO_LEGACY")` / `MODULE_IMPORT_NS(GPIO_LEGACY)` 兼容全部内核（5.15+ / 6.13+）
  - `hrtimer_setup()` 兼容内核 ≥6.15
- **动态传感器发现**：`get_sys_temp.sh` 和 `fancts.sh` 不再硬编码 `thermal_zone0` / `hwmon1`
  - `get_sys_temp.sh`：`find_cpu_zone()` 扫描 `/sys/class/thermal/thermal_zone*/type` 匹配 CPU zone，`find_phy_hwmon()` 扫描 `/sys/class/hwmon/hwmon*` 排除 pwmfan 型设备
  - `fancts.sh`：`collect_thermal_zones_mc()` / `collect_hwmon_mc()` 每轮循环动态枚举全部 thermal zone 和 hwmon 设备，取最高温度
  - 传感器路径首次探测后缓存，避免每轮重复遍历

### 变更

- **kmod-airpi-gpio-fan 3.4.0**：包版本号递增；全函数体完成 gpiod 描述符 API 适配，可编译运行于内核 4.14 – 6.18+

## [4.1.0] - 2026-08-07

### 变更

- **内核模块不再强制匹配内核版本**：`kmod-airpi-gpio-fan` 的 `KernelPackage` 段中显式设置 `EXTRA_DEPENDS:=`（覆盖 `include/kernel.mk` 默认注入的 `kernel (=版本~vermagic-r发布)` 硬依赖）。opkg/apk 不再因为内核版本号不同而拒绝安装，提升跨小版本固件的可用性与安装体验
- **保留 vermagic 校验**：模块仍带有 vermagic，加载时由 `kmodloader` 校验。请使用与本机内核 vermagic 一致的构建产物（CI 已用 immortalwrt master 快照 SDK 实测编译）
- **kmod-airpi-gpio-fan 3.3.0**：包版本号随此次打包策略调整递增

## [4.0.0] - 2026-08-07

### 重大变更（适配 immortalwrt master / 内核 6.18)

- **LuCI 前端由 Lua 重写为 JS**：immortalwrt master（内核 6.18.41）的 LuCI 已移除 `luci-compat` / `luci-lua-runtime`，Lua 版应用在新源码树上无法编译安装。现改为标准 client-side JS 视图（`view/airpi-fancontrol/fancontrol.js` + `settings.js`）,24.10 及更早版本同样兼容
- **删除 Lua 代码**：controller / CBI model / htm 模板全部移除，依赖从 `+luci-compat +luci-lua-runtime` 改为 `+luci-base`
- **新增 `airpi-fanctl.sh` 后端助手**：JS 前端通过 rpcd `fs.exec` 调用该脚本完成风扇控制、温度采集、驱动重载；配套 `menu.d` 菜单注册与 `rpcd/acl.d` 权限声明

### 变更

- **kmod-airpi-gpio-fan 3.2.0**：确认兼容内核 6.6 – 6.18+(`hrtimer_setup` 于 ≥6.15 启用；legacy GPIO API 在 6.18 仍可用）,C 源码无需改动
- **CI 新增 ImmortalWrt master 快照 SDK 编译目标**：每次构建都会用最新 master 内核（当前 6.18.41）实测编译 LuCI 应用与内核模块，确保持续可编译

## [3.6.0] - 2026-08-04

### 修复

- **模组温度采集失败**：`read_modem_mc()` 不再依赖 `sendat AT^CHIPTEMP?`（多数新模组的 AT 固件不支持此命令），改为通过 `ubus call modem_ctrl info` + awk 提取温度，兼容 Fibocom FM350-GL 等主流 4G/5G 模组

### 变更

- **移除温度源切换开关**：智能模式统一使用多源取最大值策略（CPU/WiFi/PHY/模组），不再提供手动切换单一温度源的 UI 控件
- **温度栏文案**：设备温度标签改为"智能温控"，动态显示当前驱动风扇的最高温度源名称
- **温度卡片**：标签 "4G模块" → "模组温度"（不区分 4G/5G）；桌面端三列一行排列；最高温卡片蓝色边框高亮

### 修复（3.5.0 延续）

- fancts.sh 主循环中模组温度采集同步切换至 ubus 方式
- 视图移除 `switchContainer` / `toggleSwitch()` / `fansvm` / `fansvc` 相关代码

## [3.5.0] - 2026-08-04

### 修复

- **开机自启**：init 脚本与 fancts.sh 的 `insmod` 改用模块名（不含路径），兼容不同内核版本的 ko 安装位置
- **智能模式失效**：移除 `echo disabled > thermal_zone0/mode`，此前该语句禁用温控子系统导致温度读数停滞
- **风扇延迟启动**：加载软PWM驱动后立即写入初始占空比 64

### 新增

- **多温度源**：fancts.sh 同时读取 CPU / WiFi / PHY / 4G模组四路温度，取最大值调速；状态页展示多路温度卡片
- **`get_sys_temp.sh -a`**：输出所有可用温度源
- **init / fancts.sh eMMC 检测**：启动和运行时同步加入 eMMC 容量守卫

### 变更

- 不再依赖 FANVALV 配置文件选择温度源，统一使用多源取最大值策略
- Controller 新增 `/admin/airpi-fan/fansttpa` 端点

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

[3.6.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.6.0
[3.5.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.5.0
[3.4.2]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.4.2
[3.4.1]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.4.1
[3.4.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.4.0
[3.3.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.3.0
[3.2.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.2.0
[3.1.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.1.0
[3.0.0]: https://github.com/LianXia233/luci-app-airpi3000m-fancontrol/releases/tag/v3.0.0
