#!/bin/sh
# fancts.sh - AirPi Fan Control Daemon v3.0.0
# Part of luci-app-airpi-fancontrol
#
# Reads temperature from /usr/bin/get_sys_temp.sh and adjusts fan PWM
# according to a stepped temperature curve. Supports both soft-PWM
# (airpi-gpio-fan.ko via /sys/kernel/duty_cycle) and hard-PWM
# (pwm-fan.ko via /sys/class/hwmon/hwmon*/pwm1).

LOCKFILE="/var/run/airpi-fancontrol.pid"
CONFIG_FILE="/etc/config/airpi-fan"
FANVAL_FILE="/etc/fanvall"
FANVALV_FILE="/etc/fanvallv.conf"
SPEED_FILE="/usr/bin/fanspeed.conf"
TEMP_SCRIPT="/usr/bin/get_sys_temp.sh"

PWM_PATH="/sys/devices/platform/pwm-fan/hwmon/hwmon2/pwm1"
DUTY_PATH="/sys/kernel/duty_cycle"

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

# ---- Write PWM value to both interfaces ----
write_pwm() {
    local val="$1"
    if [ -w "$PWM_PATH" ]; then
        echo "$val" > "$PWM_PATH" 2>/dev/null
    fi
    if [ -w "$DUTY_PATH" ]; then
        echo "$val" > "$DUTY_PATH" 2>/dev/null
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
echo disabled > /sys/class/thermal/thermal_zone0/mode 2>/dev/null
check_manual_mode

while true; do
    driver="softpwm"
    if [ -f "$CONFIG_FILE" ]; then
        driver=$(uci get airpi-fan.settings.fan_driver 2>/dev/null || echo "softpwm")
    fi

    if [ "$driver" != "pwm" ]; then
        if ! lsmod | grep -q -E "Airpi[_-]gpio[_-]fan"; then
            rmmod Airpi-gpio-fan 2>/dev/null
            rmmod Airpi_gpio_fan 2>/dev/null
            gpio=$(uci get airpi-fan.settings.fan_gpio 2>/dev/null || echo "540")
            freq=$(uci get airpi-fan.settings.fan_freq 2>/dev/null || echo "15000")
            insmod /lib/modules/$(uname -r)/airpi-gpio-fan.ko \
                fangpio=$gpio cycle=255 period=$freq fanen=1 2>/dev/null
        fi
    elif lsmod | grep -q -E "Airpi[_-]gpio[_-]fan"; then
        rmmod Airpi-gpio-fan 2>/dev/null
        rmmod Airpi_gpio_fan 2>/dev/null
    fi

    temp=""
    if [ -r "$FANVALV_FILE" ] && grep -q "模组温度" "$FANVALV_FILE" 2>/dev/null; then
        if lsusb 2>/dev/null | grep -q 5700; then
            temp=$(sendat 1 'AT^CHIPTEMP?' 2>/dev/null | grep 'CHIPTEMP' | sed -n '1p' | cut -d, -f9 | sed '/^$/d')
            [ -n "$temp" ] && temp=$((temp * 100))
        fi
    fi

    if [ -z "$temp" ] || ! echo "$temp" | grep -qE '^[0-9]+$'; then
        if [ -x "$TEMP_SCRIPT" ]; then
            temp=$("$TEMP_SCRIPT" 2>/dev/null)
        else
            temp=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
        fi
    fi

    case "$temp" in ''|*[!0-9-]*) temp=0 ;; esac

    if [ "$temp" -gt 85000 ]; then
        write_pwm 255
    elif [ "$temp" -gt 60000 ] && [ "$temp" -le 85000 ]; then
        write_pwm 192
    elif [ "$temp" -gt 50000 ] && [ "$temp" -le 60000 ]; then
        write_pwm 128
    elif [ "$temp" -gt 0 ] && [ "$temp" -le 50000 ]; then
        write_pwm 64
    else
        write_pwm 64
    fi

    sleep 8
done
