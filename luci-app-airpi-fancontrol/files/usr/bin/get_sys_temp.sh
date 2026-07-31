#!/bin/sh
# get_sys_temp.sh - unified system temperature reader (outputs milli-degrees C)
# Primary: CPU thermal_zone0. Fallback when CPU sensor is invalid: Wi-Fi chip
# temperature (MTK driver via iwpriv), then network PHY hwmon as last resort.
# A reading is "valid" only if it is a number in a sane range (1C..150C).
#
# Usage: get_sys_temp.sh           -> prints milli-degrees (e.g. 46000)
#        get_sys_temp.sh -c        -> prints whole degrees C (e.g. 46)
#        get_sys_temp.sh -s        -> prints source tag too: "46000 wifi"

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
    _valid_mc "$v" && { echo "$v"; return 0; }
    return 1
}

read_wifi_mc() {
    local dev c mc
    for dev in $WIFI_IFACES; do
        [ -d "/sys/class/net/$dev" ] || continue
        c=$(iwpriv "$dev" stat 2>/dev/null | grep -i CurrentTemperature | head -1 | grep -oE '[0-9]+' | head -1)
        [ -n "$c" ] || continue
        mc=$((c * 1000))
        _valid_mc "$mc" && { echo "$mc"; return 0; }
    done
    return 1
}

read_phy_mc() {
    [ -r "$PHY_HWMON" ] || return 1
    local v; v=$(cat "$PHY_HWMON" 2>/dev/null)
    _valid_mc "$v" && { echo "$v"; return 0; }
    return 1
}

mc=""; src=""
if mc=$(read_cpu_mc); then src="cpu"
elif mc=$(read_wifi_mc); then src="wifi"
elif mc=$(read_phy_mc); then src="phy"
else mc=0; src="none"
fi

case "$1" in
    -c) echo $((mc / 1000)) ;;
    -s) echo "$mc $src" ;;
    *)  echo "$mc" ;;
esac
