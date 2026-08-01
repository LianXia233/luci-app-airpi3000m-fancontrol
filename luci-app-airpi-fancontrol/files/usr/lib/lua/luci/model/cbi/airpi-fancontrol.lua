--[[
LuCI airpi-fancontrol - CBI Model (v3.0.0)
Part of luci-app-airpi-fancontrol
Fan driver selection, GPIO/frequency configuration for soft-PWM.
--]]

local m, section

m = Map("airpi-fan", translate("风扇设置"))

section = m:section(TypedSection, "settings", translate("风扇驱动与参数设定"))
section.anonymous = true
section.addremove = false
section:tab("fanst", translate("风扇设置"),
    translate("模拟PWM参数使用说明：输入需要的模拟参数，点击保存应用后，再点击-重新应用新的参数-按钮生效新的设置。"))

-- ---- Fan driver selection ----
fan_driver = section:taboption("fanst", ListValue, "fan_driver", translate("风扇驱动"),
    translate("AIRPI-AP3000M风扇说明：早期EMMC-16G版本请选择模拟PWM驱动，8G-EMMC版本选硬件PWM驱动。"))
fan_driver:value("pwm",     "使用PWM驱动")
fan_driver:value("softpwm", "使用软PWM模拟驱动")
fan_driver.default = "softpwm"

-- ---- Soft-PWM kernel status indicator ----
local fan_kernel_status = section:taboption("fanst", DummyValue, "_fan_kernel_status",
    translate("模拟PWM内核状态"))
fan_kernel_status.rawhtml = true
fan_kernel_status:depends("fan_driver", "softpwm")

local handle_fan = io.popen("lsmod | grep -E 'Airpi[_-]gpio[_-]fan'")
local fan_result = handle_fan:read("*a"); handle_fan:close()

if fan_result ~= "" then
    fan_kernel_status.value = [[<span style="color: green; font-weight: bold;">✔ 模拟PWM内核运行中</span>]]
else
    fan_kernel_status.value = [[<span style="color: red; font-weight: bold;">✖ 模拟PWM内核未加载</span>]]
end

-- ---- Soft-PWM GPIO pin ----
fan_gpio = section:taboption("fanst", Value, "fan_gpio", translate("风扇GPIO"))
fan_gpio.datatype = "uinteger"
fan_gpio.default = 540
fan_gpio:depends("fan_driver", "softpwm")

-- ---- Soft-PWM period (microseconds) ----
fan_freq = section:taboption("fanst", Value, "fan_freq", translate("模拟PWM周期(μs)"))
fan_freq.datatype = "uinteger"
fan_freq.default = 15000
fan_freq:depends("fan_driver", "softpwm")

-- ---- Reload soft-PWM driver button ----
unload_btn = section:taboption("fanst", Button, "_unload_softpwm",
    translate("重新应用新的参数"),
    translate("使用说明：输入需要的模拟参数，点击保存应用后，再点击-重新应用新的参数-按钮生效新的设置。"))
unload_btn.inputstyle = "remove"
unload_btn:depends("fan_driver", "softpwm")

function unload_btn.write(self, section, value)
    os.execute("rmmod airpi_gpio_fan 2>/dev/null")
    luci.http.write([[
        <script>alert("已重新应用PWM模拟驱动,频率设定越大越容易啸叫，越小CPU占用越高！");history.back(-1);</script>
    ]])
end

return m
