#
# Copyright (C) 2024-2026 AirPi OpenWrt Community
# This is free software, licensed under the GNU General Public License v2.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-airpi-fancontrol
PKG_VERSION:=3.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=AirPi Community
PKG_LICENSE:=GPL-2.0-only
PKG_LICENSE_FILES:=LICENSE

LUCI_TITLE:=LuCI Support for AirPi Fan Control (unified soft-PWM + hard-PWM)
LUCI_DEPENDS:=+kmod-hwmon-pwmfan +luci-lua-runtime
LUCI_PKGARCH:=all

include $(INCLUDE_DIR)/package.mk
include ../../luci.mk

# === Kernel module: kmod-airpi-gpio-fan ===
define KernelPackage/airpi-gpio-fan
  SUBMENU:=Other modules
  TITLE:=AirPi GPIO soft-PWM fan driver
  DEPENDS:=@TARGET_aarch64_cortex-a53 +kmod-hwmon-core
  KCONFIG:=
  FILES:=$(PKG_BUILD_DIR)/airpi-gpio-fan.ko
  AUTOLOAD:=$(call AutoProbe,airpi-gpio-fan)
endef

define KernelPackage/airpi-gpio-fan/description
  GPIO bit-bang soft-PWM fan driver for AirPi AP3000M.
  Creates /sys/kernel/duty_cycle to control fan speed (0-255).
  Parameters: fangpio (GPIO pin), cycle (max duty), period (PWM period us).
endef

define Build/Prepare
	$(call Build/Prepare/Default)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(MAKE) -C "$(LINUX_DIR)" \
		ARCH="$(LINUX_KARCH)" \
		CROSS_COMPILE="$(TARGET_CROSS)" \
		M="$(PKG_BUILD_DIR)" \
		KERNEL_DIR="$(LINUX_DIR)" \
		modules
endef

define Package/luci-app-airpi-fancontrol/install
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/airpi-fancontrol $(1)/etc/init.d/airpi-fancontrol

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/airpi-fan $(1)/etc/config/airpi-fan

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/fancts.sh $(1)/usr/bin/fancts.sh
	$(INSTALL_BIN) ./files/usr/bin/get_sys_temp.sh $(1)/usr/bin/get_sys_temp.sh

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) ./files/usr/lib/lua/luci/controller/airpi-fancontrol.lua $(1)/usr/lib/lua/luci/controller/airpi-fancontrol.lua

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi
	$(INSTALL_DATA) ./files/usr/lib/lua/luci/model/cbi/airpi-fancontrol.lua $(1)/usr/lib/lua/luci/model/cbi/airpi-fancontrol.lua

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/view/airpi-fancontrol
	$(INSTALL_DATA) ./files/usr/lib/lua/luci/view/airpi-fancontrol/fan_status.htm $(1)/usr/lib/lua/luci/view/airpi-fancontrol/fan_status.htm
endef

$(eval $(call BuildPackage,luci-app-airpi-fancontrol))
$(eval $(call KernelPackage,airpi-gpio-fan))
