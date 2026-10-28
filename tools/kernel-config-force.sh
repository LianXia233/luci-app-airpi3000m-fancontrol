#!/bin/sh
# 将 kernel-config.forced 中的符号值强制写入内核 .config.set。
#
# 背景见 README「差异根源」：滚动快照目标需要把内核符号对齐到已发布固件，
# 否则编出的 .ko 会因 struct module 布局不同被内核拒绝加载。
# 覆盖层（CONFIG_KERNEL_*）只能触达 OpenWrt 包装过的符号；其余内核内部符号
# （MODULES_TREE_LOOKUP、EVENT_TRACING 等）以及被 buildinfo 默认值带偏的
# 包装符号，都在这里以「先删后写」的方式强制——期望行必须成为该符号在文件
# 中的唯一赋值：不同 kconfig 实现对重复行取向不一（OpenWrt 工具链取首个赋值，
# 内核 conf 取末个），直接追加不可靠。
#
# 用法: kernel-config-force.sh <kernel .config.set 路径>
# 由 include/kernel-defaults.mk 的 Kernel/Configure/Default 在合并后调用。
set -e

CFG="$1"
FORCED="$(dirname "$0")/kernel-config.forced"

[ -s "$FORCED" ] || exit 0
[ -f "$CFG" ] || { echo "kernel-config-force: $CFG 不存在" >&2; exit 1; }

# 收集全部强制符号名，拼成单个交替正则，做一次过滤
SYMS=$(sed -E 's/^#[[:space:]]+//; s/^CONFIG_([A-Za-z0-9_]+).*$/\1/' "$FORCED" | tr '\n' '|' | sed -E 's/\|$//')
[ -n "$SYMS" ] || exit 0

TMP="$CFG.force.tmp"
# 一次删除所有强制符号的现存赋值（=y/=m/not-set）；grep 零命中返回 1，
# 不能让 set -e 中断
{ grep -vE "^CONFIG_(${SYMS})=" "$CFG" || true; } | \
	{ grep -vE "^# CONFIG_(${SYMS}) is not set" || true; } > "$TMP"
# 再把期望行作为唯一赋值写入
cat "$FORCED" >> "$TMP"
mv "$TMP" "$CFG"
