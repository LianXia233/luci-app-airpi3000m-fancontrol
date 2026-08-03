--[[
LuCI airpi-fancontrol - CBI Model (v3.3.0)
Part of luci-app-airpi-fancontrol
Fan driver selection: hardware PWM / software PWM, with per-mode config.
--]]

local m, section
local fs = require "nixio.fs"

m = Map("airpi-fan", translate("风扇设置"))

-- =====================================================================
--  Section: fan settings (type="fan" matches config fan 'settings')
--  Previous bug: TypedSection used "settings" instead of "fan",
--  causing "尚无任何配置" when config exists but type mismatched.
-- =====================================================================
section = m:section(TypedSection, "fan", translate("风扇驱动与参数设定"))
section.anonymous = true
section.addremove = false

-- =====================================================================
--  Tab: driver configuration
-- =====================================================================
section:tab("fanst", translate("驱动设置"))

-- =====================================================================
--  Pre-detect hardware for status display
-- =====================================================================
local function detect_hw_pwm()
    -- 16GB eMMC设备不支持硬件PWM，即使sysfs中存在pwmchip节点
    local f = io.open("/sys/block/mmcblk0/size", "r")
    if f then
        local sectors = tonumber(f:read("*a"))
        f:close()
        if sectors and sectors > 25000000 then
            return nil
        end
    end
    -- Method 1: hwmon pwm-fan
    local h = io.popen(
        "for p in /sys/class/hwmon/hwmon*/pwm1; do " ..
        "[ -w \"$p\" ] || continue; " ..
        "case \"$(cat \"${p%/*}/name\" 2>/dev/null)\" in " ..
        "pwmfan|pwm-fan) echo \"hwmon:$p\"; break;; esac; done")
    if h then
        local r = h:read("*l"); h:close()
        if r and r ~= "" then return r end
    end
    -- Method 2: sysfs pwmchip (MT7981 built-in controller)
    local h2 = io.popen("ls /sys/class/pwm/pwmchip*/npwm 2>/dev/null | head -1")
    if h2 then
        local chip = h2:read("*l"); h2:close()
        if chip and chip ~= "" then
            local name = chip:match("(pwmchip%d+)")
            if name then return "pwmchip:" .. name end
        end
    end
    return nil
end

local function has_gpio_fan_loaded()
    local h = io.popen("lsmod | grep -q '^airpi_gpio_fan' && echo yes || echo no")
    if not h then return false end
    local r = h:read("*l"); h:close()
    return r == "yes"
end

local function read_duty_cycle()
    local h = io.open("/sys/kernel/duty_cycle", "r")
    if not h then return nil end
    local v = h:read("*l"); h:close()
    return v and v:gsub("%s+$", "") or nil
end

-- 检测eMMC容量：返回人类可读的容量描述字符串
local function detect_emmc()
    local f = io.open("/sys/block/mmcblk0/size", "r")
    if not f then return "（无法检测）" end
    local sectors = tonumber(f:read("*a"))
    f:close()
    if sectors and sectors > 25000000 then
        local gb = math.floor(sectors * 512 / 1000000000 + 0.5)
        return string.format("%dGB闪存 → 仅支持软件PWM", gb)
    elseif sectors then
        local gb = math.floor(sectors * 512 / 1000000000 + 0.5)
        return string.format("%dGB闪存 → 仅支持硬件PWM", gb)
    else
        return "（无法检测）"
    end
end

local hw_detect   = detect_hw_pwm()
local soft_loaded = has_gpio_fan_loaded()
local duty_val    = read_duty_cycle()
local emmc_info   = detect_emmc()

-- =====================================================================
--  Driver status banner (always visible)
-- =====================================================================
local driver_status = section:taboption("fanst", DummyValue, "_driver_status",
    translate("当前驱动状态"))
driver_status.rawhtml = true

local status = {}
if hw_detect then
    status[#status + 1] = string.format(
        '<span style="color:green;font-weight:bold">✔ 硬件PWM可用</span> (%s)', hw_detect)
else
    status[#status + 1] = '<span style="color:orange">⚠ 未检测到硬件PWM (hwmon pwm-fan)</span>'
end

if soft_loaded then
    status[#status + 1] = '<span style="color:green;font-weight:bold">✔ 软PWM内核已加载</span>'
else
    status[#status + 1] = '<span style="color:red">✖ 软PWM内核未加载</span>'
end

if duty_val then
    status[#status + 1] = string.format('duty_cycle = <b>%s</b>', duty_val)
end

status[#status + 1] = string.format('<span style="color:#0099CC">%s</span>', emmc_info)

driver_status.value = table.concat(status, " &nbsp;|&nbsp; ")

-- =====================================================================
--  Fan driver selector
-- =====================================================================
fan_driver = section:taboption("fanst", ListValue, "fan_driver",
    translate("风扇驱动模式"),
    translate([[自动模式：优先检测硬件PWM (hwmon pwm-fan)，未检测到时回退到软件PWM。
硬件PWM：使用内核pwm-fan驱动，通过 /sys/class/hwmon/ 接口控制。
软件PWM：加载 airpi_gpio_fan.ko 内核模块，通过 /sys/kernel/duty_cycle 控制。]]))
fan_driver:value("auto",    "自动识别（推荐）")
fan_driver:value("pwm",     "硬件PWM驱动")
fan_driver:value("softpwm", "软件PWM驱动")
fan_driver.default = "auto"

-- =====================================================================
--  Hardware PWM fields (shown when fan_driver = "pwm")
-- =====================================================================

-- PWM chip detection (sysfs)
local pwm_chips = {}
local h_pwm = io.popen("ls /sys/class/pwm/pwmchip*/npwm 2>/dev/null | sed 's|/npwm||;s|.*/||'")
if h_pwm then
    for line in h_pwm:lines() do
        pwm_chips[#pwm_chips + 1] = line
    end
    h_pwm:close()
end

local hw_pwm_desc = section:taboption("fanst", DummyValue, "_hw_pwm_desc",
    translate("硬件PWM说明"))
hw_pwm_desc.rawhtml = true
hw_pwm_desc:depends("fan_driver", "pwm")
if hw_detect then
    hw_pwm_desc.value = string.format(
        [[<span style="color:green">已检测到硬件PWM接口: <b>%s</b></span>]], hw_detect)
else
    hw_pwm_desc.value = [[<span style="color:red">未检测到硬件PWM接口！请确认设备树已配置 pwm-fan 节点。</span>]]
end

-- Show current hwmon pwm-fan path if exists
local hwmon_path_display = section:taboption("fanst", DummyValue, "_hwmon_pwm_path",
    translate("PWM节点路径"))
hwmon_path_display:depends("fan_driver", "pwm")
local h_hwmon = io.popen(
    "for p in /sys/class/hwmon/hwmon*/pwm1; do " ..
    "[ -w \"$p\" ] && echo \"$p\"; break; done")
if h_hwmon then
    local p = h_hwmon:read("*l"); h_hwmon:close()
    hwmon_path_display.value = p or translate("(未找到可写pwm1节点)")
end

-- =====================================================================
--  Software PWM fields (shown when fan_driver = "softpwm")
-- =====================================================================

-- Kernel module status
local sw_kernel_status = section:taboption("fanst", DummyValue, "_sw_kernel_status",
    translate("软PWM内核模块"))
sw_kernel_status.rawhtml = true
sw_kernel_status:depends("fan_driver", "softpwm")
sw_kernel_status.value = soft_loaded
    and [[<span style="color:green;font-weight:bold">✔ airpi_gpio_fan 已加载</span>]]
    or  [[<span style="color:red;font-weight:bold">✖ airpi_gpio_fan 未加载 — 保存配置后点击下方按钮加载</span>]]

-- Duty cycle current value
local sw_duty_display = section:taboption("fanst", DummyValue, "_sw_duty_display",
    translate("当前占空比"))
sw_duty_display:depends("fan_driver", "softpwm")
sw_duty_display.value = duty_val or translate("(不可用)")

-- GPIO pin number
fan_gpio = section:taboption("fanst", Value, "fan_gpio", translate("风扇GPIO编号"),
    translate("软PWM使用的GPIO引脚编号。AP3000M 默认 GPIO 540 (gpiochip512 offset 28, 标签 airpi-fan-pwm)。"))
fan_gpio.datatype = "uinteger"
fan_gpio.default = 540
fan_gpio.placeholder = "540"
fan_gpio:depends("fan_driver", "softpwm")

-- PWM period
fan_freq = section:taboption("fanst", Value, "fan_freq", translate("PWM周期(μs)"),
    translate("PWM信号周期，单位微秒。默认15000μs≈66.7Hz。值越大低频噪音越明显但CPU占用越低。"))
fan_freq.datatype = "uinteger"
fan_freq.default = 15000
fan_freq.placeholder = "15000"
fan_freq:depends("fan_driver", "softpwm")

-- =====================================================================
--  Apply / Reload driver button
-- =====================================================================
apply_btn = section:taboption("fanst", Button, "_apply_driver",
    translate("重新加载驱动"),
    translate("保存配置后点击此按钮，根据所选驱动模式重载对应的内核模块。"))

function apply_btn.write(self, section, value)
    local uci = require "luci.model.uci".cursor()
    local driver = uci:get("airpi-fan", "settings", "fan_driver") or "auto"
    local gpio   = uci:get("airpi-fan", "settings", "fan_gpio") or "540"
    local freq   = uci:get("airpi-fan", "settings", "fan_freq") or "15000"

    if driver == "pwm" then
        -- Hardware PWM mode: stop software daemon, rely on kernel pwm-fan
        os.execute("/etc/init.d/airpi-fancontrol stop 2>/dev/null")
        os.execute("rmmod airpi_gpio_fan 2>/dev/null")
        local msg = translate("已切换到硬件PWM模式。")
        msg = msg .. "\\n" .. translate("请确认 pwm-fan 设备树节点已配置且风扇连接到正确的PWM引脚。")
        luci.http.write(string.format([[
            <script>alert("%s");history.back(-1);</script>
        ]], msg))
    else
        -- Software PWM mode: reload airpi_gpio_fan module with UCI params
        os.execute("/etc/init.d/airpi-fancontrol stop 2>/dev/null")
        os.execute("rmmod airpi_gpio_fan 2>/dev/null")

        local cmd = string.format(
            "insmod airpi-gpio-fan fangpio=%s cycle=255 period=%s fanen=1 2>&1", gpio, freq)
        local h = io.popen(cmd)
        local result = h:read("*a"); h:close()
        result = result:gsub("%s+$", "")

        -- Restart daemon
        os.execute("/etc/init.d/airpi-fancontrol start 2>/dev/null")

        if result == "" then result = translate("加载成功") end
        luci.http.write(string.format([[
            <script>alert("软PWM驱动已重新加载。\\nGPIO=%s  周期=%sμs\\n\\n%s");history.back(-1);</script>
        ]], gpio, freq, result:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n")))
    end
end

return m
