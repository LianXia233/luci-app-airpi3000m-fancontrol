#!/bin/sh
# get_sys_temp.sh - unified system temperature reader (v3.5.0)
# Part of luci-app-airpi-fancontrol
#
# Usage:
#   get_sys_temp.sh              -> hottest millidegrees C (e.g. 46000)
#   get_sys_temp.sh -c           -> hottest whole degrees C (e.g. 46)
#   get_sys_temp.sh -s           -> source tag too: "46000 cpu"
#   get_sys_temp.sh -a           -> ALL sensors with labels (JSON-friendly)

CPU_ZONE="/sys/class/thermal/thermal_zone0/temp"
PHY_HWMON="/sys/class/hwmon/hwmon1/temp1_input"
WIFI_IFACES="ra0 rax0 rai0"

_valid_mc() {
    case "$1" in ''|*[!0-9-]*) return 1 ;; esac
    [ "$1" -ge 1000 ] 2>/dev/null && [ "$1" -le 150000 ] 2>/dev/null
}

read_cpu_mc() {
    [ -r "$CPU_ZONE" ] || return 1
    local v; v=$(cat "$CPU_ZONE" 2>/dev/null)
    _valid_mc "$v" && { CPU_VAL=$v; echo "$v"; return 0; }
    return 1
}

read_wifi_mc() {
    local dev c mc
    WIFI_VAL=""
    for dev in $WIFI_IFACES; do
        [ -d "/sys/class/net/$dev" ] || continue
        c=$(iwpriv "$dev" stat 2>/dev/null | grep -i CurrentTemperature | head -1 | grep -oE '[0-9]+' | head -1)
        [ -n "$c" ] || continue
        mc=$((c * 1000))
        _valid_mc "$mc" && { WIFI_VAL=$mc; echo "$mc"; return 0; }
    done
    return 1
}

read_phy_mc() {
    [ -r "$PHY_HWMON" ] || return 1
    local v; v=$(cat "$PHY_HWMON" 2>/dev/null)
    _valid_mc "$v" && { PHY_VAL=$v; echo "$v"; return 0; }
    return 1
}

read_modem_mc() {
    MODEM_VAL=""
    # 通过 ubus modem_ctrl 获取模组温度（兼容 Fibocom/Quectel 等主流模组）
    local t
    t=$(ubus call modem_ctrl info 2>/dev/null | awk '/temperature/,/value/ {if(/value/) {gsub(/[^0-9]/,"",$2); print $2; exit}}')
    [ -n "$t" ] || return 1
    case "$t" in ''|*[!0-9]*) return 1 ;; esac
    local mc=$((t * 1000))
    _valid_mc "$mc" && { MODEM_VAL=$mc; echo "$mc"; return 0; }
    return 1
}

# -------------- All sensors mode --------------
if [ "$1" = "-a" ]; then
    cpu_mc=$(read_cpu_mc 2>/dev/null || echo "")
    wifi_mc=$(read_wifi_mc 2>/dev/null || echo "")
    phy_mc=$(read_phy_mc 2>/dev/null || echo "")
    modem_mc=$(read_modem_mc 2>/dev/null || echo "")

    # Output simple key=value format, one per line
    [ -n "$cpu_mc" ]   && echo "cpu=$((cpu_mc / 1000))"
    [ -n "$wifi_mc" ]  && echo "wifi=$((wifi_mc / 1000))"
    [ -n "$phy_mc" ]   && echo "phy=$((phy_mc / 1000))"
    [ -n "$modem_mc" ] && echo "modem=$((modem_mc / 1000))"
    exit 0
fi

# -------------- Single hottest sensor mode --------------
mc=""; src=""
if mc=$(read_cpu_mc 2>/dev/null); then src="cpu"
elif mc=$(read_wifi_mc 2>/dev/null); then src="wifi"
elif mc=$(read_phy_mc 2>/dev/null); then src="phy"
else mc=0; src="none"
fi

case "$1" in
    -c) echo $((mc / 1000)) ;;
    -s) echo "$mc $src" ;;
    *)  echo "$mc" ;;
esac
