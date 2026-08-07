#
# Copyright (C) 2024-2026 AirPi OpenWrt Community
# This is free software, licensed under the GNU General Public License v2.
#
# kmod-airpi-gpio-fan: GPIO bit-bang soft-PWM fan driver for AirPi AP3000M
#

include $(TOPDIR)/rules.mk
include $(INCLUDE_DIR)/kernel.mk

PKG_NAME:=airpi-gpio-fan
PKG_VERSION:=3.3.0
PKG_RELEASE:=1

PKG_MAINTAINER:=AirPi Community
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define KernelPackage/airpi-gpio-fan
  SUBMENU:=Other modules
  TITLE:=AirPi GPIO soft-PWM fan driver
  DEPENDS:=@TARGET_mediatek_filogic
  # 不强制匹配内核版本：默认 KernelPackage 会自动注入
  #   EXTRA_DEPENDS:=kernel (=版本~vermagic-r发布)
  # 把该项清空后，opkg/apk 不再因为内核版本号不同而拒绝安装。
  # 注意：模块仍带有 vermagic，加载时由 kmodloader 校验，
  #       因此请用与本机内核 vermagic 一致的 SDK 编译（CI 已按 immortalwrt master 实测）。
  EXTRA_DEPENDS:=
  FILES:=$(PKG_BUILD_DIR)/airpi-gpio-fan.ko
endef

define KernelPackage/airpi-gpio-fan/description
  GPIO bit-bang soft-PWM fan driver for the AirPi AP3000M (MediaTek MT7981B).

  Creates /sys/kernel/duty_cycle to control fan speed (0-255).
  Module parameters:
    fangpio - GPIO pin driving the fan (default 540)
    cycle   - maximum duty value (default 255)
    period  - PWM period in microseconds (default 15000)
    fanen   - 1 = enabled, 0 = force output LOW
endef

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./src/airpi-gpio-fan.c $(PKG_BUILD_DIR)/
	$(CP) ./src/Makefile $(PKG_BUILD_DIR)/
endef

define Build/Compile
	+$(KERNEL_MAKE) M="$(PKG_BUILD_DIR)" modules
endef

$(eval $(call KernelPackage,airpi-gpio-fan))
