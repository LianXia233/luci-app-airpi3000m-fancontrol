#!/bin/sh
# AirPi AP3000M 风扇控制 —— 只读探测脚本
#
# 设计约束: 全程不修改设备状态。
#   - 不写任何 sysfs / UCI / 文件 (临时输出仅落在 /tmp)
#   - 不 stop/start/restart 服务, 不加载或卸载内核模块
#   - 不控制风扇转速
#
# 用法: 在设备上执行, 或经 SSH 管道执行
#   sh airpi-probe.sh
#   ssh root@192.168.10.1 'sh -s' < tools/airpi-probe.sh
#
# 输出为纯文本分段报告, 可直接粘贴给审查者。

set -u

sec() { printf '\n===== %s =====\n' "$1"; }
kv()  { printf '%-28s %s\n' "$1" "$2"; }
run() { printf '$ %s\n' "$*"; "$@" 2>&1; }

OUT=${1:-/tmp/airpi-probe.$(date +%Y%m%d-%H%M%S).txt}
exec > "$OUT" 2>&1 || { echo "无法写入 $OUT" >&2; exit 1; }

sec "0. 探测元信息"
kv "probe time" "$(date -Is 2>/dev/null || date)"
kv "probe script" "airpi-probe.sh (read-only)"
kv "busybox" "$(busybox 2>&1 | head -1)"

sec "1. 系统版本与运行环境"
run uname -a
run cat /etc/openwrt_release
run cat /etc/immortalwrt_release
kv "uptime" "$(cat /proc/uptime 2>/dev/null)"
kv "cpu model" "$(grep -m1 'model name\|machine' /proc/cpuinfo 2>/dev/null)"
kv "core count" "$(grep -c ^processor /proc/cpuinfo 2>/dev/null)"
kv "memory" "$(grep -E 'MemTotal|MemAvailable' /proc/meminfo | tr '\n' ' ')"
sec "1b. 内核 cmdline / DTB 型号"
kv "cmdline" "$(cat /proc/cmdline 2>/dev/null)"
kv "dt model" "$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0')"
kv "dt compatible" "$(cat /proc/device-tree/compatible 2>/dev/null | tr '\0' ' ')"

sec "2. 包管理器与本包安装状态"
if [ -d /etc/apk ]; then kv "pkg manager" "apk"; PKG=apk
else kv "pkg manager" "opkg"; PKG=opkg; fi
case "$PKG" in
  apk) run apk info -e 'airpi' ; run apk info luci-base
       kv "apk world" "$(cat /etc/apk/world 2>/dev/null | tr '\n' ' ')" ;;
  opkg) run opkg list-installed
       kv "opkg status grep" "$(grep -i airpi /usr/lib/opkg/status 2>/dev/null | head -20)" ;;
esac
sec "2b. 本包相关文件清单"
run ls -l /usr/bin/airpi-fanctl /usr/bin/airpi-fanctl.sh /usr/bin/get_sys_temp.sh 2>/dev/null
run ls -l /etc/init.d/airpi-fancontrol /etc/config/airpi-fan 2>/dev/null
run ls -l /www/luci-static/resources/view/airpi-fancontrol/ 2>/dev/null
run ls -l /usr/share/luci/menu.d/luci-app-airpi-fancontrol.json /usr/share/rpcd/acl.d/luci-app-airpi-fancontrol.json 2>/dev/null
kv "airpi .ko files" "$(find /lib/modules /usr/lib -name '*airpi*' 2>/dev/null | tr '\n' ' ')"

sec "3. LuCI 版本"
run luci --version 2>/dev/null
run cat /usr/lib/lua/luci/version.lua 2>/dev/null
run grep -m5 -r . /etc/config/luci 2>/dev/null
kv "rpcd" "$(ls -l /sbin/rpcd /usr/sbin/rpcd 2>/dev/null | head -1)"
kv "uhttpd" "$(ls -l /usr/sbin/uhttpd 2>/dev/null)"

sec "4. 服务与进程现状"
run /etc/init.d/airpi-fancontrol status 2>&1
kv "enabled" "$(ls -l /etc/rc.d/*airpi* 2>/dev/null)"
run ls -l /var/run/airpi-fancontrol.pid 2>/dev/null
kv "pid content" "$(cat /var/run/airpi-fancontrol.pid 2>/dev/null)"
sec "4b. 相关进程"
printf '%s\n' "$(ps w 2>/dev/null | grep -E 'airpi|fanctl|rpcd|uhttpd|luci' | grep -v grep)"
sec "4c. 守护进程 CPU 占用采样 (top 两次取第二次)"
run top -b -n 2 -d 2 2>/dev/null | grep -A2 -i -E 'airpi|%CPU' | tail -25
sec "4d. procd 视角"
run ubus -v list airpi-fancontrol 2>&1
run ubus list 2>&1 | tr '\n' ' '

sec "5. UCI 当前配置"
run uci -q show airpi-fan
run cat /etc/config/airpi-fan
kv "uci defaults file" "$(ls -l /etc/uci-defaults/*airpi* 2>/dev/null)"

sec "6. 温度来源 (只读)"
sec "6a. thermal zone"
for z in /sys/class/thermal/thermal_zone*; do
  [ -d "$z" ] || continue
  printf '%-16s %-24s temp=%s\n' "$(basename "$z")" "$(cat "$z/type" 2>/dev/null)" "$(cat "$z/temp" 2>/dev/null)"
done
sec "6b. hwmon"
for h in /sys/class/hwmon/hwmon*; do
  [ -d "$h" ] || continue
  printf -- '--- %s (name=%s) ---\n' "$(basename "$h")" "$(cat "$h/name" 2>/dev/null)"
  for f in temp1_input pwm1 fan1_input freq1 fan2_input; do
    [ -e "$h/$f" ] && printf '    %-12s %s\n' "$f" "$(cat "$h/$f" 2>/dev/null)"
  done
  printf '    files: %s\n' "$(ls "$h" 2>/dev/null | tr '\n' ' ')"
done
sec "6c. 其他常见温度节点"
run ls -l /sys/class/thermal/cooling_device* 2>/dev/null
kv "cpu temp legacy" "$(cat /sys/devices/virtual/thermal/thermal_zone0/temp 2>/dev/null)"
sec "6d. WiFi 温度接口"
kv "net ifaces" "$(ls /sys/class/net 2>/dev/null | tr '\n' ' ')"
for i in ra0 rax0 rai0 ath0 wifi0; do
  [ -d "/sys/class/net/$i" ] || continue
  printf -- '--- iwpriv %s stat ---\n' "$i"
  iwpriv "$i" stat 2>&1 | grep -i -m4 -E 'temperature|CurrentTemp' 
done
sec "6e. modem 温度接口"
kv "modem_ctrl ubus" "$(ubus -v list modem_ctrl 2>&1 | head -8)"
run timeout 5 ubus call modem_ctrl info 2>&1
run timeout 5 ubus call modem-manager list 2>&1

sec "7. 风扇控制通路 (只读, 不写入)"
kv "airpi_gpio_fan module" "$(grep -w airpi_gpio_fan /proc/modules 2>/dev/null)"
kv "modinfo" "$(modinfo airpi_gpio_fan 2>/dev/null | tr '\n' ' ')"
kv "/sys/kernel/duty_cycle" "$(ls -l /sys/kernel/duty_cycle 2>/dev/null)"
kv "duty_cycle value" "$(cat /sys/kernel/duty_cycle 2>/dev/null)"
sec "7b. 硬件 PWM"
run ls -lR /sys/class/pwm 2>/dev/null
for c in /sys/class/pwm/pwmchip*; do
  [ -d "$c" ] || continue
  printf -- '--- %s ---\n' "$c"
  kv "  npwm" "$(cat "$c/npwm" 2>/dev/null)"
  for p in "$c"/pwm*; do
    [ -d "$p" ] || continue
    printf '  %s: period=%s duty=%s enable=%s polarity=%s\n' \
      "$(basename "$p")" "$(cat "$p/period" 2>/dev/null)" \
      "$(cat "$p/duty_cycle" 2>/dev/null)" "$(cat "$p/enable" 2>/dev/null)" \
      "$(cat "$p/polarity" 2>/dev/null)"
  done
done
sec "7c. 风扇转速反馈 (tach)"
kv "fan*_input hits" "$(grep -lsr '' /sys/class/hwmon/*/fan*_input 2>/dev/null | tr '\n' ' ')"
kv "any fan files"   "$(ls /sys/class/hwmon/*/fan* 2>/dev/null | tr '\n' ' ')"
sec "7d. eMMC 判型依据"
kv "/sys/block/mmcblk0/size" "$(cat /sys/block/mmcblk0/size 2>/dev/null)"
run ls -l /sys/block 2>/dev/null
run df -h /overlay /etc 2>/dev/null
run mount 2>/dev/null

sec "8. 状态文件与消费者"
kv "/usr/bin/fanspeed.conf" "$(ls -l /usr/bin/fanspeed.conf 2>/dev/null)"
kv "fanspeed content" "$(cat /usr/bin/fanspeed.conf 2>/dev/null)"
kv "fanspeed writable" "$([ -w /usr/bin/fanspeed.conf ] && echo yes || echo no)"
kv "/etc/fanvall" "$(ls -l /etc/fanvall 2>/dev/null)"
kv "fanvall content" "$(cat /etc/fanvall 2>/dev/null)"
kv "fanvall writable" "$([ -w /etc/fanvall ] && echo yes || echo no)"
sec "8b. 其他引用这些接口/路径的脚本 (判断兼容边界)"
grep -rIl -E 'fanspeed\.conf|/etc/fanvall|get_sys_temp|airpi-fanctl|duty_cycle' \
  /etc /usr/bin /usr/sbin /www /lib 2>/dev/null | head -40
sec "8c. 定时任务"
run crontab -l 2>&1
run ls -l /etc/cron.d /etc/crontabs 2>/dev/null
run cat /etc/crontabs/root 2>/dev/null
run ls -l /etc/rc.local /lib/upgrade/keep.d/*airpi* 2>/dev/null
run cat /etc/rc.local 2>/dev/null

sec "9. 现有 CLI 行为 (只读子命令)"
run /usr/bin/airpi-fanctl status
run /usr/bin/airpi-fanctl temp
run /usr/bin/airpi-fanctl temps
run /usr/bin/airpi-fanctl legacy-temp -a
run /usr/bin/airpi-fanctl hwdetect
run /usr/bin/get_sys_temp.sh -c
sec "9b. 单次 CLI 调用 fork 成本 (strace 通常不可用, 用 time 估算)"
run time /usr/bin/airpi-fanctl temp
run time /usr/bin/airpi-fanctl hwdetect
run time /usr/bin/airpi-fanctl status

sec "10. 日志"
run logread 2>/dev/null | grep -i -E 'airpi|fan|pwm|thermal|gpio' | tail -40
sec "10b. dmesg 尾部"
run dmesg 2>/dev/null | tail -25

sec "11. 资源占用采样 (10s)"
run cat /proc/loadavg
run free 2>/dev/null || cat /proc/meminfo | head -3
sec "11b. 温度/占空比 10 秒内 5 次采样"
n=1
while [ "$n" -le 5 ]; do
  printf 't%-2s duty=%s cpu=%s status=%s\n' "$n" \
    "$(cat /sys/kernel/duty_cycle 2>/dev/null)" \
    "$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)" \
    "$(/usr/bin/airpi-fanctl status 2>/dev/null | tr '\n' ' ')"
  n=$((n + 1)); sleep 2
done

sec "12. 内核 GPIO 状态"
run cat /sys/kernel/debug/gpio 2>/dev/null
run cat /sys/kernel/debug/pinctrl/*/pinmux-pins 2>/dev/null | grep -i -E '540|gpio' | head -20

sec "13. 前端资源实际下发内容"
kv "indexcache" "$(ls -l /tmp/luci-indexcache* 2>/dev/null)"
run ls -l /tmp/luci-modulecache 2>/dev/null

sec "完成"
echo "报告文件: $OUT"
echo "本脚本全程只读, 未修改任何设备状态。"
