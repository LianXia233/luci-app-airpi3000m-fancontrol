#!/usr/bin/env python3
"""修补 SDK 中 libffi 的 staging 缺陷（CI 专用）。

背景
----
libffi 3.4.7 的部分构建树把 ``fficonfig.h`` 生成到
``$(PKG_BUILD_DIR)/<triplet>/`` 下，OpenWrt/ImmortalWrt 的
``package/libs/libffi/Makefile`` 曾用这样一条语句把它拷进 staging：

    $(CP) \\
        $(PKG_BUILD_DIR)/$(GNU_TARGET_NAME)*/fficonfig.h \\
        $(1)/usr/include/

一旦该 glob 未命中（生成位置随树而异），``cp`` 报
``cannot stat ... No such file or directory``，整个包在 *staging* 阶段失败，
进而让依赖它的作业（本仓库的 ImmortalWrt master 目标）在「编译
luci-app-airpi-fancontrol」步骤挂掉。上游 openwrt/openwrt 已经删掉这条语句
（因为 ``make install`` 会把 fficonfig.h 装进 ``$(PKG_INSTALL_DIR)/usr/include``），
但 ImmortalWrt 的 base feed 快照仍带着旧写法。

做法
----
1. 删除上面对 glob 的硬编码依赖（与上游对齐）；
2. 追加一条按文件名查找的兜底复制：无论 fficonfig.h 落在 PKG_BUILD_DIR 还是
   PKG_INSTALL_DIR，都能被拷进 ``$(1)/usr/include``；两处都没有时静默跳过，
   不让 staging 因为"头文件位置变了"这种上游差异而失败。

脚本幂等：已修补过的 Makefile 带 ``AIRPI-FFI-FALLBACK`` 标记，重复执行直接跳过。
找不到需要修补的文件时正常退出（不同 SDK 树可能本就没有问题写法）。

用法::

    python3 tools/patch-libffi.py [SDK_DIR ...]
"""

from __future__ import annotations

import pathlib
import sys

MARK = "AIRPI-FFI-FALLBACK"

# 说明：这里刻意不用 shell 变量 / 命令替换。OpenWrt 的 Build/InstallDev 定义在
# define/endef 里，经 $(eval $(call BuildPackage,...)) 与 recipe 执行会被 make
# 连续求值两次，$$var 会被吃掉一层，写成 $$$$var 又依赖具体展开次数。改用
# 纯 shell glob + `|| true`，既不受展开次数影响，也不会在头文件缺失时中断 staging。
FALLBACK_LINES = (
    "\t$(CP) $(PKG_INSTALL_DIR)/usr/include/fficonfig.h $(1)/usr/include/ "
    f"2>/dev/null || true  # {MARK}\n"
    "\t$(CP) $(PKG_BUILD_DIR)/*/fficonfig.h $(1)/usr/include/ 2>/dev/null || true\n"
)


def patch_text(text: str) -> str | None:
    """返回修补后的文本；无需修补时返回 None。"""
    if MARK in text:
        return None

    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    changed = False

    while i < len(lines):
        line = lines[i]
        is_buggy = (
            "fficonfig.h" in line
            and ("$(GNU_TARGET_NAME)" in line or "$(PKG_BUILD_DIR)" in line)
        )
        if not is_buggy:
            out.append(line)
            i += 1
            continue

        # 回退到本条 $(CP) 语句的起点
        start = len(out) - 1
        while start >= 0 and "$(CP)" not in out[start]:
            start -= 1
        if start < 0:            # 定位不到起点就只替换当前行
            start = len(out)
        del out[start:]

        # 跳过续行与结尾的目标目录行
        i += 1
        while i < len(lines) and lines[i].rstrip().endswith("\\"):
            i += 1
        if i < len(lines) and "$(1)/usr/include/" in lines[i]:
            i += 1

        out.extend(FALLBACK_LINES)
        changed = True

    return "".join(out) if changed else None


def main(argv: list[str]) -> int:
    roots = argv[1:] or ["."]
    patched = 0
    for root in roots:
        base = pathlib.Path(root)
        if not base.is_dir():
            print(f"::warning::跳过不存在的目录 {base}")
            continue
        for mk in base.rglob("libffi/Makefile"):
            if "build_dir" in mk.parts:      # 构建产物里的副本不处理
                continue
            try:
                text = mk.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                print(f"::warning::读取失败 {mk}: {exc}")
                continue
            new = patch_text(text)
            if new is None:
                continue
            mk.write_text(new, encoding="utf-8")
            print(f"已修补 libffi staging: {mk}")
            patched += 1

    if patched == 0:
        print("libffi: 未发现需要修补的 fficonfig.h glob（跳过）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
