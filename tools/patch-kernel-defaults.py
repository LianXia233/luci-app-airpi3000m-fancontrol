#!/usr/bin/env python3
"""在 include/kernel-defaults.mk 中插入内核配置强制钩子。

Kernel/Configure/Default 用 kconfig.pl 合并出 .config.set 后立即调用
kernel-config-force.sh，把 kernel-config.forced 中的符号值作为该符号的
唯一赋值写回（见 tools/kernel-config-force.sh 头部说明）。

幂等：重复运行不产生重复钩子行。找不到合并行时：
  - sdk/kernel-config.forced 非空（确实需要强制）→ 以错误退出，
    避免在「补丁没打上」的情况下静默编出不兼容的 .ko；
  - 为空（如 24.10/25.12 固定发布目标）→ 仅告警继续，
    钩子本来就是空操作。

用法: patch-kernel-defaults.py <sdk-root>
"""

MARKER = ("$(SCRIPT_DIR)/kconfig.pl 'm+' '+' $(LINUX_DIR)/.config.target "
          "/dev/null $(LINUX_DIR)/.config.override > $(LINUX_DIR)/.config.set")
HOOK = "\n\t$(SHELL) $(TOPDIR)/kernel-config-force.sh $(LINUX_DIR)/.config.set"


def main() -> None:
    import sys

    if len(sys.argv) != 2:
        sys.exit("usage: patch-kernel-defaults.py <sdk-root>")
    sdk = sys.argv[1]
    path = f"{sdk}/include/kernel-defaults.mk"
    src = open(path, encoding="utf-8").read()
    if "kernel-config-force.sh" in src:
        print("kernel-defaults.mk 已含强制钩子，跳过")
        return
    forced = f"{sdk}/kernel-config.forced"
    try:
        need = open(forced, encoding="utf-8").read().strip() != ""
    except FileNotFoundError:
        need = False
    if MARKER not in src:
        msg = ("未找到 kconfig.pl m+ 合并行，include/kernel-defaults.mk "
               "结构已变化，请人工核对")
        if need:
            sys.exit(f"::error::{msg}")
        print(f"::warning::{msg}（本目标无强制项，跳过）")
        return
    src = src.replace(MARKER, MARKER + HOOK, 1)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print("已在 Kernel/Configure/Default 插入 kernel-config-force 钩子")


main()
