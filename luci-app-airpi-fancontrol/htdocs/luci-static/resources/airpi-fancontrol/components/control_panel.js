'use strict';
'require airpi-fancontrol.utils';
'require airpi-fancontrol.components.icons';

/*
 * airpi-fancontrol / components.control-panel
 * 控制面板：模式分段选择（自动/手动/无极）+ 四档快捷转速 + 无极滑块。
 *
 * 回调约定：
 *   opts.onAuto()      切换到自动模式
 *   opts.onManual(speed, code)  设定手动档位
 *   opts.onStepless(speed)  设定无极速度（防抖后触发）
 *   opts.onModeChange(mode)  UI 层模式切换通知（auto/manual/stepless）
 */

var MODES = [
	{ key: 'silent', speed: 64, code: 0, name: _('静音'), meta: '25%' },
	{ key: 'cruise', speed: 128, code: 1, name: _('巡航'), meta: '50%' },
	{ key: 'cool', speed: 192, code: 2, name: _('强冷'), meta: '75%' },
	{ key: 'max', speed: 255, code: 3, name: _('全速'), meta: '100%' }
];

var ICON_MAP = { silent: icons.smart, cruise: icons.activity, cool: icons.gauges, max: icons.fan };

function build(opts) {
	var seg = E('div', { 'class': 'afc-segmented' }, [
		E('button', { 'type': 'button', 'data-mode': 'auto' }, _('自动')),
		E('button', { 'type': 'button', 'data-mode': 'manual' }, _('手动')),
		E('button', { 'type': 'button', 'data-mode': 'stepless' }, _('无极'))
	]);

	var modesGrid = E('div', { 'class': 'afc-modes' });
	MODES.forEach(function(m) {
		var b = E('div', { 'class': 'afc-mode', 'data-key': m.key }, [
			E('span', { 'html': ICON_MAP[m.key] || icons.smart }),
			E('span', { 'class': 'afc-mode-name' }, m.name),
			E('span', { 'class': 'afc-mode-meta' }, m.meta)
		]);
		b.addEventListener('click', function() {
			opts.onManual(m.speed, m.code);
			highlight(m.key);
			segBtns('manual');
		});
		modesGrid.appendChild(b);
	});

	var slider = E('input', {
		'type': 'range', 'class': 'afc-slider',
		'min': '0', 'max': '255', 'value': '128'
	});
	var sliderVal = E('span', { 'class': 'afc-kpi-unit' }, 'PWM 128 · 50%');
	var sendStepless = utils.debounce(function() {
		opts.onStepless(utils.toInt(slider.value, 0));
	}, 180);
	slider.addEventListener('input', function() {
		var v = utils.toInt(slider.value, 0);
		sliderVal.textContent = 'PWM ' + v + ' · ' + utils.pct(v) + '%';
		sendStepless();
	});

	var sliderBox = E('div', { 'class': 'afc-slider-wrap' }, [
		E('div', { 'class': 'afc-slider-head' }, [
			E('span', {}, _('线性调速')),
			sliderVal
		]),
		slider
	]);

	var card = E('div', { 'class': 'afc-card' }, [
		E('div', { 'class': 'afc-card-head' }, [
			E('div', { 'class': 'afc-card-title' }, [
				E('span', { 'html': icons.gear }),
				_('风扇控制')
			]),
			seg
		]),
		modesGrid,
		sliderBox
	]);

	function segBtns(mode) {
		seg.querySelectorAll('button').forEach(function(b) {
			b.classList.toggle('active', b.dataset.mode === mode);
		});
	}

	function highlight(key) {
		modesGrid.querySelectorAll('.afc-mode').forEach(function(b) {
			b.classList.toggle('active', b.dataset.key === key);
		});
	}

	seg.addEventListener('click', function(ev) {
		var b = ev.target.closest('button');
		if (!b)
			return;
		var mode = b.dataset.mode;
		segBtns(mode);
		if (mode === 'auto')
			opts.onAuto();
		else if (mode === 'manual')
			opts.onManual(utils.toInt(slider.value, 128), 1);
		else
			opts.onStepless(utils.toInt(slider.value, 128));
	});

	return {
		card: card,
		segBtns: segBtns,
		highlight: highlight,
		setSlider: function(v) {
			v = utils.clamp(utils.toInt(v, 0), 0, 255);
			slider.value = String(v);
			sliderVal.textContent = 'PWM ' + v + ' · ' + utils.pct(v) + '%';
		}
	};
}

return {
	build: build,
	MODES: MODES
};
