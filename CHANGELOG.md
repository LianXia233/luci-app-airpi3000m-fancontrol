# 更新日志

本项目所有重要变更均记录于此文件，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 修复

- **ImmortalWrt master 作业永久失败（`内核配置与官方固件不一致，终止发布`）**：
  根因不是产物，而是 v7.0.3 新增的 ABI 强制门本身不可满足。逐项核对内核
  6.18.55 源码：`MODULES_TREE_LOOKUP` 是 `def_bool y`（`depends on
  PERF_EVENTS || TRACING || CFI`），`BPF_EVENTS` 是 `default y` 且无 prompt，
  `TRACING`/`TRACEPOINTS`/`EVENT_TRACING` 无 prompt、只靠 `select` 打开——
  这 5 项在内核 `syncconfig` 里必然回到 `y`，任何「写 `.config` / 钩
  `Kernel/Configure`」的手法都无效；另外 `MODULES_TREE_LOOKUP` 在 6.18 的
  `struct module` 中**没有任何字段**，所谓「-384 字节」不成立。现在移除整套
  强制机制（`tools/kernel-config-force.sh`、`tools/patch-kernel-defaults.py`、
  matrix 的 `firmware_abi_override` 轴），master 目标恢复与 24.10/25.12 相同的
  「对齐同快照 `config.buildinfo`」策略，校验门只保留可满足的覆盖层校验
- **ABI 基准改用 SDK 自带内核配置**：官方 SDK 的 `build_dir/.../linux-<ver>/`
  是按官方镜像配置编好的内核树，其 `.config` 才是该目标 ABI 的权威基准
  （`config.buildinfo` 只有 17 个 `CONFIG_KERNEL_*` 包装符号）。现在配置之前
  先备份该文件，编译后把 18 个可能影响 `struct module` 布局的符号与基准逐项
  对照，偏差以 `::warning::` 记录（多数符号不可强制，只告警不失败）；verify
  日志额外打印 `.ko` 的 `this_module` 区段大小、`__this_module` 重定位数与
  `.BTF` 段数量
- **README「差异根源」更正**：删掉错误的字节归因表，改为按 Kconfig 形态说明
  哪些符号可关、哪些不可能关；并给出与**私有内核**对齐的正确做法——从设备取
  `zcat /proc/config.gz`（或 `extract-ikconfig`）拿到真实内核配置再编模块，
  而不是照官方 buildinfo 猜符号。校准依据：官方 master SDK 内核配置里
  `FTRACE`/`TRACING`/`TRACEPOINTS`/`EVENT_TRACING`/`BPF_EVENTS`/
  `DEBUG_INFO_BTF(_MODULES)`/`MODULES_TREE_LOOKUP` 全为 `y`，即 `0x4c0`
  正是官方快照固件的布局，实机那台 `0x2c0` 的固件并非用官方配置构建

## [7.0.3] - 2026-10-28

### 修复

- **Release 的 kmod 在实机上无法加载（`.gnu.linkonce.this_module section size
  must match`）**：根因是 SDK 的 `Config.in` 为重新生成（BUILDBOT 预设），
  不保证内核符号默认值与官方镜像构建一致，导致即使 vermagic 完全相同，
  编出的 `.ko` 的 `struct module` 布局也与官方固件不同。实机取证：固件自带的
  `.ko` 与 CI 编出的 `.ko` vermagic 一致，但 `this_module` 区段为 `0x2c0`/2 个
  重定位 vs `0x4c0`/4 个重定位，差 512 字节；固件自带的官方模块 `pwm-fan.ko`
  同为 `0x2c0`。现在 CI 对每个矩阵目标下载官方发布目录的 `config.buildinfo`，
  把 `CONFIG_KERNEL_*` 段作为覆盖层写进 SDK 的 `.config`（经
  `include/kernel-defaults.mk` 合并进内核配置），内核按官方固件配置编译；
  编译后逐个符号校验内核 `.config` 与覆盖层一致，不符即使作业失败，
  不再发出加载不上的 `.ko`；构建缓存键纳入覆盖层指纹，配置一变即重编内核。
  同时安装 `dwarves`（pahole）以支持 BTF 模块构建
- **ABI 强制项（master 快照目标）**：首轮验证发现，仅对齐 `CONFIG_KERNEL_*`
  仍不够——新 .ko 的 `this_module` 依旧 0x4c0（固件 0x2c0），512 字节差值
  恰为 README 实证记录的 `DEBUG_INFO_BTF_MODULES`(64) + `EVENT_TRACING`(64) +
  `MODULES_TREE_LOOKUP`(384)。根因：master 是滚动快照，buildinfo 描述
  「今天」的 buildbot 配置（BTF 已翻为 y），而用户设备固件（2026-10-22
  快照）的 `.ko` 无 `.BTF`、这三项为 n；且其中两项是内核内部符号，不经
  `CONFIG_KERNEL_*` 包装。现在 master 目标强制 `DEBUG_INFO_BTF(_MODULES)=n`
  （覆盖层内改写）与 `MODULES_TREE_LOOKUP=n`、`EVENT_TRACING=n`（直接写入
  目标配置），verify 门同时校验强制项生效。24.10 / 25.12 为固定发布版，
  其 buildinfo 即固件真实配置，无需强制。若官方快照内核配置再变，verify
  日志中的 `this_module` 观测量会先于用户暴露偏差
- **模块加载失败的诊断**：`load_softpwm_driver` 失败时原来只记录一句
  "failed to load soft-PWM driver"。现在会识别内核日志中的
  `.gnu.linkonce.this_module` 拒绝信息，明确指出「模块与当前内核的编译配置
  不匹配」并给出处置建议（使用固件自带模块或与固件对应的 Release），
  其他错误则附带内核日志尾部
- **ImmortalWrt master 作业失败（v7.0.2 的实际根因）**：`package/libs/libffi` 的
  `Build/InstallDev` 里硬编码了

  ```make
  $(CP) $(PKG_BUILD_DIR)/$(GNU_TARGET_NAME)*/fficonfig.h $(1)/usr/include/
  ```

  libffi 3.4.7 的 `fficonfig.h` 落地位置随构建树而异，glob 一旦未命中就是
  `cp: cannot stat ...: No such file or directory`，libffi 在 *staging* 阶段失败并
  中断整个作业（日志里表现为「编译 luci-app-airpi-fancontrol」失败，真正的报错在
  `package/feeds/base/libffi`）。关闭 `ALL_KMODS` / `ucode-mod-ffi` 并不能排除它——
  libffi 仍被其它依赖边拉进闭包。
  新增 `tools/patch-libffi.py`，在编译前修补 SDK：与上游 openwrt/openwrt 的修法对齐，
  删掉硬编码 glob，改为从 `PKG_INSTALL_DIR` / `PKG_BUILD_DIR` 兜底复制，两处都没有就
  静默跳过。脚本幂等，对没有该问题的树（24.10 / 25.12、已同步上游修法的快照）不做改动
- **make 调用可能挂死**：SDK 的 `.config` 若出现新符号，OpenWrt 会拉起交互式
  `menuconfig`，在 CI 里表现为一直挂到作业超时。现在所有 make 都重定向 stdin，
  遇到这种情况直接失败并暴露错误，而不是静默空转

### 变更

- **构建提速（v7.0.2 冷构建 1h34m 的实测剖析）**：对上次成功作业逐步骤计时后发现
  耗时大头并非「编译模块」，而是三块：`package/kernel/linux` 约 33 分钟
  （`Kernel/CompileModules` 固定跑 `all modules`，`all` 会编出整个 vmlinux，
  含 filogic 目标配置的数百个 `=y` 设备驱动 + DWARF + BTF）、luci-base 依赖
  闭包与 SDK 默认包约 8 分钟、SDK/feeds/Rust 固定开销数分钟。针对性优化：
  - **裁剪目标厂商驱动**：`Kernel/CompileModules` 固定跑 `all modules`，
    `all` 会编出整个 vmlinux，filogic `config-6.x` 里的 60 项 MediaTek 厂商
    驱动（以太网/WED/NAND/时钟/pinctrl/PHY 等）全部参与编译却与 `.ko` 无关
    （符号在 insmod 时才向运行内核解析）。CI 显式 not-set 这批驱动——只按
    厂商 token（MEDIATEK/MTK/MT76/MT79/MT798/AIROHA/AN8855）匹配，
    SMP/PWM/HWMON/MODULES_TREE_LOOKUP 等会影响 struct module 布局与
    vermagic 的框架符号一律保留，`.ko` 与官方固件 ABI 不变
  - **ccache**：`CONFIG_CCACHE=y` 并缓存 `sdk/.ccache`（按周滚动、可回退）。
    master 快照升级内核版本触发重编时绝大多数对象命中，约 5–10 分钟
  - **裁剪无关默认包**：`dnsmasq`/`odhcpd`/`firewall4`/`linux-firmware`/
    `mtd-utils`/`util-linux` 等明显与本插件无关的 DEFAULT 包显式 not-set；
    若实际是真实依赖，defconfig 会重新选中，无副作用
  - **SDK 缓存键收窄**：不再随 workflow 文件变化失效，避免每次改 CI 都重新
    下载 480MB SDK
  - build 缓存键包含「覆盖层 + 裁剪后目标配置」指纹，内核配置一变即重编
- **构建缓存（编译提速）**：新增 `build-*` 缓存，保存 `build_dir/target-*` 与
  `staging_dir/target-*`（含内核编译产物）。键为「目标 + SDK 指纹 + 内核版本 +
  内核配置覆盖层指纹」，命中时直接复用内核与依赖包，只重新编译本仓库的两个包；
  未命中时退化为全量编译，行为与缓存前一致。覆盖层指纹进键且**不使用
  restore-keys 前缀回退**：官方配置一变缓存即失效并触发按新配置重编内核，
  不会恢复到按旧配置编译的内核
- **缓存时间戳对齐**：缓存恢复会把目录 mtime 写成解压时刻，比缓存里的 stamp 更新，
  make 会误判成源码变更而重编内核。恢复后只把目录（不动文件）时间戳回拨两天，
  保持 stamp 与源码的原有先后关系
- 作业增加 `timeout-minutes: 180`，避免异常挂起长期占用 runner
- 生成编译配置后打印 `ffi` 相关条目，便于下次定位同类闭包问题
- **文档**：README 与 Release 模板补充「内核模块与固件严格对应」的安装警告
  （固件已内置 `airpi_gpio_fan` 时只装 luci-app，勿覆盖固件模块）、本次
  `.ko` ABI 取证数据，以及 CI 对齐 / 校验机制的说明；误装后的恢复命令
  一并写入 Release 模板

## [7.0.2] - 2026-10-26

### 变更

- **彻底退役 lua（构建闭包层面）**：本应用实际架构为 JS（客户端视图）+ ucode（LuCI
  运行时）+ Rust（守护进程），仓库内本就不存在任何 `.lua` 文件；经核实 luci-base 在
  OpenWrt 24.10 / 25.12 / master 上均只依赖 ucode 系包。CI 不再选中 lua/liblua，
  也不再需要 v7.0.1 的"预编译 lua 依赖"步骤
- **CI 修复**：SDK 的 `Config-build.in` 默认 `ALL_KMODS=y`、`ALL_NONSHARED=y`，
  后者把全部 feed 包默认选成 `=m`，导致：
  - `liblucihttp-lua`（lua 变体）进入 lucihttp 源码包编译，而 lua 头文件未 staged，
    报 `lua.h: No such file or directory`（v7.0.0 在 25.12 / master 上的失败根因）；
  - ImmortalWrt master 上 `ucode-mod-ffi`（`DEPENDS:=+libffi`）连带 libffi 进入闭包，
    而该树 libffi 3.4.7 的 staging 存在 `aarch64-openwrt-linux*/fficonfig.h` 找不到的
    打包 bug（v7.0.1 的失败根因）。
  现在生成编译配置时显式关闭 `ALL` / `ALL_KMODS` / `ALL_NONSHARED` 及全部 lua 组件，
  并在配置生成后校验闭包中不再出现 lua 组件，违例直接失败
- **编译提速**：关闭 `ALL_KMODS` 后 `package/kernel/linux` 不再全量编译 SDK 内数千个
  无关内核模块（实测该步骤占单个作业约 118 分钟），构建闭包收敛到真实依赖后
  单目标耗时预期从约 2 小时降到 15 分钟量级

## [7.0.1] - 2026-10-25

> [!IMPORTANT]
> 7.0.0 合并后在实机目视检查中发现三处前端缺陷，均不影响后端温控与散热安全。
> 本版本是首个实际发布版本（7.0.0 的 CI 未产出 Release，见下方"发布状态"）。

### 修复

- **SVG 命名空间错误导致图形完全不渲染**：趋势图、温控曲线预览、硬件拓扑三处都用
  `E('svg', …)` 建根节点再 `innerHTML` 塞子节点。`document.createElement('svg')` 产出的是
  **HTML 命名空间**的未知元素，其子节点命名空间为 `http://www.w3.org/1999/xhtml`，
  浏览器一律不绘制 —— 表现为趋势区永久停在"正在积累采样数据"、曲线与拓扑空白。
  现统一改由 `svgFragment()` 生成：外层 div + 完整 `<svg>` 字符串，让 HTML 解析器进入
  foreign-content 分支，子节点才落到 `http://www.w3.org/2000/svg`
- **轮询可被永久卡死（两处）**：
  - `pollTick` 第一次判定容器不在文档内就 `poll.remove` 自己。主题可能在 `render()` 返回后
    才把节点挂进文档，单次误判即永久杀掉轮询。现要求连续 3 次缺失才注销，并在注销时清掉全局视图引用
  - `fetch` 收尾写成 `if (seq === this.seq) inflight = false`。一旦 `applyStatus` 抛异常或
    seq 不匹配，`inflight` 永远为 `true`，之后每次轮询都静默跳过，页面冻在 1 个采样点且无任何提示。
    现无论成败都复位 `inflight`
- **拓扑图设备返回值裸拼进标记**：`emmc_gb` / `hw_pwm` / `duty` / `driver` 改走 `esc()`
- **概览布局**：两列（`300px + 1fr`）下左列只放得下一张风扇卡、右列四张卡堆得很高，
  左下出现整块空洞（比 7.0.0 的单列更差）。改为单一 12 列栅格：告警整行，风扇卡与
  "控制链路"同行分占 4/8，温度来源 / 当前生效策略 / 趋势各占整行；同一行由
  `align-items:stretch` 拉到等高、卡体 `flex:1 1 auto` 填充。移除 `.ap-split` / `.ap-col`，
  传感器页两张卡改为面板栅格直接子元素。窄屏 ≤900px 自动塌成整行
- **`policy` 档位高亮下标映射**：后端 `policy` 自高温到低温排列（`85:255 60:192 50:128 *:64`），
  下标 0..3 对应档位 3..0；此前按同序高亮，`band=2` 时会错标成 50 ℃ 档

### 新增

- 头部「轮询 #N · 采样 #M」计数徽标：轮询是否存活一眼可判，无需猜
- 异常可见化：轮询链与同步回调中的异常经 `noteError()` 记录并显示在概览告警区，
  同时 `console.warn` 留栈 —— 不再出现"页面冻住但毫无提示"
- 从后台标签切回时立即补一次刷新，而不是等下一个轮询周期

### 测试

- jsdom 离线断言由 54 项增至 **76 项**，新增 5 项 SVG 命名空间断言与 4 项轮询存活断言
  （单次缺失不注销 / 连续 3 次才注销 / 抛错后 `inflight` 复位 / 异常被记录）
- **修正测试桩本身**：harness 的 `E()` 原先对 `svg` 做 `createElementNS` 特例，比浏览器更宽容，
  正是它让命名空间 bug 通过了当时的全部断言。去掉特例后已反向验证：
  `createElement('svg')` 路径产出的子节点命名空间为 `xhtml`（不渲染），
  `innerHTML` 路径为 `svg`（正常渲染）
- 后端未改动：`cargo test` 25 项、`clippy` 零告警、`cargo check --target aarch64-unknown-linux-musl` 通过

### 发布状态（如实记录，不含推测）

- `v7.0.0` 标签第一次 CI：三个矩阵目标全部在 **步骤 14「预编译 Rust 用户态程序」** 失败，
  原因是两处只在 Linux 目标参与编译的 `#[cfg(unix)]` 类型错误（`format` 缺 `!`、
  `UnixDatagram::send` 需 `&[u8]`）。已在 7.0.0 提交内修复，并把
  `cargo check --target aarch64-unknown-linux-musl` 加入本地常规步骤
- `v7.0.0` 标签第二次 CI：`ipk (OpenWrt 24.10.8)` **构建成功**，
  `apk (25.12)` 与 `immortalwrt-master` 两个目标失败在 **步骤「编译 luci-app-airpi-fancontrol」**——
  但失败的并不是本包，而是它的依赖 `luci-base → lucihttp`：lucihttp 的 lua 变体在
  lua 头文件尚未 staged 时就被 CMake 探测到并构建，报 `#include <lua.h>` 找不到：
  ```
  [3/6] Building C object CMakeFiles/liblucihttp-lua.dir/lib/lua.c.o
  FAILED: ... #include <lua.h> → compilation terminated
  ERROR: package/feeds/luci/lucihttp failed to build.
  ```
  两个失败目标的报错完全一致，属 SDK/feeds 侧的依赖顺序问题，与本仓库代码无关
- 该次运行的发布作业仍判为成功，于是产出了一个**只含 24.10 ipk** 的 Release
  （`v20261025115015`，含 `luci-app-airpi-fancontrol_7.0.0-r1_..._openwrt-24.10.ipk`
  与配套 kmod）。AP3000M 实机为 apk 系统，该产物无法直接安装
- **本次修复**：CI 在 `.config` 中显式选中 `CONFIG_PACKAGE_lua` / `CONFIG_PACKAGE_liblua`，
  并在编译本包前增加「预编译 lua 依赖」步骤，让 lua 的头文件先落到 staging_dir；
  预编译失败只告警不中断，最终判定仍由本包编译步骤给出
- 结论：**7.0.1 为首个期望覆盖三个目标的发布版本**；`v7.0.0` 未产出可用于实机的产物。
  `.apk` 经包管理器安装/升级/卸载的路径仍未验证

## [7.0.0] - 2026-10-25

> [!IMPORTANT]
> 本次为后端控制链路与前端界面的同步深度重构。核心目标有三:温控行为可配置且不因页面开关而中断、
> 界面不再出现硬件给不出的推算值、以及把"控制程序退出 = 停止散热"的默认行为改成正向保底。
> 所有既有子命令、UCI 段类型/段名、sysfs 路径、menu.d 与 acl.d 结构均保持不变。

### 新增:后端控制链路

- **温控曲线全面可配置**:新增 14 个 UCI 选项,把原先硬编码在守护进程里的 `85/60/50 → 255/192/128/64`
  阶梯变成 `temp_high|temp_mid|temp_low` + `duty_high|duty_mid|duty_low|duty_idle`,出厂默认值与旧硬编码逐位一致
- **降档迟滞与最小保持**:`hysteresis`(℃) 决定回落多少才允许降档,`min_hold`(秒) 限制两次降档的最小间隔;
  **升温与守护接管不受该限制**,平滑处理绝不以牺牲散热响应为代价
- **传感器失效安全**:`fail_count` 轮取不到任何有效温度后切到 `fail_duty`(默认 255 满速),
  而不是像旧版那样把"无读数"当成 0 ℃ 而落到最低档
- **临界温度守护**:`temp_crit` + `crit_guard`,在手动/无级模式下温度越界时临时接管为满速并在界面告警,
  温度回落后自动交还用户档位
- **状态快照文件** `/tmp/airpi-fan.state`:守护进程每轮原子写入(临时文件 + rename),
  新增 `airpi-fanctl snapshot` 子命令直接回读它。前端一次刷新只需要 1 个进程,不再触发 uci/iwpriv/ubus 派生
- **低频来源缓存**:Wi-Fi(`iwpriv`)与模组(`ubus call modem_ctrl`)按 `slow_interval` 低频采样并沿用上次读数,
  快采来源(CPU/PHY)每轮必读;四个来源可用 `src_cpu|src_phy|src_wifi|src_modem` 独立停用
- **日志**:`log_level`(0-3) 输出到 `/tmp/airpi-fancontrol.log`(tmpfs,不磨损 Flash)并转发 `/dev/log`,
  新增 `airpi-fanctl logs [n]` 读取尾部,避免为看日志再引入一个 rpcd 文件读取授权
- **软 PWM 参数热更新**:守护进程比对 `/sys/module/airpi_gpio_fan/parameters/{period,fangpio}`,
  仅周期变化时直接写内核参数(不停风扇);只有引脚变化才 `rmmod` + `insmod`,并在重载后立即补写保底占空比
- **单一 `uci show` 读取**:配置由每轮 4 次 `uci get` 派生进程改为 1 次 `uci -q show airpi-fan` 解析,
  非法配置项不再静默采用默认值,而是记入 `config_errors` 并在界面告警

### 新增:前端界面

- **五标签页导航**:运行概览 / 风扇控制 / 温控策略 / 传感器与监控 / 高级设置,
  切换仅做显隐(不重建表单、不触碰硬件、不重发 RPC),标签页状态记录在 URL hash,刷新后可回到原页
- **曲线预览 SVG**:温控策略页随表单编辑实时绘制阶梯曲线、阈值刻度与临界线,并对非法顺序给出阻止性提示
- **温度与占空比趋势图**:数据完全来自真实轮询历史,按快照时间戳去重,不掺任何插值或模拟点
- **深浅色主题自适应**:渲染时按页面实际背景亮度判定 `data-ap-theme`,并同时提供
  `prefers-color-scheme` 回退,不再写死浅色变量
- **配置导入/导出/恢复出厂**:导入只接受本项目已知且范围合法的配置项,非法行逐条列出并跳过

### 变更

- **守护进程不再因手动/无级模式退出**:旧版 `fanvall` 为 0-3 时 `run_daemon()` 写完一次占空比就 `return`,
  导致 procd 反复拉起直到放弃。现改为常驻运行,持续采样、持续上报、持续待命守护,只在策略上尊重用户档位
- **手动/无级切换不再停服务**:旧版 `set`/`stepless` 先执行 `/etc/init.d/... stop`(软 PWM 被写 0)再写目标值。
  现只写模式与占空比,并在服务缺席时补一次 `start`,切换过程风扇驱动信号不中断
- **`reload` 语义轻量化**:守护进程每轮自读配置,`airpi-fanctl reload` 对运行中的服务不再 restart;
  `procd_add_reload_trigger` 与 UCI 文件路径保持不变
- **停止服务保留散热**:`stop_service()` 由 `echo 0 > /sys/kernel/duty_cycle` 改为写入 `stop_duty`(默认 64),
  该值本就是旧版守护进程的空闲档位,已在实机长期使用
- **procd 重试策略**:`respawn 3600 1 5` → `respawn 3600 5 0`(不限次数),避免反复崩溃后散热控制被永久放弃
- **状态协议机器可读化**:`airpi-fanctl status` 的 `mode=` 由中文(`智能`/`手动`/`无极`)改为
  `auto`/`manual`/`stepless`,原中文值继续以 `mode_cn=` 提供。**这是本项目唯一的对外不兼容点**:
  若有外部脚本按中文匹配 `mode=`,需改为匹配 `mode=`(机器码)或 `mode_cn=`
- **界面不再显示推算遥测**:移除"估算转速 / 声学噪声 / 有效风压"三张卡片与档位按钮上的 RPM 标注。
  AP3000M 无 tach 测速引脚,这些数值是公式产物而非实测;界面改为并列展示**设定占空比**与**接口实测回读**
- **轮询开销**:旧版每次刷新 4 个 RPC(status/temp/temps/hwdetect)+ 每 8 秒 4 次 `uci` 派生;
  新版每 5 秒 1 个 `snapshot`(命中状态文件时零派生),硬件探测仅在高级设置页可见时按需刷新
- **移除常驻动画引擎**:删除逐帧 `requestAnimationFrame` 波形滚动与"占空比随机漂移"装饰;
  风扇转子改由 CSS 动画按真实占空比调速,离开概览页即暂停

### 修复

- **无极模式重启后失效**:`fanvall=999` 未在守护进程主循环中被识别处理,服务重启后会用自动曲线覆盖用户的无级设定
- **只读根文件系统导致控制进程退出**:`/usr/bin/fanspeed.conf` 镜像写入失败经 `?` 直接冒泡,
  守护进程随即退出并被 procd 放弃;现降级为记录错误但不影响控制
- **前后端状态解释不一致**:前端曾通过比较本地化字符串 `mode === '智能'` 判断模式,语言切换即失效
- **滑块拖动即写硬件**:旧版 150ms 防抖把每次拖动变成一次 `stepless`(内部先 stop 服务再写占空比);
  现拖动只更新预览,需显式点击"应用到风扇"
- **轮询与动画监听器泄漏**:旧版在异步渲染的配置面板里再次 `poll.add` 且 rAF 循环无终止条件,站内导航后仍在后台跑;
  现统一为单一轮询回调,容器脱离文档时自行 `poll.remove`
- **未定义 CSS 变量**:`--gf-text-title` 被引用但从未定义;新界面变量定义完整
- **深色模式**:旧界面主区域只有浅色令牌,深色主题下卡片仍为白色半透明

### 兼容性

- 保留 `daemon|status|temp|temps|legacy-temp|set|auto|stepless|hwdetect|reload` 全部子命令与参数顺序
- 保留 `airpi-fanctl.sh`、`get_sys_temp.sh` 两个 rpcd 授权入口脚本及其输出格式
- 保留 UCI 段类型 `fan` / 段名 `settings`、`/etc/fanvall`、`/usr/bin/fanspeed.conf`、
  `/sys/kernel/duty_cycle`、`/sys/class/hwmon/*/pwm1` 全部路径语义
- 升级设备的旧配置文件不含新选项,由守护进程按 `Config::default()` 补齐,默认行为与旧版逐位一致

### 评审修正（PR #4 / Codex）

- **软 PWM 周期下限对齐驱动契约**：新增的"热更新 `/sys/module/airpi_gpio_fan/parameters/period`"
  绕过了模块加载期的 `period >= 256` 检查。驱动按 256 个最小 1 μs 的时间片调度，
  写入 100 μs 会让定时器以约 1 MHz 触发并可能占满 CPU。配置校验下限由 100 收紧到 256，
  前端 `datatype`/导入校验与默认配置注释同步
- **用户显式降档不再被最小保持时间顶回**：`min_hold` 原对三种模式一律生效，
  自动升档后立刻选低档时，守护进程会把旧档位重新写回接口长达 30 秒。
  现只对自动曲线的降档平滑，手动/无级的目标立即生效
- **临时接管不回写 `fanspeed.conf`**：临界守护与传感器失效兜底会覆盖该镜像文件，
  而无级模式把它当作"用户目标值"读回 —— 条件消失后风扇停在接管档位而不是回到滑块设定。
  现区分"用户请求"与"临时输出"，仅前者写镜像
- **`#[cfg(unix)]` 日志分支编译失败**：`format` 缺少 `!`、`UnixDatagram::send` 传入 `String` 而非 `&[u8]`。
  两段代码只在 Linux 目标上参与编译，Windows 宿主机上的 `cargo test`/`clippy` 都覆盖不到，
  是 CI 交叉编译暴露的。本地已加入 `cargo check --target aarch64-unknown-linux-musl` 作为常规步骤

### 实机反馈修正（第二轮）

- **温度来源按芯片归类**：hwmon 芯片名 `mt79xx`/`mt76xx` 归入 Wi-Fi 射频，`cpu_thermal` 归入 CPU，
  `mdio_bus:*` 等留在网络 PHY，`pwmfan`/`pwm-fan` 不再被当作温度来源。此前 Wi-Fi 只查 `iwpriv`
  （本机不存在，恒不可用），而真正可用的 `mt7915_phy*` 温度被混在 `phy` 桶里
- **原始读数一律显示**：新增 `<src>_valid` 字段，概览卡片与传感器表都显示原始值并标注
  "读数异常，不参与仲裁"；CPU 与 Wi-Fi 射频无论是否异常都必须列出。仲裁仍只取有效来源最大值，
  控制语义不变。接口缺失（`—`）与读到 0 ℃ 明确区分
- **Wi-Fi 归为快采源**：板载 mt79xx hwmon 可用时不再每轮 fork `iwpriv`，仅回退路径走低频缓存
- **修复视图遮挡主题导航**：主题 `header` 为 `position:sticky; z-index:40`（移动端遮罩 60、
  菜单展开时 70），本视图卡片上的 `backdrop-filter` 会创建合成层与层叠上下文，
  在这类组合下把 OpenWrt 自带导航压在下面。现移除两处 `backdrop-filter`，
  并给 `.ap-root` 显式设定 `position:relative; z-index:0; isolation:isolate`
  把整页钉在主题导航之下；半透明底色保留，同时省掉模糊的 GPU 开销

- 概览页布局与 `policy` 档位下标映射的修正见 [7.0.1](#701--2026-10-25)：
  首次尝试（策略卡提升为整行 + 面板统一 gap）实际留下了更大的左列空洞，已在 7.0.1 改为 12 列栅格

### 验证状态

- 后端:`cargo test` 25 项单元测试通过(曲线默认值、范围校验、阈值顺序、迟滞降档、
  最小保持、失效安全升级、守护接管与交还、无级档位保持与恢复、用户显式降档即时生效、
  PWM 周期 256 μs 下限、legacy 档位码映射、uci show 解析、模组温度解析);
  `cargo clippy --all-targets` 无告警;`cargo check --target aarch64-unknown-linux-musl` 通过
  (覆盖 `#[cfg(unix)]` 的 `/dev/log` 分支,宿主机编译不到这段)
- 前端:jsdom 离线冒烟 50 项断言通过(渲染链、标签页切换不触发硬件写入、轮询去重与自注销、
  控制命令互斥与反馈、导入导出校验、异常分支);其中 `String.prototype.format` 直接取自 LuCI 上游 `cbi.js`,
  插值行为与设备一致
- **实机验证（AirPi AP3000M 16GB / ImmortalWrt SNAPSHOT / 内核 6.18.55 / LuCI 26.295 / apk）**
  以文件替换方式安装新二进制、init 脚本与前端（原文件已备份，配置保持 6.x 三项不变以验证升级兼容）：

  | 验证项 | 实测结果 |
  | --- | --- |
  | 只读探测 | eMMC 30535680 扇区 → 判定 16GB 走软 PWM；`airpi_gpio_fan` Live、`duty_cycle=192`；无任何 `fan*_input`，确认无 tach 反馈 |
  | 温度聚合修正 | 实机 `phy` 桶含交换 PHY(42℃) 与两颗 mt7915(66~68℃)；修正后 `temps` 报 `phy=68`，与旧版一致；修正前会误报 42℃ |
  | CPU 温度异常 | `thermal_zone0` 报 -12712 等负值，被 1~150℃ 有效性区间丢弃，快照以 `cpu_mc=-1` + 原因如实上报，不参与仲裁 |
  | 停止服务保底 | `stop` 后 `duty_cycle` 由旧版的 0 变为 64，`start` 后 3 秒内回到 192，风扇全程未停转 |
  | 手动/无级常驻 | `set 255 3` 后 10 秒 duty 仍 255 且 `daemon=1`（旧版此时守护进程已退出） |
  | 显式降档即时 | `set 64 0` 后 1 秒 duty=64，10 秒后仍 64，未被 `min_hold` 顶回 |
  | 无级扛过重启 | `stepless 170` 后 `restart`，duty 仍 170（旧版会被自动曲线覆盖为 192） |
  | 温控守护 | 阈值改为 60/62 后实测 68℃ 触发：duty→255、`alarm=thermal`、`guarded=1`，而 `fanspeed.conf` 保持 170 |
  | 守护交还 | 阈值恢复 85/95 后 duty 自动回到 170，未卡在满速 |
  | 曲线热更新 | 修改 `temp_*` 后未重启服务，下一个 8 秒周期 `policy` 即反映新值 |
  | PWM 下限拦截 | `uci set fan_freq=100` → `config_errors` 明确报 256..=1000000，内核 `parameters/period` 仍为 15000（未被危险热写） |
  | 失效安全 | 停用全部来源后 `misses=4` → duty=255、`alarm=sensor`；旧版此处会落到最低档 |
  | RPC 成本 | 30 次刷新：新版 `snapshot` 合计 0.08s，旧版 `status+temp+temps+hwdetect` 合计 0.75s（约 9.4×） |
  | CLI 兼容 | `legacy-temp -c/-s/-a`、`get_sys_temp.sh -c`、`hwdetect`、`status` 输出逐项比对，除 `mode=` 改为机器码外保持一致 |
  | 前端下发 | `GET /luci-static/resources/view/airpi-fancontrol/fancontrol.js` → 200、与本地源文件逐字节一致，含五个标签页文案 |
  | 来源归类（第二轮） | `temps` 现输出 `phy=42 wifi=66`；`legacy-temp -c`=66、`-s`="66000 wifi"、`get_sys_temp.sh -c`=66，控制基准与修改前一致，散热无回退 |
  | 越界值显示（第二轮） | 快照 `cpu_mc=-12408`、`cpu_valid=0`、`cpu_err=原始读数 -12.4℃ 越界，不参与仲裁`；`wifi_valid=1`、`temp_source=wifi`；`duty_cycle` 全程 192 未变 |

- **尚未验证**：浏览器内的交互验证（登录后的页面渲染、TAB 切换与保存动作，需要人工登录会话）；
  CI 产出的 `.apk` 安装/升级/卸载路径（本次验证为文件替换）；整机重启后的开机自启（涉及路由网络中断，未执行）。

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
