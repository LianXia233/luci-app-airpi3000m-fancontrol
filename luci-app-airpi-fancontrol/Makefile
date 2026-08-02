#
# Copyright (C) 2024-2026 AirPi OpenWrt Community
# This is free software, licensed under the GNU General Public License v2.
#
# luci-app-airpi-fancontrol
#   Fan control web UI for the AirPi AP3000M (MediaTek MT7981B / filogic).
#
# Deliberately built on plain package.mk instead of luci.mk so that the
# repository can be dropped into any OpenWrt SDK's package/ directory
# without requiring the LuCI feed source tree to be present.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-airpi-fancontrol
PKG_VERSION:=3.2.0
PKG_RELEASE:=1

PKG_MAINTAINER:=AirPi Community
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for AirPi AP3000M fan control
  PKGARCH:=all
  DEPENDS:=+luci-compat +luci-lua-runtime +kmod-hwmon-pwmfan
  URL:=https://github.com/LianXia233/luci-app-airpi3000m-fancontrol
endef

define Package/$(PKG_NAME)/description
  Temperature driven fan control for the AirPi AP3000M 5G CPE.

  Supports both the hardware PWM fan (pwm-fan / hwmon) and the GPIO
  soft-PWM driver provided by kmod-airpi-gpio-fan. Offers manual,
  stepless and automatic temperature-curve modes from the LuCI web UI.
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/airpi-fan
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/airpi-fancontrol $(1)/etc/init.d/airpi-fancontrol

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/airpi-fan $(1)/etc/config/airpi-fan

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/fancts.sh $(1)/usr/bin/fancts.sh
	$(INSTALL_BIN) ./files/usr/bin/get_sys_temp.sh $(1)/usr/bin/get_sys_temp.sh

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) ./files/usr/lib/lua/luci/controller/airpi-fancontrol.lua \
		$(1)/usr/lib/lua/luci/controller/airpi-fancontrol.lua

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi
	$(INSTALL_DATA) ./files/usr/lib/lua/luci/model/cbi/airpi-fancontrol.lua \
		$(1)/usr/lib/lua/luci/model/cbi/airpi-fancontrol.lua

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/view/airpi-fancontrol
	$(INSTALL_DATA) ./files/usr/lib/lua/luci/view/airpi-fancontrol/fan_status.htm \
		$(1)/usr/lib/lua/luci/view/airpi-fancontrol/fan_status.htm
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/airpi-fancontrol enable >/dev/null 2>&1
rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/airpi-fancontrol stop >/dev/null 2>&1
/etc/init.d/airpi-fancontrol disable >/dev/null 2>&1
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
