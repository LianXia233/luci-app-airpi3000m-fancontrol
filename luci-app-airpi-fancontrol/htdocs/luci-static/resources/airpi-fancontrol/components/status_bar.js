'use strict';
'require airpi-fancontrol.utils';
'require airpi-fancontrol.components.icons';

/*
 * airpi-fancontrol / components.status-bar
 * 顶部状态卡带：当前温度 / 风扇转速 / PWM / 运行模式 / 服务状态。
 * 重要运行状态视觉优先，用户打开页面第一眼可判断风扇是否正常。
 */

var FAN_SVG = icons.fan;

function modeBadge(mode) {
	if (mode === '智能' || mode === 'auto')
		return ['智能', 'info'];
	if (mode === '无极' || mode === 'stepless')
		return ['无极', 'warn'];
	return [mode || '手动', 'ok'];
}

function daemonBadge(daemon) {
	if (daemon === 'running' || daemon === '1')
		return ['服务运行中', 'ok'];
	if (daemon === 'stopped' || daemon === '0')
		return ['服务已停止', 'err'];
	return ['服务未知', 'warn'];
}

function driverBadge(driver) {
	if (!driver || driver === 'none' || driver === 'unknown')
		return ['驱动未就绪', 'err'];
	return [driver, 'info'];
}

function buildKpi(label, value, unit, sub) {
	return E('div', { 'class': 'afc-kpi' }, [
		E('div', { 'class': 'afc-kpi-label' }, label),
		E('div', { 'class': 'afc-kpi-value' }, [
			value,
			unit ? E('small', {}, ' ' + unit) : ''
		]),
		sub ? E('div', { 'class': 'afc-kpi-unit' }, sub) : ''
	]);
}

function build(state) {
	var st = state.status || {};
	var tp = state.temp || {};
	var spd = utils.toInt(st.fanspd, utils.toInt(st.fanval, 0));
	var tempVal = tp.temp && tp.temp !== 'null' ? utils.toInt(tp.temp, 0) : null;

	var mb = modeBadge(st.mode);
	var db = daemonBadge(st.daemon);
	var drb = driverBadge(st.driver);

	var fanIcon = E('div', { 'class': 'afc-fan-icon' + (spd > 0 ? ' running' : ''), 'html': FAN_SVG });
	var fanBlock = E('div', { 'class': 'afc-fan' }, [
		fanIcon,
		E('div', {}, [
			E('div', { 'class': 'afc-kpi-label' }, _('风扇状态')),
			E('div', { 'class': 'afc-kpi-value', 'style': 'font-size:18px;margin-top:2px' },
				spd > 0 ? _('运行中') : _('已停止')),
			E('div', { 'class': 'afc-kpi-unit' }, _('当前模式: ') + (mb[0] || '-'))
		])
	]);

	var row = E('div', { 'class': 'afc-kpi-row' }, [
		fanBlock,
		buildKpi(_('当前温度'), tempVal === null ? '--' : String(tempVal), '°C',
			tp.source && tp.source !== 'null' ? _('热源: ') + tp.source : ''),
		buildKpi(_('风扇转速'), String(spd), 'PWM',
			utils.pct(spd) + '% ' + _('占空比')),
		buildKpi(_('驱动模式'), drb[0], '',
			st.driver ? '' : _('由系统自动探测'))
	]);

	var badges = E('div', { 'class': 'afc-header' }, [
		E('div', { 'class': 'afc-header-title' }, [
			E('div', { 'class': 'afc-header-logo', 'html': FAN_SVG }),
			E('div', {}, [
				E('div', { 'class': 'afc-header-h1' }, _('AirPi 风扇控制')),
				E('div', { 'class': 'afc-header-sub' }, _('状态 → 风扇控制 · 温度闭环 PWM 调速'))
			])
		]),
		E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap' }, [
			E('span', { 'class': 'afc-badge afc-badge-' + mb[1] }, [
				E('span', { 'class': 'afc-badge-dot' }), mb[0]
			]),
			E('span', { 'class': 'afc-badge afc-badge-' + db[1] }, [
				E('span', { 'class': 'afc-badge-dot' }), db[0]
			]),
			E('span', { 'class': 'afc-badge afc-badge-' + drb[1] }, [
				E('span', { 'class': 'afc-badge-dot' }), _('驱动: ') + drb[0]
			])
		])
	]);

	return E('div', {}, [badges, row]);
}

return {
	build: build,
	modeBadge: modeBadge,
	daemonBadge: daemonBadge,
	driverBadge: driverBadge
};
