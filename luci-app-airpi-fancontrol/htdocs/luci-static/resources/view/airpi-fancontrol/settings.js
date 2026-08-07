'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require uci';

/*
 * luci-app-airpi-fancontrol - settings view (v4.0.0, JS rewrite)
 * Replaces the legacy Lua CBI model. Hardware detection is done by
 * /usr/bin/airpi-fanctl.sh hwdetect and rendered as status cards.
 */

var CTL = '/usr/bin/airpi-fanctl.sh';

function parseKV(s) {
	var o = {};
	String(s || '').split('\n').forEach(function(l) {
		var i = l.indexOf('=');
		if (i > 0)
			o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
	});
	return o;
}

function card(title, accent, bg, icon, status, detail) {
	return '<td style="width:33%;padding:10px 12px;border-radius:6px;background:' + bg +
		';border-left:3px solid ' + accent + ';vertical-align:top">' +
		'<div style="font-size:11px;color:#888;margin-bottom:3px">' + title + '</div>' +
		'<div style="font-size:13px;font-weight:600;color:#333">' + icon + ' ' + status + '</div>' +
		'<div style="font-size:11px;color:' + accent + ';margin-top:3px">' + detail + '</div></td>';
}

return view.extend({
	load: function() {
		return Promise.all([
			fs.exec(CTL, ['hwdetect']).then(function(r) { return r.stdout || ''; }).catch(function() { return ''; }),
			uci.load('airpi-fan')
		]);
	},

	buildStatusHtml: function(hw) {
		var emmcIs16g = (parseInt(hw.emmc_sectors, 10) || 0) > 25000000;
		var emmcColor = emmcIs16g ? '#0891b2' : '#8b5cf6';
		var emmcBg = emmcIs16g ? '#ecfeff' : '#f5f3ff';
		var emmcCard = card(_('eMMC 闪存'), emmcColor, emmcBg,
			(hw.emmc_gb || '?') + 'GB', _('版本'),
			emmcIs16g ? _('仅支持软件PWM') : _('仅支持硬件PWM'));

		var hwCard;
		if (hw.hw_pwm && hw.hw_pwm !== 'none') {
			hwCard = card(_('硬件 PWM'), '#16a34a', '#f0fdf4', '&#10003;', _('可用'), hw.hw_pwm);
		}
		else {
			hwCard = card(_('硬件 PWM'), '#dc2626', '#fef2f2', '&#10007;', _('不可用'),
				emmcIs16g ? _('16GB版本仅支持软件PWM') : _('未检测到PWM控制器'));
		}

		var swCard;
		if (hw.softpwm_loaded === '1') {
			var detail = 'airpi_gpio_fan';
			if (hw.duty && hw.duty !== 'na')
				detail += ' | duty=' + hw.duty;
			swCard = card(_('软件 PWM'), '#16a34a', '#f0fdf4', '&#10003;', _('已加载'), detail);
		}
		else {
			swCard = card(_('软件 PWM'), '#ea580c', '#fff7ed', '&#9888;', _('未加载'), _('点击下方按钮加载模块'));
		}

		return '<div style="display:table;width:100%;border-spacing:6px"><div style="display:table-row">' +
			emmcCard + hwCard + swCard + '</div></div>';
	},

	render: function(data) {
		var hw = parseKV(data[0]);
		var self = this;
		var m, s, o;

		m = new form.Map('airpi-fan', _('风扇设置'),
			_('AirPi AP3000M 风扇驱动与温控参数设定。硬件PWM使用内核 pwm-fan 驱动,软件PWM使用 airpi_gpio_fan 内核模块。'));

		s = m.section(form.TypedSection, 'fan', _('风扇驱动与参数设定'));
		s.anonymous = true;
		s.addremove = false;

		s.tab('fanst', _('驱动设置'));

		/* ---- 驱动状态卡片 ---- */
		o = s.taboption('fanst', form.DummyValue, '_driver_status', _('当前驱动状态'));
		o.rawhtml = true;
		o.cfgvalue = function() { return self.buildStatusHtml(hw); };

		/* ---- 驱动模式选择 ---- */
		o = s.taboption('fanst', form.ListValue, 'fan_driver', _('风扇驱动模式'),
			_('自动模式:根据eMMC闪存容量自动选择驱动(16GB→软件PWM,8GB→硬件PWM),无法检测时回退路径探测。硬件PWM:使用内核 pwm-fan 驱动,通过 /sys/class/hwmon/ 接口控制。软件PWM:加载 airpi_gpio_fan.ko 内核模块,通过 /sys/kernel/duty_cycle 控制。'));
		o.value('auto', _('自动识别(推荐)'));
		o.value('pwm', _('硬件PWM驱动'));
		o.value('softpwm', _('软件PWM驱动'));
		o.default = 'auto';

		/* ---- 硬件 PWM 信息 ---- */
		o = s.taboption('fanst', form.DummyValue, '_hw_pwm_desc', _('硬件PWM说明'));
		o.rawhtml = true;
		o.depends('fan_driver', 'pwm');
		o.cfgvalue = function() {
			if (hw.hw_pwm && hw.hw_pwm !== 'none')
				return '<span style="color:green">' + _('已检测到硬件PWM接口') + ': <b>' + hw.hw_pwm + '</b></span>';
			return '<span style="color:red">' + _('未检测到硬件PWM接口!请确认设备树已配置 pwm-fan 节点。') + '</span>';
		};

		o = s.taboption('fanst', form.DummyValue, '_hwmon_pwm_path', _('PWM节点路径'));
		o.depends('fan_driver', 'pwm');
		o.cfgvalue = function() {
			return (hw.hw_pwm && hw.hw_pwm !== 'none') ? hw.hw_pwm : _('(未找到可写pwm1节点)');
		};

		/* ---- 软件 PWM 信息 ---- */
		o = s.taboption('fanst', form.DummyValue, '_sw_kernel_status', _('软PWM内核模块'));
		o.rawhtml = true;
		o.depends('fan_driver', 'softpwm');
		o.cfgvalue = function() {
			return hw.softpwm_loaded === '1'
				? '<span style="color:green;font-weight:bold">✔ airpi_gpio_fan ' + _('已加载') + '</span>'
				: '<span style="color:red;font-weight:bold">✖ airpi_gpio_fan ' + _('未加载 — 保存配置后点击下方按钮加载') + '</span>';
		};

		o = s.taboption('fanst', form.DummyValue, '_sw_duty_display', _('当前占空比'));
		o.depends('fan_driver', 'softpwm');
		o.cfgvalue = function() {
			return (hw.duty && hw.duty !== 'na') ? hw.duty : _('(不可用)');
		};

		o = s.taboption('fanst', form.Value, 'fan_gpio', _('风扇GPIO编号'),
			_('软PWM使用的GPIO引脚编号。AP3000M 默认 GPIO 540 (gpiochip512 offset 28, 标签 airpi-fan-pwm)。'));
		o.datatype = 'uinteger';
		o.default = '540';
		o.placeholder = '540';
		o.depends('fan_driver', 'softpwm');

		o = s.taboption('fanst', form.Value, 'fan_freq', _('PWM周期(μs)'),
			_('PWM信号周期,单位微秒。默认15000μs≈66.7Hz。值越大低频噪音越明显但CPU占用越低。'));
		o.datatype = 'uinteger';
		o.default = '15000';
		o.placeholder = '15000';
		o.depends('fan_driver', 'softpwm');

		/* ---- 重新加载驱动按钮 ---- */
		o = s.taboption('fanst', form.Button, '_apply_driver', _('重新加载驱动'),
			_('保存配置后点击此按钮,根据所选驱动模式重载对应的内核模块。'));
		o.inputtitle = _('立即重新加载');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return uci.save().then(function() {
				return fs.exec(CTL, ['reload']);
			}).then(function(res) {
				var kv = parseKV(res.stdout || '');
				ui.addNotification(null,
					E('p', {}, kv.msg || _('驱动已重新加载')), 'info');
				window.setTimeout(function() { window.location.reload(); }, 1200);
			}).catch(function(e) {
				ui.addNotification(null,
					E('p', {}, _('重载失败: ') + (e && e.message ? e.message : e)), 'error');
			});
		};

		return m.render();
	}
});
