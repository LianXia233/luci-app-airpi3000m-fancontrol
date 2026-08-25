#
# Copyright (C) 2024-2026 AirPi OpenWrt Community
# This is free software, licensed under the GNU General Public License v2.
#
# luci-app-airpi-fancontrol
#   Fan control web UI for the AirPi AP3000M (MediaTek MT7981B / filogic).
#
# v4.0.0: rewritten as a modern client-side (JS) LuCI application.
# The legacy Lua controller stack (luci-compat / luci-lua-runtime) was
# removed from immortalwrt master and recent OpenWrt snapshots, so the
# Lua version can no longer be installed there. The JS frontend works on
# both new (immortalwrt master, kernel 6.18) and older (24.10) trees.
#
# Deliberately built on plain package.mk instead of luci.mk so that the
# repository can be dropped into any OpenWrt/ImmortalWrt SDK's package/
# directory without requiring the LuCI feed build system (luci.mk).
# The Rust helper is built with the packages feed rust-package.mk.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-airpi-fancontrol
PKG_VERSION:=5.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=AirPi Community
PKG_LICENSE:=GPL-2.0-only
PKG_BUILD_DEPENDS:=rust/host
PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/rust/rust-package.mk

MAKE_PATH:=.

define Package/$(PKG_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for AirPi AP3000M fan control
  DEPENDS:=$(RUST_ARCH_DEPENDS) +luci-base +kmod-hwmon-pwmfan
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
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./src/Cargo.toml ./src/Cargo.lock ./src/src $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(call Build/Compile/Cargo)
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/airpi-fancontrol $(1)/etc/init.d/airpi-fancontrol

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/airpi-fan $(1)/etc/config/airpi-fan

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/bin/airpi-fanctl $(1)/usr/bin/airpi-fanctl
	$(INSTALL_BIN) ./files/usr/bin/airpi-fanctl.sh $(1)/usr/bin/airpi-fanctl.sh
	$(INSTALL_BIN) ./files/usr/bin/get_sys_temp.sh $(1)/usr/bin/get_sys_temp.sh

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-airpi-fancontrol.json \
		$(1)/usr/share/luci/menu.d/luci-app-airpi-fancontrol.json

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-airpi-fancontrol.json \
		$(1)/usr/share/rpcd/acl.d/luci-app-airpi-fancontrol.json

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/airpi-fancontrol
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/airpi-fancontrol/fancontrol.js \
		$(1)/www/luci-static/resources/view/airpi-fancontrol/fancontrol.js
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/airpi-fancontrol/settings.js \
		$(1)/www/luci-static/resources/view/airpi-fancontrol/settings.js
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/airpi-fancontrol enable >/dev/null 2>&1
/etc/init.d/rpcd reload >/dev/null 2>&1
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.json /tmp/luci-modulecache/* 2>/dev/null
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
