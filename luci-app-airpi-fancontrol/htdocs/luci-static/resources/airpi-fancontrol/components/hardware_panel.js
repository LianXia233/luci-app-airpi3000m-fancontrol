'use strict';
'require airpi-fancontrol.utils';
'require airpi-fancontrol.api';
'require airpi-fancontrol.components.icons';

/*
 * airpi-fancontrol / components.hardware-panel
 * 硬件与驱动面板：eMMC 规格 / PWM 通道 / 软 PWM 模块 / 驱动探测结果，
 * 以及服务生命周期操作（启动/停止/重启/重载驱动）。
 */

function kvRow(label, value, badge) {
	return E('div', { 'style': 'display:flex;justify-content:space-between;gap:8px;padding:5px 0;font-size:12.5px;border-bottom:1px dashed var(--afc-border)' }, [
		E('span', { 'style': 'color:var(--afc-fg-sub)' }, label),
		badge ? E('span', { 'class': badge }) : E('span', { 'style': 'font-weight:600;text-align:right' }, value)
	]);
}

function hwRow(name, value, ok) {
	var cls = ok === undefined ? '' : (ok ? 'afc-badge afc-badge-ok' : 'afc-badge afc-badge-err');
	return kvRow(name, String(value === undefined || value === '' ? '--' : value), cls || null);
}

function build(state, actions) {
	var hw = state.hw || {};

	var infoCard = E('div', { 'class': 'afc-card' }, [
		E('div', { 'class': 'afc-card-head' }, [
			E('div', { 'class': 'afc-card-title' }, [
				E('span', { 'html': icons.chip }),
				_('硬件与驱动状态')
			]),
			E('span', { 'class': 'afc-card-sub' }, _('airpi-fanctl hwdetect'))
		]),
		E('div', {}, [
			hwRow(_('eMMC 规格'), hw.emmc_size ? (hw.emmc_size + 'G') : null,
				hw.emmc_size && utils.toInt(hw.emmc_size, 0) >= 25),
			hwRow(_('硬件 PWM'), hw.hw_pwm || hw.hw_pwm_enable || hw.pwmchip0,
				!(hw.hw_pwm === '0' || hw.hw_pwm === 'disabled')),
			hwRow(_('PWM 通道'), hw.pwmchip || ''),
			hwRow(_('软 PWM 模块'), hw.softpwm_loaded === '1' ? _('已加载') : _('未加载'),
				hw.softpwm_loaded === '1'),
			hwRow(_('当前占空比'), hw.duty || hw.fanspd || ''),
			hwRow(_('GPIO 引脚'), hw.gpio || hw.fan_gpio || ''),
			hwRow(_('驱动状态'), hw.driver ? String(hw.driver) : '')
		])
	]);

	var serviceCard = E('div', { 'class': 'afc-card' }, [
		E('div', { 'class': 'afc-card-head' }, [
			E('div', { 'class': 'afc-card-title' }, [
				E('span', { 'html': icons.service }),
				_('服务管理')
			]),
			E('span', { 'class': 'afc-card-sub' }, _('/etc/init.d/airpi-fancontrol'))
		]),
		E('div', { 'class': 'afc-actions' }, [
			E('button', { 'type': 'button', 'class': 'afc-btn', 'data-act': 'start' }, _('启动')),
			E('button', { 'type': 'button', 'class': 'afc-btn', 'data-act': 'stop' }, _('停止')),
			E('button', { 'type': 'button', 'class': 'afc-btn', 'data-act': 'restart' }, _('重启')),
			E('button', { 'type': 'button', 'class': 'afc-btn afc-btn--primary', 'data-act': 'reload' }, _('重载驱动'))
		])
	]);

	serviceCard.querySelectorAll('button[data-act]').forEach(function(btn) {
		btn.addEventListener('click', function() {
			var act = btn.dataset.act;
			btn.disabled = true;
			var p = (act === 'reload') ? api.reloadDriver() : api.service(act);
			p.then(function() {
				actions.onServiceDone(act);
			}).catch(function(e) {
				actions.onServiceError(act, e);
			}).finally(function() {
				btn.disabled = false;
			});
		});
	});

	return E('div', { 'class': 'afc-grid' }, [infoCard, serviceCard]);
}

return { build: build };
