'use strict';
'require airpi-fancontrol.utils';
'require airpi-fancontrol.components.icons';

/*
 * airpi-fancontrol / components.sensor-grid
 * 多温区传感器网格：CPU / Wi-Fi / 交换 / 5G 基带温度。
 */

var LABELS = {
	cpu: 'CPU',
	wifi: 'Wi-Fi',
	phy: '交换',
	modem: '5G/基带'
};

function tempColor(t) {
	if (t > 75) return '#ef4444';
	if (t > 55) return '#f59e0b';
	return '#10b981';
}

function build(temps, state) {
	var data = temps || {};
	var maxTemp = -1, maxKey = null;

	Object.keys(LABELS).forEach(function(k) {
		var v = utils.toInt(data[k], NaN);
		if (!isNaN(v) && v > maxTemp) {
			maxTemp = v;
			maxKey = k;
		}
	});

	var card = E('div', { 'class': 'afc-card' }, [
		E('div', { 'class': 'afc-card-head' }, [
			E('div', { 'class': 'afc-card-title' }, [
				E('span', { 'html': icons.temp }),
				_('板载温度传感器')
			]),
			E('span', { 'class': 'afc-card-sub' }, _('实时采样 · 峰值: ') +
				(maxKey ? (LABELS[maxKey] + ' ' + maxTemp + '°C') : '--'))
		]),
		E('div', { 'class': 'afc-sensors' })
	]);

	var grid = card.querySelector('.afc-sensors');

	Object.keys(LABELS).forEach(function(k) {
		var v = utils.toInt(data[k], NaN);
		if (isNaN(v))
			return;
		var cls = v > 75 ? 'afc-sensor hot' : (v > 55 ? 'afc-sensor warm' : 'afc-sensor');
		if (k === maxKey)
			cls += ' hot';
		var color = tempColor(v);
		var pct = utils.clamp(v / 100 * 100, 4, 100);

		grid.appendChild(E('div', { 'class': cls }, [
			E('div', { 'class': 'afc-sensor-name' }, [
				E('span', {}, LABELS[k]),
				k === maxKey ? E('span', { 'style': 'color:' + color + ';font-weight:700' }, 'PEAK') : ''
			]),
			E('div', { 'class': 'afc-sensor-val', 'style': 'color:' + color }, [
				String(v),
				E('small', {}, '°C')
			]),
			E('div', { 'class': 'afc-sensor-bar' }, [
				E('div', { 'class': 'afc-sensor-fill', 'style': 'width:' + pct + '%;background:' + color })
			])
		]));
	});

	if (!grid.childNodes.length) {
		grid.appendChild(E('div', { 'class': 'afc-notice afc-notice--loading' }, [
			E('span', { 'class': 'afc-spinner' }),
			_('等待传感器数据…')
		]));
	}

	return card;
}

return {
	build: build,
	LABELS: LABELS
};
