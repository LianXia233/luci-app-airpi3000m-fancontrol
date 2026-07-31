#
# Copyright (C) 2024-2026 AirPi OpenWrt Community
# This is free software, licensed under the GNU General Public License v2.
#
# kmod-airpi-gpio-fan: GPIO bit-bang soft-PWM fan driver for AirPi AP3000M
#

include $(TOPDIR)/rules.mk
include $(INCLUDE_DIR)/kernel.mk

PKG_NAME:=airpi-gpio-fan
PKG_VERSION:=3.1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=AirPi Community
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define KernelPackage/airpi-gpio-fan
  SUBMENU:=Other modules
  TITLE:=AirPi GPIO soft-PWM fan driver
  DEPENDS:=@(TARGET_mediatek_filogic||TARGET_mediatek_mt7622||TARGET_rockchip) +kmod-hwmon-core
  FILES:=$(PKG_BUILD_DIR)/airpi-gpio-fan.ko
  AUTOLOAD:=$(call AutoProbe,airpi-gpio-fan)
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
