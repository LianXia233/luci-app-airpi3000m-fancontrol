'use strict';
'require airpi-fancontrol.utils';
'require airpi-fancontrol.components.icons';

/*
 * airpi-fancontrol / components.curve-chart
 * 温度曲线可视化：展示自动模式温控阶梯（64/128/192/255）与当前温度落点。
 * 与 Rust daemon 的档位码逻辑保持一致：
 *   >85°C -> 255, >60°C -> 192, >50°C -> 128, 否则 64。
 */

var STEPS = [
	{ below: 50, duty: 64, label: '64' },
	{ below: 60, duty: 128, label: '128' },
	{ below: 85, duty: 192, label: '192' },
	{ below: 1000, duty: 255, label: '255' }
];

var W = 560, H = 180;
var M = { top: 18, right: 18, bottom: 26, left: 40 };
var CW = W - M.left - M.right;
var CH = H - M.top - M.bottom;
var TEMP_MIN = 30, TEMP_MAX = 95;

function x(t) { return M.left + (t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN) * CW; }
function y(d) { return M.top + (1 - d / 255) * CH; }

function svgPath() {
	var parts = [];
	parts.push('M ' + x(TEMP_MIN) + ' ' + y(64));
	parts.push('L ' + x(50) + ' ' + y(64));
	parts.push('L ' + x(50) + ' ' + y(128));
	parts.push('L ' + x(60) + ' ' + y(128));
	parts.push('L ' + x(60) + ' ' + y(192));
	parts.push('L ' + x(85) + ' ' + y(192));
	parts.push('L ' + x(85) + ' ' + y(255));
	parts.push('L ' + x(TEMP_MAX) + ' ' + y(255));
	return parts.join(' ');
}

function gridLines() {
	var lines = '';
	[50, 60, 85].forEach(function(t) {
		lines += '<line x1="' + x(t).toFixed(1) + '" y1="' + M.top + '" x2="' + x(t).toFixed(1) +
			'" y2="' + (M.top + CH) + '" stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="4 4"/>';
	});
	return lines;
}

function axisLabels() {
	var labels = '';
	[30, 40, 50, 60, 70, 80, 90].forEach(function(t) {
		labels += '<text x="' + x(t).toFixed(1) + '" y="' + (M.top + CH + 16) +
			'" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity="0.55">' + t + '</text>';
	});
	return labels;
}

function dutyLabels() {
	var labels = '';
	[64, 128, 192, 255].forEach(function(d) {
		labels += '<text x="' + (M.left - 6) + '" y="' + (y(d) + 3) +
			'" text-anchor="end" font-size="10" fill="currentColor" fill-opacity="0.55">' + d + '</text>';
	});
	return labels;
}

function build(state) {
	var st = state.status || {};
	var tp = state.temp || {};
	var spd = utils.toInt(st.fanspd, utils.toInt(st.fanval, 0));
	var tempVal = tp.temp && tp.temp !== 'null' ? utils.toInt(tp.temp, 0) : null;

	var marker = '';
	if (tempVal !== null && tempVal >= TEMP_MIN && tempVal <= TEMP_MAX) {
		marker = '<circle cx="' + x(tempVal).toFixed(1) + '" cy="' + y(spd).toFixed(1) +
			'" r="5" fill="#0284c7" stroke="#fff" stroke-width="2"/>' +
			'<text x="' + x(tempVal).toFixed(1) + '" y="' + (y(spd) - 9).toFixed(1) +
			'" text-anchor="middle" font-size="11" font-weight="700" fill="#0284c7">' +
			tempVal + '°C</text>';
	}

	var legend = E('div', { 'class': 'afc-card-sub' }, _('温控阶梯: ') +
		'≤50°C→64 · ≤60°C→128 · ≤85°C→192 · >85°C→255');

	var svg = E('div', { 'class': 'afc-curve', 'html':
		'<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + _('温度-转速曲线') + '">' +
		'<defs><linearGradient id="afc-curve-fill" x1="0" y1="0" x2="0" y2="1">' +
		'<stop offset="0%" stop-color="#0284c7" stop-opacity="0.20"/>' +
		'<stop offset="100%" stop-color="#0284c7" stop-opacity="0.02"/></linearGradient></defs>' +
		'<path d="' + svgPath() + ' L ' + x(TEMP_MAX) + ' ' + (M.top + CH) + ' L ' + x(TEMP_MIN) + ' ' + (M.top + CH) + ' Z" fill="url(#afc-curve-fill)"/>' +
		gridLines() +
		'<path d="' + svgPath() + '" fill="none" stroke="#0284c7" stroke-width="2.5" stroke-linejoin="round"/>' +
		axisLabels() + dutyLabels() + marker +
		'<text x="' + (W - 14) + '" y="' + (M.top - 6) + '" text-anchor="end" font-size="10" fill="currentColor" fill-opacity="0.5">' + _('PWM 占空比') + '</text>' +
		'</svg>'
	});

	return E('div', { 'class': 'afc-card' }, [
		E('div', { 'class': 'afc-card-head' }, [
			E('div', { 'class': 'afc-card-title' }, [
				E('span', { 'html': icons.activity }),
				_('温度 · 转速曲线')
			]),
			legend
		]),
		svg
	]);
}

return {
	build: build,
	STEPS: STEPS
};
