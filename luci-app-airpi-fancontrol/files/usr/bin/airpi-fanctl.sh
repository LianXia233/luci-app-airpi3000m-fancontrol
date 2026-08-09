#!/bin/sh
# airpi-fanctl.sh - backend helper for the LuCI JS frontend (v4.2.0)
# Part of luci-app-airpi-fancontrol
#
# The modern JS-based LuCI (immortalwrt master / OpenWrt 24.10+) no longer
# ships the Lua controller stack, so all device interaction is funneled
# through this shell helper which the JS views invoke via rpcd fs.exec.
#
# Output convention: simple key=value lines on stdout, easy to parse in JS.
#
# Usage:
#   airpi-fanctl.sh status              -> fanspd/mode/driver/daemon
#   airpi-fanctl.sh temp                -> temp/source (display temperature)
#   airpi-fanctl.sh temps               -> all sensors (passthrough of get_sys_temp.sh -a)
#   airpi-fanctl.sh set <speed> <code>  -> manual speed + mode code (0..3)
#   airpi-fanctl.sh auto                -> smart auto mode (restart daemon)
#   airpi-fanctl.sh stepless <speed>    -> stepless mode (code 999)
#   airpi-fanctl.sh tempsrc <cpu|modem> -> switch temperature source
#   airpi-fanctl.sh hwdetect            -> hardware detection summary
#   airpi-fanctl.sh reload              -> reload driver per UCI config

DUTY_PATH="/sys/kernel/duty_cycle"
SPEED_CONF="/usr/bin/fanspeed.conf"
FANVAL="/etc/fanvall"
FANVALV="/etc/fanvallv.conf"
EMMC_FILE="/sys/block/mmcblk0/size"
EMMC_THRESHOLD=25000000

detect_emmc_sectors() {
    [ -r "$EMMC_FILE" ] || return 1
    local s; s=$(cat "$EMMC_FILE" 2>/dev/null)
    case "$s" in ''|*[!0-9]*) return 1 ;; esac
    [ "$s" -gt 0 ] 2>/dev/null && echo "$s" && return 0
    return 1
}

find_pwm_path() {
    local pwm
    for pwm in /sys/class/hwmon/hwmon*/pwm1; do
        [ -w "$pwm" ] || continue
        case "$(cat "${pwm%/*}/name" 2>/dev/null)" in
            pwmfan|pwm-fan) echo "$pwm"; return 0 ;;
        esac
    done
    # Fallback: any exported writable pwmchip channel (MT7981 built-in PWM)
    local c
    for c in /sys/class/pwm/pwmchip*/pwm*/duty_cycle; do
        [ -w "$c" ] && { echo "$c"; return 0; }
    done
    return 1
}

selected_driver() {
    local requested emmc
    requested=$(uci get airpi-fan.settings.fan_driver 2>/dev/null || echo "auto")
    [ -z "$requested" ] && requested="auto"
    if [ "$requested" = "auto" ]; then
        emmc=$(detect_emmc_sectors)
        if [ -n "$emmc" ]; then
            if [ "$emmc" -gt "$EMMC_THRESHOLD" ]; then
                echo "softpwm"; return
            else
                echo "pwm"; return
            fi
        fi
        [ -n "$(find_pwm_path)" ] && echo "pwm" || echo "softpwm"
        return
    fi
    echo "$requested"
}

write_fan_speed() {
    local val="$1" pwm driver
    driver=$(selected_driver)
    if [ "$driver" = "pwm" ]; then
        pwm=$(find_pwm_path)
        [ -n "$pwm" ] && echo "$val" > "$pwm" 2>/dev/null
    else
        [ -w "$DUTY_PATH" ] && echo "$val" > "$DUTY_PATH" 2>/dev/null
    fi
    echo "$val" > "$SPEED_CONF" 2>/dev/null
}

daemon_running() {
    pgrep -f fancts.sh >/dev/null 2>&1 && echo 1 || echo 0
}

cmd_status() {
    local spd mode fv
    spd=$(cat "$SPEED_CONF" 2>/dev/null); spd=${spd:-0}
    fv=$(cat "$FANVAL" 2>/dev/null)
    if [ "$fv" = "999" ]; then
        mode="无极"
    elif [ "$(daemon_running)" = "1" ]; then
        mode="智能"
    else
        mode="手动"
    fi
    echo "fanspd=$spd"
    echo "fanval=${fv:-na}"
    echo "mode=$mode"
    echo "driver=$(selected_driver)"
    echo "daemon=$(daemon_running)"
}

cmd_temp() {
    local fansv="CPU温度" temperature=""
    local cfg=""
    [ -r "$FANVALV" ] && cfg=$(cat "$FANVALV" 2>/dev/null)

    case "$cfg" in
    *模组温度*)
        fansv="模组温度"
        local out tv
        out=$(sendat 1 'AT^CHIPTEMP?' 2>/dev/null | grep CHIPTEMP | sed -n '1p' | cut -d, -f9 | sed '/^$/d')
        tv=$(echo "$out" | tr -cd '0-9')
        if [ -n "$tv" ]; then
            temperature=$(awk "BEGIN{printf \"%.1f\", $tv/10}")
        fi
        ;;
    esac

    if [ -z "$temperature" ]; then
        local line mc src mcn
        line=$(/usr/bin/get_sys_temp.sh -s 2>/dev/null)
        mc=$(echo "$line" | awk '{print $1}')
        src=$(echo "$line" | awk '{print $2}')
        case "$mc" in ''|*[!0-9]*) mcn=0 ;; *) mcn=$mc ;; esac
        if [ "$mcn" -gt 0 ] 2>/dev/null; then
            temperature=$(awk "BEGIN{printf \"%.1f\", $mcn/1000}")
            case "$src" in
                wifi) fansv="WiFi温度" ;;
                phy)  fansv="网络温度" ;;
                *)    fansv="CPU温度" ;;
            esac
        else
            fansv="CPU温度"
            temperature="null"
        fi
    fi

    echo "temp=$temperature"
    echo "source=$fansv"
}

cmd_temps() {
    /usr/bin/get_sys_temp.sh -a 2>/dev/null
}

cmd_set() {
    local speed="$1" code="$2"
    /etc/init.d/airpi-fancontrol stop >/dev/null 2>&1
    echo "$code" > "$FANVAL" 2>/dev/null
    write_fan_speed "$speed"
    echo "result=ok"
}

cmd_auto() {
    echo 9 > "$FANVAL" 2>/dev/null
    /etc/init.d/airpi-fancontrol restart >/dev/null 2>&1
    echo "result=ok"
}

cmd_stepless() {
    local speed="$1"
    /etc/init.d/airpi-fancontrol stop >/dev/null 2>&1
    echo 999 > "$FANVAL" 2>/dev/null
    write_fan_speed "$speed"
    echo "result=ok"
    echo "speed=$speed"
}

cmd_tempsrc() {
    echo 9 > "$FANVAL" 2>/dev/null
    case "$1" in
        modem) echo "模组温度" > "$FANVALV" ;;
        *)     echo "CPU温度" > "$FANVALV" ;;
    esac
    echo "result=ok"
}

cmd_hwdetect() {
    local emmc gb hw pwmchip loaded duty
    emmc=$(detect_emmc_sectors)
    if [ -n "$emmc" ]; then
        gb=$(( (emmc * 512 + 500000000) / 1000000000 ))
        echo "emmc_sectors=$emmc"
        echo "emmc_gb=$gb"
    else
        echo "emmc_sectors=na"
        echo "emmc_gb=?"
    fi

    # 16GB eMMC 版本不支持硬件 PWM,即使 sysfs 中存在 pwmchip 节点
    if [ -n "$emmc" ] && [ "$emmc" -gt "$EMMC_THRESHOLD" ]; then
        hw=""
    else
        hw=$(find_pwm_path)
    fi
    echo "hw_pwm=${hw:-none}"

    pwmchip=$(ls -d /sys/class/pwm/pwmchip* 2>/dev/null | head -1)
    pwmchip=${pwmchip##*/}
    echo "pwmchip=${pwmchip:-none}"

    if lsmod | grep -q '^airpi_gpio_fan'; then
        loaded=1
    else
        loaded=0
    fi
    echo "softpwm_loaded=$loaded"

    duty=$(cat "$DUTY_PATH" 2>/dev/null)
    echo "duty=${duty:-na}"

    echo "driver=$(selected_driver)"
}

cmd_reload() {
    local driver gpio freq out
    driver=$(uci get airpi-fan.settings.fan_driver 2>/dev/null || echo "auto")
    gpio=$(uci get airpi-fan.settings.fan_gpio 2>/dev/null || echo "540")
    freq=$(uci get airpi-fan.settings.fan_freq 2>/dev/null || echo "15000")

    case "$driver" in
    pwm)
        /etc/init.d/airpi-fancontrol stop >/dev/null 2>&1
        rmmod airpi_gpio_fan 2>/dev/null
        echo "msg=已切换到硬件PWM模式。请确认 pwm-fan 设备树节点已配置。"
        ;;
    softpwm)
        /etc/init.d/airpi-fancontrol stop >/dev/null 2>&1
        rmmod airpi_gpio_fan 2>/dev/null
        out=$(insmod airpi-gpio-fan fangpio="$gpio" cycle=255 period="$freq" fanen=1 2>&1) \
            || out=$(modprobe airpi_gpio_fan fangpio="$gpio" cycle=255 period="$freq" fanen=1 2>&1)
        /etc/init.d/airpi-fancontrol start >/dev/null 2>&1
        [ -z "$out" ] && out="加载成功"
        echo "msg=软PWM驱动已重新加载 (GPIO=$gpio, 周期=${freq}us): $out"
        ;;
    *)
        # auto: 交给 init 脚本按 eMMC 容量自动选择驱动
        /etc/init.d/airpi-fancontrol restart >/dev/null 2>&1
        echo "msg=已按自动模式重新加载驱动 (当前选择: $(selected_driver))。"
        ;;
    esac
    echo "result=ok"
}

case "$1" in
    status)    cmd_status ;;
    temp)      cmd_temp ;;
    temps)     cmd_temps ;;
    set)       cmd_set "$2" "$3" ;;
    auto)      cmd_auto ;;
    stepless)  cmd_stepless "$2" ;;
    tempsrc)   cmd_tempsrc "$2" ;;
    hwdetect)  cmd_hwdetect ;;
    reload)    cmd_reload ;;
    *)
        echo "usage: $0 {status|temp|temps|set <speed> <code>|auto|stepless <speed>|tempsrc <cpu|modem>|hwdetect|reload}" >&2
        exit 1
        ;;
esac
exit 0
