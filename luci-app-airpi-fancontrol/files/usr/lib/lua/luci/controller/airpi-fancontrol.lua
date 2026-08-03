--[[
LuCI airpi-fancontrol - Controller (v3.3.0)
Part of luci-app-airpi-fancontrol
Provides REST API endpoints for fan speed control and status polling.
Supports hardware PWM (hwmon pwm-fan / sysfs pwmchip) and software PWM
(airpi_gpio_fan.ko + /sys/kernel/duty_cycle) dual-mode fan control.
--]]

module("luci.controller.airpi-fancontrol", package.seeall)

local http  = require "luci.http"
local json  = require "luci.jsonc"
local nixio = require "nixio"
local fs    = require "nixio.fs"
local uci   = require "luci.model.uci".cursor()

local DUTY_PATH  = "/sys/kernel/duty_cycle"
local SPEED_CONF = "/usr/bin/fanspeed.conf"
local FANVAL     = "/etc/fanvall"
local FANVALV    = "/etc/fanvallv.conf"

-- =====================================================================
--  Helper: find the AP3000M hardware PWM interface
--  Priority: hwmon pwm-fan > sysfs pwmchip (MT7981 built-in)
-- =====================================================================
local function find_pwm_path()
    -- Method 1: hwmon pwm-fan (standard kernel pwm-fan driver)
    local handle = io.popen("for p in /sys/class/hwmon/hwmon*/pwm1; do " ..
        "[ -w \"$p\" ] || continue; " ..
        "case \"$(cat \"${p%/*}/name\" 2>/dev/null)\" in " ..
        "pwmfan|pwm-fan) echo \"$p\"; break;; esac; done")
    if handle then
        local path = handle:read("*l")
        handle:close()
        if path and path ~= "" then return path end
    end
    -- Method 2: sysfs pwmchip (e.g., MT7981 built-in PWM controller)
    -- Check if any pwm channel is exported and writable
    local h2 = io.popen(
        "for c in /sys/class/pwm/pwmchip*/pwm*/duty_cycle; do " ..
        "[ -w \"$c\" ] && echo \"$c\"; break; done 2>/dev/null")
    if h2 then
        local path = h2:read("*l")
        h2:close()
        if path and path ~= "" then return path end
    end
    return nil
end

-- 检测eMMC容量：返回扇区数（512字节/扇区），无法读取返回nil
-- 8GB版本约15,269,888扇区，16GB版本约31,116,288扇区
local function detect_emmc_size()
    local f = io.open("/sys/block/mmcblk0/size", "r")
    if not f then return nil end
    local size = f:read("*a")
    f:close()
    return tonumber(size)
end

local function selected_driver()
    local requested = uci:get("airpi-fan", "settings", "fan_driver") or "auto"
    if requested == "auto" then
        local emmc = detect_emmc_size()
        if emmc and emmc > 25000000 then
            -- 16GB闪存版本：仅支持软件PWM
            return "softpwm"
        elseif emmc and emmc <= 25000000 then
            -- 8GB闪存版本：仅支持硬件PWM
            return "pwm"
        end
        -- 无法读取eMMC容量时回退到路径探测
        return find_pwm_path() and "pwm" or "softpwm"
    end
    return requested
end

-- =====================================================================
--  Helper: write fan speed to active interfaces
-- =====================================================================
local function write_fan_speed(val)
    local v = tostring(val)
    local pwm_path = find_pwm_path()
    local driver = selected_driver()
    if driver == "pwm" and pwm_path and fs.access(pwm_path, "w") then
        local f = io.open(pwm_path, "w"); if f then f:write(v); f:close() end
    elseif driver == "softpwm" and fs.access(DUTY_PATH, "w") then
        local f = io.open(DUTY_PATH, "w"); if f then f:write(v); f:close() end
    end
    local f = io.open(SPEED_CONF, "w"); if f then f:write(v); f:close() end
end

-- =====================================================================
--  Helper: stop fancts.sh daemon (via procd init script)
-- =====================================================================
local function stop_fan_daemon()
    os.execute("/etc/init.d/airpi-fancontrol stop")
end

-- =====================================================================
--  Helper: start fancts.sh daemon (via procd init script)
-- =====================================================================
local function start_fan_daemon()
    os.execute("/etc/init.d/airpi-fancontrol start")
end

-- =====================================================================
--  Common boilerplate for action endpoints
-- =====================================================================
local function parse_request()
    local rv = {}
    rv.p    = http.formvalue("p") or ""
    rv.set  = http.formvalue("set") or ""
    rv.port = string.gsub(rv.p, "\"", "~")
    rv.at   = rv.set
    return rv
end

local function json_reply(rv)
    http.prepare_content("application/json")
    http.write_json(rv)
end

-- =====================================================================
--  Route registration
-- =====================================================================
function index()
    entry({"admin", "status", "airpi-fan-status"},
        template("airpi-fancontrol/fan_status"), _("风扇控制"), 94)

    entry({"admin", "status", "airpi-fan-settings"},
        cbi("airpi-fancontrol"), _("风扇设置"), 100)

    entry({"admin", "airpi-fan", "fanstop"}, call("action_fanstop"))
    entry({"admin", "airpi-fan", "fanst1"},  call("action_fanst1"))
    entry({"admin", "airpi-fan", "fanst2"},  call("action_fanst2"))

    local e3 = entry({"admin", "airpi-fan", "fanst3"}, call("action_fanst3"))
    e3.sysauth = false; e3.leaf = true

    local e4 = entry({"admin", "airpi-fan", "fanst4"}, call("action_fanst4"))
    e4.sysauth = false; e4.leaf = true

    entry({"admin", "airpi-fan", "fansttp"}, call("action_fansttp"))
    entry({"admin", "airpi-fan", "fanst"},   call("action_fanst"))
    entry({"admin", "airpi-fan", "fansvm"},  call("action_fansvm"))
    entry({"admin", "airpi-fan", "fansvc"},  call("action_fansvc"))
    entry({"admin", "airpi-fan", "fanswj"},  call("action_fanswj"))
    entry({"admin", "airpi-fan", "fanswj2"}, call("action_fanswj2"))
end

-- =====================================================================
--  fanstop: silent mode (25%)
-- =====================================================================
function action_fanstop()
    local rv = parse_request()
    stop_fan_daemon()
    os.execute("echo 0 > " .. FANVAL)
    write_fan_speed(64)
    rv.result = "fanstop"
    json_reply(rv)
end

-- =====================================================================
--  fanst1: low speed (50%)
-- =====================================================================
function action_fanst1()
    local rv = parse_request()
    stop_fan_daemon()
    os.execute("echo 1 > " .. FANVAL)
    write_fan_speed(128)
    rv.result = "fanst1"
    json_reply(rv)
end

-- =====================================================================
--  fanst2: normal speed (75%)
-- =====================================================================
function action_fanst2()
    local rv = parse_request()
    stop_fan_daemon()
    os.execute("echo 2 > " .. FANVAL)
    write_fan_speed(192)
    rv.result = "fanst2"
    json_reply(rv)
end

-- =====================================================================
--  fanst3: full speed (100%)
-- =====================================================================
function action_fanst3()
    local rv = parse_request()
    stop_fan_daemon()
    os.execute("echo 3 > " .. FANVAL)
    write_fan_speed(255)
    rv.result = "fanst3"
    json_reply(rv)
end

-- =====================================================================
--  fanst4: smart auto temperature control
-- =====================================================================
function action_fanst4()
    local rv = parse_request()
    stop_fan_daemon()
    os.execute("echo 9 > " .. FANVAL)
    start_fan_daemon()
    rv.result = "fanst4"
    json_reply(rv)
end

-- =====================================================================
--  fanswj: stepless speed control
-- =====================================================================
function action_fanswj()
    local rv = parse_request()
    stop_fan_daemon()
    os.execute("echo 999 > " .. FANVAL)
    write_fan_speed(rv.port)
    rv.result = "fanswj"
    json_reply(rv)
end

-- =====================================================================
--  fanswj2: read current stepless speed for UI init
-- =====================================================================
function action_fanswj2()
    local rv = parse_request()
    stop_fan_daemon()
    os.execute("echo 999 > " .. FANVAL)
    local f = io.open(SPEED_CONF, "r")
    if f then
        rv.result = f:read("*a"):gsub("%s+$", "")
        f:close()
    else
        rv.result = "255"
    end
    rv.at = rv.set
    rv.port = rv.port
    json_reply(rv)
end

-- =====================================================================
--  fanst: query current fan status (speed + mode)
-- =====================================================================
function action_fanst()
    local rv = parse_request()

    local f = io.open(SPEED_CONF, "r")
    if f then
        rv.fanspd = f:read("*a"):gsub("%s+$", "")
        f:close()
    else
        rv.fanspd = "0"
    end

    local h = io.popen("pgrep -f fancts.sh")
    local pr = h:read("*a"); h:close()

    local fvc = nil
    local fv = io.open(FANVAL, "r")
    if fv then fvc = fv:read("*a"); fv:close() end

    if fvc and fvc:match("^%s*999%s*$") then
        rv.fancts = "无极"
    elseif pr ~= "" then
        rv.fancts = "智能"
    else
        rv.fancts = "手动"
    end

    rv.at = rv.set; rv.port = rv.port
    json_reply(rv)
end

-- =====================================================================
--  fansttp: query current temperature and source type
-- =====================================================================
function action_fansttp()
    local rv = parse_request()
    local fansv = "CPU温度"
    local temperature = 0

    local conf = io.open(FANVALV, "r")
    if conf then
        local cfg = conf:read("*a"); conf:close()
        if cfg:match("模组温度") then
            fansv = "模组温度"
            local h = io.popen("sendat 1 'AT^CHIPTEMP?' | grep CHIPTEMP | sed -n '1p' | cut -d, -f9 | sed '/^$/d'")
            local out = h:read("*a"); h:close()
            local tv = tonumber(out)
            if tv then
                temperature = tv / 10
            else
                temperature = "null"
            end
        end
    end

    if temperature == 0 or temperature == "null" then
        local th = io.popen("/usr/bin/get_sys_temp.sh -s 2>/dev/null")
        local line = th and th:read("*a") or ""
        if th then th:close() end
        local mc, src = line:match("(%d+)%s+(%w+)")
        local mcn = tonumber(mc)
        if mcn and mcn > 0 then
            temperature = mcn / 1000
            if src == "wifi" then fansv = "WiFi温度"
            elseif src == "phy" then fansv = "网络温度"
            else fansv = "CPU温度" end
        else
            fansv = "CPU温度"
            temperature = "null"
        end
    end

    rv.at = rv.set; rv.port = rv.port
    rv.fansttp = temperature; rv.fansv = fansv
    json_reply(rv)
end

-- =====================================================================
--  fansvm / fansvc: switch temperature source
-- =====================================================================
function action_fansvm()
    local rv = parse_request()
    os.execute("echo 9 > " .. FANVAL)
    os.execute("echo 模组温度 > " .. FANVALV)
    rv.result = "fansvm"
    json_reply(rv)
end

function action_fansvc()
    local rv = parse_request()
    os.execute("echo 9 > " .. FANVAL)
    os.execute("echo CPU温度 > " .. FANVALV)
    rv.result = "fansvc"
    json_reply(rv)
end
