#!/bin/sh
# fancts.sh - AirPi Fan Control Daemon v3.5.0
# Part of luci-app-airpi-fancontrol
#
# Reads temperature from get_sys_temp.sh and adjusts fan PWM according
# to a stepped temperature curve. Uses the hottest available sensor to
# prevent thermal throttling. Supports both soft-PWM (airpi-gpio-fan.ko
# via /sys/kernel/duty_cycle) and hard-PWM (pwm-fan.ko via hwmon).

LOCKFILE="/var/run/airpi-fancontrol.pid"
CONFIG_FILE="/etc/config/airpi-fan"
FANVAL_FILE="/etc/fanvall"
FANVALV_FILE="/etc/fanvallv.conf"
SPEED_FILE="/usr/bin/fanspeed.conf"
TEMP_SCRIPT="/usr/bin/get_sys_temp.sh"

DUTY_PATH="/sys/kernel/duty_cycle"
EMMC_SIZE_FILE="/sys/block/mmcblk0/size"
EMMC_THRESHOLD=25000000
ACTIVE_DRIVER=""

# ---- Lockfile ----
if [ -e "$LOCKFILE" ]; then
    pid=$(cat "$LOCKFILE")
    if kill -0 "$pid" > /dev/null 2>&1; then
        echo "airpi-fancontrol already running with PID $pid."
        exit 1
    else
        rm "$LOCKFILE"
    fi
fi
echo $$ > "$LOCKFILE"
trap "rm -f '$LOCKFILE'; exit" INT TERM EXIT

# ---- eMMC容量检测 ----
detect_emmc_size() {
    [ -r "$EMMC_SIZE_FILE" ] || return 1
    local sectors
    sectors=$(cat "$EMMC_SIZE_FILE" 2>/dev/null)
    case "$sectors" in ''|*[!0-9]*) return 1 ;; esac
    [ "$sectors" -gt 0 ] 2>/dev/null && echo "$sectors" && return 0
    return 1
}

# ---- Find the AP3000M hardware pwm-fan interface ----
find_pwm_path() {
    local pwm
    for pwm in /sys/class/hwmon/hwmon*/pwm1; do
        [ -w "$pwm" ] || continue
        case "$(cat "${pwm%/*}/name" 2>/dev/null)" in
            pwmfan|pwm-fan) echo "$pwm"; return 0 ;;
        esac
    done
    return 1
}

# ---- Select driver: 优先eMMC容量判断，回退路径探测 ----
select_driver() {
    local requested pwm emmc
    requested=$(uci get airpi-fan.settings.fan_driver 2>/dev/null || echo "auto")

    if [ "$requested" = "auto" ]; then
        emmc=$(detect_emmc_size)
        if [ -n "$emmc" ]; then
            if [ "$emmc" -gt "$EMMC_THRESHOLD" ]; then
                ACTIVE_DRIVER="softpwm"; return
            else
                ACTIVE_DRIVER="pwm"; return
            fi
        fi
        pwm=$(find_pwm_path)
        [ -n "$pwm" ] && ACTIVE_DRIVER="pwm" || ACTIVE_DRIVER="softpwm"
    else
        ACTIVE_DRIVER="$requested"
    fi
}

ensure_driver() {
    local gpio freq
    if [ "$ACTIVE_DRIVER" = "pwm" ]; then
        rmmod airpi_gpio_fan 2>/dev/null
        return 0
    fi

    lsmod | grep -q '^airpi_gpio_fan[[:space:]]' && return 0
    gpio=$(uci get airpi-fan.settings.fan_gpio 2>/dev/null || echo "540")
    freq=$(uci get airpi-fan.settings.fan_freq 2>/dev/null || echo "15000")
    # 用模块名而非完整路径，兼容不同内核版本的安装路径
    insmod airpi-gpio-fan fangpio="$gpio" cycle=255 period="$freq" fanen=1 2>/dev/null \
        || modprobe airpi_gpio_fan fangpio="$gpio" cycle=255 period="$freq" fanen=1 2>/dev/null
}

# ---- Write PWM value to the selected interface ----
write_pwm() {
    local val="$1" pwm
    if [ "$ACTIVE_DRIVER" = "pwm" ]; then
        pwm=$(find_pwm_path)
        [ -n "$pwm" ] && echo "$val" > "$pwm" 2>/dev/null
    else
        [ -w "$DUTY_PATH" ] && echo "$val" > "$DUTY_PATH" 2>/dev/null
    fi
    echo "$val" > "$SPEED_FILE" 2>/dev/null
}

# ---- Check for manual mode override ----
check_manual_mode() {
    local mode
    [ -r "$FANVAL_FILE" ] || return 1
    mode=$(cat "$FANVAL_FILE" 2>/dev/null)

    case "$mode" in
        3) write_pwm 255; exit 0 ;;
        2) write_pwm 192; exit 0 ;;
        1) write_pwm 128; exit 0 ;;
        0) write_pwm 64;  exit 0 ;;
        *) return 1 ;;
    esac
}

# ---- Main ----
# 不再禁用thermal zone，让温度传感器持续更新
select_driver
ensure_driver
check_manual_mode

while true; do
    select_driver
    ensure_driver

    # 收集全部可用温度源，取最大值（毫摄氏度）
    temp_max=0

    # 温度源1：CPU thermal zone
    if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
        t=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
        case "$t" in ''|*[!0-9]*) ;; *) [ "$t" -gt "$temp_max" ] && temp_max=$t ;; esac
    fi

    # 温度源2：WiFi芯片（iwpriv）
    for dev in ra0 rax0 rai0; do
        [ -d "/sys/class/net/$dev" ] || continue
        tw=$(iwpriv "$dev" stat 2>/dev/null | grep -i CurrentTemperature | head -1 | grep -oE '[0-9]+' | head -1)
        [ -n "$tw" ] && tw=$((tw * 1000)) && [ "$tw" -gt "$temp_max" ] && temp_max=$tw
        break
    done

    # 温度源3：PHY hwmon
    if [ -r /sys/class/hwmon/hwmon1/temp1_input ]; then
        tp=$(cat /sys/class/hwmon/hwmon1/temp1_input 2>/dev/null)
        case "$tp" in ''|*[!0-9]*) ;; *) [ "$tp" -gt "$temp_max" ] && temp_max=$tp ;; esac
    fi

    # 温度源4：4G模组（ubus modem_ctrl）
    tm=$(ubus call modem_ctrl info 2>/dev/null | awk '/temperature/,/value/ {if(/value/) {gsub(/[^0-9]/,"",$2); print $2; exit}}')
    case "$tm" in ''|*[!0-9]*) ;; *) tm=$((tm * 1000)); [ "$tm" -gt "$temp_max" ] && temp_max=$tm ;; esac

    # 默认：如果所有源都读不到，设安全值64（最低转速）
    if [ "$temp_max" -le 0 ]; then
        write_pwm 64
    elif [ "$temp_max" -gt 85000 ]; then
        write_pwm 255
    elif [ "$temp_max" -gt 60000 ]; then
        write_pwm 192
    elif [ "$temp_max" -gt 50000 ]; then
        write_pwm 128
    else
        write_pwm 64
    fi

    sleep 8
done
