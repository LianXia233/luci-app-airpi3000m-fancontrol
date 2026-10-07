'use strict';
'require view';
'require ui';
'require dom';
'require airpi-fancontrol.utils';
'require airpi-fancontrol.api';
'require airpi-fancontrol.state';
'require airpi-fancontrol.runtime';
'require airpi-fancontrol.config';
'require airpi-fancontrol.styles.theme';
'require airpi-fancontrol.components.status_bar';
'require airpi-fancontrol.components.control_panel';
'require airpi-fancontrol.components.sensor_grid';
'require airpi-fancontrol.components.curve_chart';
'require airpi-fancontrol.components.hardware_panel';
'require airpi-fancontrol.components.config_panel';

/*
 * AirPi 风扇控制 · LuCI View
 * 菜单路径: 状态 → 风扇控制 (admin/status/airpi-fancontrol)
 * view path: airpi-fancontrol/fancontrol   （保持兼容，禁止修改）
 *
 * 架构：本文件仅负责页面组装与生命周期编排；
 *  RPC → api.js，状态 → state.js，轮询 → runtime.js，
 *  UCI → config.js，UI → components/*，样式 → styles/theme.js。
 */

var self;

return view.extend({
	refs: null,

	/* 快速返回：立即渲染骨架，运行数据由 runtime 异步填充 */
	load: function() {
		return Promise.resolve([]);
	},

	notify: function(text, level) {
		ui.addNotification(null,
			E('p', {}, text), level || 'info');
	},

	render: function() {
		self = this;
		this.refs = {};

		var noticeHost = E('div', { 'id': 'afc-notice-host' });
		var statusHost = E('div', { 'id': 'afc-status-host' });
		var curveHost = E('div', { 'id': 'afc-curve-host' });
		var sensorHost = E('div', { 'id': 'afc-sensor-host' });
		var hwHost = E('div', { 'id': 'afc-hw-host' });
		var cfgHost = E('div', { 'id': 'afc-cfg-host' });

		this.refs.noticeHost = noticeHost;
		this.refs.statusHost = statusHost;
		this.refs.curveHost = curveHost;
		this.refs.sensorHost = sensorHost;
		this.refs.hwHost = hwHost;
		this.refs.cfgHost = cfgHost;

		/* 控制面板：带交互状态，只构建一次 */
		var ctrl = control_panel.build({
			onAuto: function() {
				api.setAuto().then(function() {
					self.notify(_('已切换到自动温控模式'), 'info');
					self.refreshNow();
				}).catch(function(e) {
					self.notify(_('切换自动模式失败: ') + e.message, 'error');
				});
			},
			onManual: function(speed, code) {
				api.setSpeed(speed, code).then(function() {
					self.notify(_('已设定手动转速 ') + speed, 'info');
					self.refreshNow();
				}).catch(function(e) {
					self.notify(_('设定转速失败: ') + e.message, 'error');
				});
			},
			onStepless: function(speed) {
				api.setStepless(speed).then(function() {
					self.refreshNow();
				}).catch(function() {});
			}
		});
		this.refs.ctrl = ctrl;

		/* 配置面板：只构建一次，数据异步装载 */
		var cfg = config_panel.build({
			onSaved: function(vals) {
				self.notify(_('配置已保存 (驱动: ') + vals.fan_driver + ', GPIO: ' +
					vals.fan_gpio + ', 周期: ' + vals.fan_freq + 'μs)', 'info');
			},
			onReloaded: function() {
				self.notify(_('驱动已重新加载'), 'info');
				self.refreshNow();
			},
			onSaveError: function(e) {
				self.notify(_('保存配置失败: ') + e.message, 'error');
			}
		});
		this.refs.cfg = cfg;

		/* 状态订阅：数据到达时刷新只读展示区 */
		state.subscribe(function(st) {
			if (st.status !== null)
				dom.content(statusHost, status_bar.build(st));
			if (st.status !== null)
				dom.content(curveHost, curve_chart.build(st));
			if (st.temps !== null)
				dom.content(sensorHost, sensor_grid.build(st.temps));
			if (st.hw !== null) {
				var key = JSON.stringify([
					st.hw.driver, st.hw.softpwm_loaded, st.hw.emmc_size,
					st.hw.hw_pwm, st.hw.pwmchip, st.hw.gpio
				]);
				if (hwHost.firstChild === null || key !== self._hwKey)
					self.updateHwHost(st);
				self._hwKey = key;
			}

			self.updateControlUI(st);
			self.updateNotice(st);
		});

		/* 运行数据注入 */
		runtime.setHandlers({
			onResults: function(results) {
				var st = state.get();
				if (results[0].stdout) st.status = utils.parseKV(results[0].stdout);
				if (results[1].stdout) st.temp = utils.parseKV(results[1].stdout);
				if (results[2].stdout) st.temps = utils.parseKV(results[2].stdout);
				if (results[3].stdout) st.hw = utils.parseKV(results[3].stdout);
				st.lastRefresh = Date.now();
				state.set({
					status: st.status,
					temp: st.temp,
					temps: st.temps,
					hw: st.hw
				});
			}
		});

		/* 挂载完成后：启动轮询 + 异步装载配置（延迟到 DOM 挂载后执行） */
		window.setTimeout(function() {
			if (self.refs.ctrl)
				self.refs.ctrl.setSlider(128);
			runtime.start();
			config.load().then(function() {
				return self.refs.cfg ? self.refs.cfg.loadInto() : null;
			}).catch(function(e) {
				self.notify(_('读取 UCI 配置失败: ') + e.message, 'error');
			});
		}, 0);

		return E('div', { 'class': 'afc-page' }, [
			E('style', { 'type': 'text/css' }, theme.CSS),
			noticeHost,
			statusHost,
			E('div', { 'class': 'afc-grid' }, [
				ctrl.card,
				E('div', { 'class': 'afc-grid' }, [
					curveHost,
					sensorHost
				])
			]),
			hwHost,
			cfgHost
		]);
	},

	refreshNow: function() {
		runtime.collect().then(function(results) {
			var st = state.get();
			if (results[0].stdout) st.status = utils.parseKV(results[0].stdout);
			if (results[1].stdout) st.temp = utils.parseKV(results[1].stdout);
			if (results[2].stdout) st.temps = utils.parseKV(results[2].stdout);
			if (results[3].stdout) st.hw = utils.parseKV(results[3].stdout);
			state.set({
				status: st.status,
				temp: st.temp,
				temps: st.temps,
				hw: st.hw
			});
		}).catch(function() {});
	},

	updateHwHost: function(st) {
		var hw = hardware_panel.build(st, {
			onServiceDone: function(act) {
				self.notify(_('服务操作成功: ') + act, 'info');
				self.refreshNow();
			},
			onServiceError: function(act, e) {
				self.notify(_('服务操作失败: ') + act + ' - ' + e.message, 'error');
			}
		});
		dom.content(this.refs.hwHost, hw);
	},

	updateControlUI: function(st) {
		var ctrl = this.refs.ctrl;
		if (!ctrl)
			return;
		var mode = (st.status || {}).mode;
		var spd = utils.toInt((st.status || {}).fanspd, 0);

		if (mode === '智能' || mode === 'auto') {
			ctrl.segBtns('auto');
			ctrl.highlight(null);
		} else if (mode === '无极' || mode === 'stepless') {
			ctrl.segBtns('stepless');
			ctrl.highlight(null);
			ctrl.setSlider(spd);
		} else {
			ctrl.segBtns('manual');
			var key = null;
			control_panel.MODES.forEach(function(m) {
				if (m.speed === spd)
					key = m.key;
			});
			ctrl.highlight(key);
		}
	},

	updateNotice: function(st) {
		var host = this.refs.noticeHost;
		if (!host)
			return;
		var statusEmpty = st.status === null;
		var tempMissing = st.temp === null || !st.temp.temp || st.temp.temp === 'null';

		if (statusEmpty) {
			dom.content(host, E('div', { 'class': 'afc-notice afc-notice--loading' }, [
				E('span', { 'class': 'afc-spinner' }),
				_('正在加载运行状态…')
			]));
			return;
		}
		if (tempMissing) {
			dom.content(host, E('div', { 'class': 'afc-notice afc-notice--warn' }, [
				E('span', { 'class': 'afc-badge-dot' }),
				_('温度传感器暂不可用，温控曲线等待采样数据。')
			]));
			return;
		}
		dom.content(host, '');
	}
});
