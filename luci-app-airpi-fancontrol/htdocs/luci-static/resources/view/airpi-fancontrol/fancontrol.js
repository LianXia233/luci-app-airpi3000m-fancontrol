'use strict';
'require view';
'require fs';
'require ui';
'require poll';
'require dom';

/*
 * luci-app-airpi-fancontrol - status & control view (v4.0.0, JS rewrite)
 * Replaces the legacy Lua controller + template with a modern client-side
 * LuCI view, required by immortalwrt master (luci-compat was removed).
 * All device interaction goes through /usr/bin/airpi-fanctl.sh (rpcd exec).
 */

var CTL = '/usr/bin/airpi-fanctl.sh';

function ctl(args) {
	return fs.exec(CTL, args);
}

function parseKV(s) {
	var o = {};
	String(s || '').split('\n').forEach(function(l) {
		var i = l.indexOf('=');
		if (i > 0)
			o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
	});
	return o;
}

var CSS = `
.fcx{--ac:#7c5cfc;--cy:#22d3ee;--gn:#34d399;--og:#fbbf24;--rd:#f87171;--pk:#f472b6;
  --c1:rgba(18,21,32,.94);--c2:rgba(26,30,44,.9);--c3:rgba(40,46,66,.7);--bd:rgba(255,255,255,.07);
  --t1:#eef0f6;--t2:#9aa3b8;--t3:#3d4455;--r:18px;
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  color:var(--t1);max-width:760px;margin:0 auto;padding:0 0 30px;position:relative;z-index:1}
@media(prefers-color-scheme:light){
.fcx{--c1:rgba(255,255,255,.98);--c2:rgba(241,244,250,.96);--c3:rgba(232,236,245,.9);--bd:rgba(15,23,42,.08);--t1:#111827;--t2:#5b6477;--t3:#cbd2e0}}
.fcx .hd{display:flex;align-items:center;gap:15px;background:var(--c1);border:1px solid var(--bd);border-radius:var(--r);padding:18px 22px;margin-bottom:16px;box-shadow:0 10px 30px rgba(0,0,0,.16)}
.fcx .hd-logo{width:46px;height:46px;border-radius:13px;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(135deg,#7c5cfc,#22d3ee);box-shadow:0 8px 18px rgba(124,92,252,.42)}
.fcx .hd-logo svg{width:24px;height:24px}
.fcx .hd-tx .hd-m{font-size:18px;font-weight:800;background:linear-gradient(135deg,#a78bfa,#22d3ee,#f472b6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.fcx .hd-tx .hd-s{font-size:11.5px;color:var(--t2);margin-top:3px;letter-spacing:.4px}
.fcx .card{background:var(--c1);border:1px solid var(--bd);border-radius:var(--r);padding:24px;margin-bottom:16px;position:relative;overflow:hidden;transition:border-color .5s,box-shadow .5s;box-shadow:0 10px 30px rgba(0,0,0,.16)}
.fcx .card.cool{border-color:rgba(34,211,238,.2)}.fcx .card.warm{border-color:rgba(251,191,36,.2)}.fcx .card.hot{border-color:rgba(248,113,113,.22)}
.fcx .ftop{display:flex;align-items:center;gap:22px;position:relative;z-index:1}
.fcx .fvis{position:relative;width:130px;height:130px;flex:none;display:flex;align-items:center;justify-content:center}
.fcx .fvis canvas{width:130px!important;height:130px!important;border:none!important;border-radius:50%;background:radial-gradient(circle at 50% 48%,rgba(34,211,238,.14),transparent 68%);margin:0!important;display:block}
.fcx .fring{position:absolute;inset:-7px;pointer-events:none}
.fcx .fring svg{width:144px;height:144px;transform:rotate(-90deg)}
.fcx .fring .bg{fill:none;stroke:var(--t3);stroke-width:3;opacity:.25}
.fcx .fring .fg{fill:none;stroke-width:3;stroke-linecap:round;stroke:var(--cy);transition:stroke-dashoffset .8s ease,stroke .5s}
.fcx .fmeta{flex:1;min-width:0}
.fcx .fmeta .ft{font-size:18px;font-weight:800;color:var(--t1)}
.fcx .fmeta .fsub{font-size:12px;color:var(--t2);margin-top:4px;line-height:1.5}
.fcx .stats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:20px;position:relative;z-index:1}
.fcx .stat{background:var(--c2);border:1px solid var(--bd);border-radius:14px;padding:14px 12px;text-align:center}
.fcx .stat .sl{font-size:11px;color:var(--t2);margin-top:5px;font-weight:600;letter-spacing:.5px}
.fcx .fcx-speed,.fcx .fcx-temp{margin:0;font-size:18px;font-weight:800;line-height:1.2;color:var(--t1)}
.fcx .fcx-temp{color:var(--cy)}
.fcx .sec-t{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--t2);letter-spacing:.6px;margin:22px 0 12px;position:relative;z-index:1;text-transform:uppercase}
.fcx .sec-t svg{width:15px;height:15px;color:var(--cy)}
.fcx .modes{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;position:relative;z-index:1}
.fcx .fcx-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;appearance:none;-webkit-appearance:none;width:100%;box-sizing:border-box;margin:0;padding:15px 8px;font-size:13px;font-weight:700;border-radius:14px;cursor:pointer;color:var(--t1)!important;background:var(--c2)!important;border:1px solid var(--bd);transition:transform .14s,border-color .2s,box-shadow .2s,background .2s}
.fcx .fcx-btn svg{width:22px;height:22px;color:var(--t2);transition:color .2s}
.fcx .fcx-btn:hover{transform:translateY(-2px);border-color:var(--cy);box-shadow:0 10px 22px rgba(34,211,238,.18)}
.fcx .fcx-btn:hover svg{color:var(--cy)}
.fcx .fcx-btn:active{transform:translateY(0)}
.fcx .fcx-btn.active{color:#fff!important;background:linear-gradient(135deg,#0891b2,#06b6d4)!important;border-color:transparent;box-shadow:0 10px 24px rgba(8,145,178,.4)}
.fcx .fcx-btn.active svg{color:#fff}
.fcx .slider-container{display:none;align-items:center;gap:14px;margin-top:16px;padding:15px 18px;border-radius:14px;position:relative;z-index:1;background:linear-gradient(135deg,var(--c2),rgba(34,211,238,.05));border:1px solid rgba(34,211,238,.14)}
.fcx .slider-container.active{display:flex}
.fcx .slider-container .sll{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--cy);white-space:nowrap}
.fcx .slider-container .sll svg{width:15px;height:15px}
.fcx .fcx-slider{flex:1;width:100%;-webkit-appearance:none;appearance:none;height:7px;border-radius:99px;outline:none;cursor:pointer;background:linear-gradient(90deg,rgba(34,211,238,.3),var(--rd))}
.fcx .fcx-slider::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#22d3ee,#0891b2);border:3px solid rgba(255,255,255,.3);box-shadow:0 0 12px rgba(34,211,238,.55);cursor:pointer}
.fcx .fcx-slider::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#22d3ee,#0891b2);border:3px solid rgba(255,255,255,.3);box-shadow:0 0 12px rgba(34,211,238,.55);cursor:pointer}
.fcx .energybar{width:100%;height:9px;margin-top:20px;border-radius:99px;overflow:hidden;background:var(--c2);border:1px solid var(--bd);position:relative;z-index:1}
.fcx .energyfill{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--gn),var(--og),var(--rd));transition:width .6s ease}
.fcx .temp-grid{display:none;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;position:relative;z-index:1}
.fcx .temp-grid.active{display:grid}
.fcx .temp-chip{background:var(--c2);border:1px solid var(--bd);border-radius:10px;padding:8px 10px;text-align:center}
.fcx .temp-chip .tc-label{font-size:10px;color:var(--t2);text-transform:uppercase;letter-spacing:.5px}
.fcx .temp-chip .tc-val{font-size:15px;font-weight:700;color:var(--t1);margin-top:2px}
.fcx .temp-chip.active{border-color:var(--cy);box-shadow:0 0 8px rgba(34,211,238,.25)}
.fcx .temp-chip .tc-unit{font-size:10px;color:var(--t2)}
@media(min-width:768px){
.fcx{max-width:920px}
.fcx .card{padding:30px 34px}
.fcx .ftop{gap:30px}
.fcx .fvis,.fcx .fvis canvas{width:160px;height:160px}
.fcx .fring{inset:-9px}.fcx .fring svg{width:178px;height:178px}
.fcx .fmeta .ft{font-size:21px}.fcx .fmeta .fsub{font-size:13px}
.fcx .stats{grid-template-columns:repeat(2,1fr);gap:16px}
.fcx .stat{padding:18px 16px}
.fcx .fcx-speed,.fcx .fcx-temp{font-size:22px}
.fcx .modes{grid-template-columns:repeat(6,1fr);gap:12px}
.fcx .fcx-btn{padding:16px 8px;font-size:13.5px;border-radius:15px}
.fcx .fcx-btn svg{width:24px;height:24px}
}
@media(max-width:560px){
.fcx .card{padding:18px}
.fcx .ftop{gap:16px}
.fcx .fvis,.fcx .fvis canvas{width:104px;height:104px}
.fcx .fring{inset:-6px}.fcx .fring svg{width:116px;height:116px}
.fcx .modes{grid-template-columns:repeat(3,1fr);gap:9px}
.fcx .fcx-btn{padding:12px 4px;font-size:12px}
.fcx .fcx-btn svg{width:20px;height:20px}
.fcx .fmeta .ft{font-size:16px}
.fcx .temp-grid{grid-template-columns:repeat(2,1fr)}
}`;

var SVG_WRAP = function(inner) {
	return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
};

var ICONS = {
	fan: SVG_WRAP('<line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>'),
	mute: SVG_WRAP('<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
	low: SVG_WRAP('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>'),
	mid: SVG_WRAP('<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>'),
	max: SVG_WRAP('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
	smart: SVG_WRAP('<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>'),
	slider: SVG_WRAP('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
	gauge: SVG_WRAP('<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>')
};

return view.extend({
	currentSpeed: 0,
	currentTemp: 0,
	refs: {},
	animAlive: false,

	load: function() {
		return Promise.all([
			ctl(['status']).catch(function() { return { stdout: '' }; }),
			ctl(['temp']).catch(function() { return { stdout: '' }; }),
			ctl(['temps']).catch(function() { return { stdout: '' }; })
		]);
	},

	makeButton: function(icon, label, handler) {
		var btn = E('button', { 'class': 'fcx-btn', 'type': 'button' }, [
			E('span', { 'style': 'display:flex' }),
			E('span', {}, label)
		]);
		btn.firstChild.innerHTML = icon;
		btn.addEventListener('click', handler);
		btn.dataset.mode = label;
		return btn;
	},

	render: function(data) {
		var self = this;

		var head = E('div', { 'class': 'hd' }, [
			E('div', { 'class': 'hd-logo' }),
			E('div', { 'class': 'hd-tx' }, [
				E('div', { 'class': 'hd-m' }, _('AirPi PWM 智能散热控制台')),
				E('div', { 'class': 'hd-s' }, _('实时转速监控 · 温度联动 · 无极调速'))
			])
		]);
		head.querySelector('.hd-logo').innerHTML = ICONS.fan;

		var canvas = E('canvas', { 'id': 'fcx-fan-canvas', 'width': '200', 'height': '200' });
		var ring = E('div', { 'class': 'fring' });
		ring.innerHTML = '<svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="46"/><circle class="fg" id="fcx-fan-ring" cx="50" cy="50" r="46" stroke-dasharray="289" stroke-dashoffset="289"/></svg>';

		var speedDisplay = E('div', { 'class': 'fcx-speed' }, _('当前转速') + ': 0');
		var tempDisplay = E('div', { 'class': 'fcx-temp' }, '--°C');
		var tempSourceLabel = E('div', { 'class': 'sl' }, _('智能温控'));

		var sliderInput = E('input', {
			'type': 'range', 'class': 'fcx-slider',
			'min': '0', 'max': '255', 'value': '255'
		});
		var sliderBox = E('div', { 'class': 'slider-container' }, [
			E('span', { 'class': 'sll' }, [ E('span', { 'style': 'display:flex' }), _('无极调速') ]),
			sliderInput
		]);
		sliderBox.querySelector('.sll span').innerHTML = ICONS.slider;

		var energyFill = E('div', { 'class': 'energyfill' });
		var tempGrid = E('div', { 'class': 'temp-grid' });
		var card = E('div', { 'class': 'card cool' });

		var modes = E('div', { 'class': 'modes' }, [
			this.makeButton(ICONS.mute, _('静音'), function() { self.setManual(64, 0); }),
			this.makeButton(ICONS.low, _('低速'), function() { self.setManual(128, 1); }),
			this.makeButton(ICONS.mid, _('常规'), function() { self.setManual(192, 2); }),
			this.makeButton(ICONS.max, _('狂暴'), function() { self.setManual(255, 3); }),
			this.makeButton(ICONS.smart, _('智能'), function() { self.setAuto(); }),
			this.makeButton(ICONS.slider, _('无极'), function() { self.toggleStepless(); })
		]);

		card.appendChild(E('div', { 'class': 'ftop' }, [
			E('div', { 'class': 'fvis' }, [ canvas, ring ]),
			E('div', { 'class': 'fmeta' }, [
				E('div', { 'class': 'ft' }, _('内置 PWM 散热风扇')),
				E('div', { 'class': 'fsub' }, _('请勿密封风扇进出风口,以免影响散热'))
			])
		]));
		card.appendChild(E('div', { 'class': 'stats' }, [
			E('div', { 'class': 'stat' }, [ speedDisplay, E('div', { 'class': 'sl' }, _('实时转速')) ]),
			E('div', { 'class': 'stat' }, [ tempDisplay, tempSourceLabel ])
		]));
		card.appendChild(E('div', { 'class': 'sec-t' }, [
			E('span', { 'style': 'display:flex' }), _('运行模式')
		]));
		card.querySelector('.sec-t span').innerHTML = ICONS.gauge;
		card.appendChild(modes);
		card.appendChild(sliderBox);
		card.appendChild(E('div', { 'class': 'energybar' }, [ energyFill ]));
		card.appendChild(tempGrid);

		this.refs = {
			canvas: canvas,
			ring: ring.querySelector('#fcx-fan-ring'),
			speedDisplay: speedDisplay,
			tempDisplay: tempDisplay,
			tempSourceLabel: tempSourceLabel,
			sliderInput: sliderInput,
			sliderBox: sliderBox,
			energyFill: energyFill,
			tempGrid: tempGrid,
			card: card,
			modes: modes
		};

		var debounceTimer = null;
		sliderInput.addEventListener('input', function() {
			var v = parseInt(sliderInput.value, 10) || 0;
			self.updateFanVisual(v);
			if (debounceTimer)
				window.clearTimeout(debounceTimer);
			debounceTimer = window.setTimeout(function() {
				ctl(['stepless', String(v)]).catch(function() {});
			}, 180);
		});

		/* Apply initial data */
		if (data && data[0]) this.applyStatus(parseKV(data[0].stdout));
		if (data && data[1]) this.applyTemp(parseKV(data[1].stdout));
		if (data && data[2]) this.applyTemps(parseKV(data[2].stdout));

		/* Live polling */
		poll.add(L.bind(function() {
			return Promise.all([
				ctl(['status']).catch(function() { return { stdout: '' }; }),
				ctl(['temp']).catch(function() { return { stdout: '' }; }),
				ctl(['temps']).catch(function() { return { stdout: '' }; })
			]).then(function(res) {
				self.applyStatus(parseKV(res[0].stdout));
				self.applyTemp(parseKV(res[1].stdout));
				self.applyTemps(parseKV(res[2].stdout));
			});
		}, this), 5);

		this.animAlive = true;
		/* Defer first draw so the canvas is already attached to the DOM. */
		requestAnimationFrame(L.bind(function() { this.drawFan(); }, this));

		return E('div', {}, [
			E('style', { 'type': 'text/css' }, CSS),
			E('div', { 'class': 'fcx' }, [ head, card ])
		]);
	},

	/* ---------- actions ---------- */

	setManual: function(speed, code) {
		var self = this;
		this.hideSlider();
		this.highlightButton(null);
		this.updateFanVisual(speed);
		return ctl(['set', String(speed), String(code)]).then(function() {
			self.applyStatus({ fanspd: String(speed), mode: _('手动') });
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, _('控制失败: ') + e.message), 'error');
		});
	},

	setAuto: function() {
		var self = this;
		this.hideSlider();
		return ctl(['auto']).then(function() {
			self.applyStatus({ mode: _('智能') });
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, _('控制失败: ') + e.message), 'error');
		});
	},

	toggleStepless: function() {
		var box = this.refs.sliderBox;
		if (box.classList.contains('active')) {
			this.hideSlider();
			return;
		}
		box.classList.add('active');
		this.highlightButton(_('无极'));
		var v = parseInt(this.refs.sliderInput.value, 10) || 255;
		ctl(['stepless', String(v)]).catch(function() {});
	},

	hideSlider: function() {
		if (this.refs.sliderBox)
			this.refs.sliderBox.classList.remove('active');
	},

	highlightButton: function(label) {
		var btns = this.refs.modes.querySelectorAll('.fcx-btn');
		btns.forEach(function(b) {
			b.classList.toggle('active', label !== null && b.dataset.mode === label);
		});
	},

	/* ---------- state application ---------- */

	applyStatus: function(st) {
		var spd = parseInt(st.fanspd, 10);
		if (isNaN(spd))
			spd = 0;

		var label = null;
		if (st.mode === '智能' || st.mode === _('智能')) {
			label = _('智能');
			this.hideSlider();
		}
		else if (st.mode === '无极' || st.mode === _('无极')) {
			label = _('无极');
			this.refs.sliderBox.classList.add('active');
			this.refs.sliderInput.value = String(spd);
		}
		else {
			var map = { 64: _('静音'), 128: _('低速'), 192: _('常规'), 255: _('狂暴') };
			label = map[spd] || null;
			this.hideSlider();
		}
		this.highlightButton(label);
		this.updateFanVisual(spd);
	},

	applyTemp: function(tp) {
		var t = tp.temp;
		if (t && t !== 'null' && t !== '') {
			var tv = parseFloat(t);
			this.updateTempVisual(tv);
			this.refs.tempSourceLabel.textContent =
				(tp.source && tp.source !== _('智能')) ? _('温度源') + ': ' + tp.source : _('智能温控');
		}
		else {
			this.refs.tempDisplay.textContent = '--°C';
			this.refs.tempSourceLabel.textContent = _('获取中…');
		}
	},

	applyTemps: function(temps) {
		var labels = { cpu: 'CPU', wifi: 'WiFi', phy: 'PHY', modem: _('模组温度') };
		var grid = this.refs.tempGrid;
		var maxTemp = -1, maxKey = '';
		Object.keys(labels).forEach(function(k) {
			if (temps[k] !== undefined) {
				var tv = parseInt(temps[k], 10);
				if (!isNaN(tv) && tv > maxTemp) { maxTemp = tv; maxKey = k; }
			}
		});

		dom.content(grid, '');
		var count = 0;
		Object.keys(labels).forEach(function(k) {
			if (temps[k] === undefined)
				return;
			var tv = parseInt(temps[k], 10);
			if (isNaN(tv))
				return;
			var color = tv > 75 ? '#f87171' : (tv > 55 ? '#fbbf24' : '#34d399');
			var chip = E('div', { 'class': 'temp-chip' + (k === maxKey ? ' active' : '') }, [
				E('div', { 'class': 'tc-label' }, labels[k]),
				E('div', { 'class': 'tc-val', 'style': 'color:' + color }, [
					String(tv), E('span', { 'class': 'tc-unit' }, '°C')
				])
			]);
			grid.appendChild(chip);
			count++;
		});
		grid.classList.toggle('active', count > 0);
	},

	/* ---------- visuals ---------- */

	updateFanVisual: function(speed) {
		this.currentSpeed = speed;
		this.refs.speedDisplay.textContent = _('当前转速') + ': ' + speed + '0-RPM';

		var ring = this.refs.ring;
		if (ring) {
			var dash = (speed / 255) * 289;
			ring.setAttribute('stroke-dashoffset', String(289 - dash));
			ring.setAttribute('stroke',
				speed < 100 ? 'var(--cy)' : (speed < 200 ? 'var(--og)' : 'var(--rd)'));
		}
	},

	updateTempVisual: function(temp) {
		this.currentTemp = temp;
		var pct = Math.min(Math.max(temp / 100, 0), 1);
		this.refs.energyFill.style.width = (pct * 100) + '%';
		var red = Math.min(255, Math.floor((temp / 100) * 255));
		var green = 255 - red;
		this.refs.energyFill.style.backgroundColor = 'rgb(' + red + ',' + green + ',0)';

		var card = this.refs.card;
		card.classList.remove('cool', 'warm', 'hot');
		card.classList.add(temp < 50 ? 'cool' : (temp < 75 ? 'warm' : 'hot'));

		this.refs.tempDisplay.textContent = temp + '°C';
	},

	drawFan: function(retry) {
		var self = this;
		var canvas = this.refs.canvas;
		retry = retry || 0;
		if (!canvas || !this.animAlive)
			return;
		if (!document.contains(canvas)) {
			/* Canvas may not be attached yet on the first frame; retry briefly. */
			if (retry < 120)
				requestAnimationFrame(function() { self.drawFan(retry + 1); });
			return;
		}
		var ctx = canvas.getContext('2d');
		if (!ctx)
			return;

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		var cx = canvas.width / 2, cy = canvas.height / 2;
		var bladeLength = 70, bladeWidth = 30, bladeArc = Math.PI / 3.5;
		var arcStartX = bladeLength * Math.sin(bladeArc / 2);
		var arcStartY = -bladeLength * Math.cos(bladeArc / 2);
		var t = Math.min(Math.max(this.currentSpeed / 255, 0), 1);
		var r = Math.floor(34 + t * 221);
		var g = Math.floor(211 - t * 211);
		var b = Math.floor(238 - t * 182);
		var color = 'rgba(' + r + ',' + g + ',' + b + ',0.9)';
		var speedFactor = 0.3 + (t * 3.7);
		var angle = (performance.now() / 150) * speedFactor;

		for (var i = 0; i < 5; i++) {
			ctx.save();
			ctx.translate(cx, cy);
			ctx.rotate(angle + (i * (2 * Math.PI / 5)));
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.quadraticCurveTo(bladeWidth * 0.3, -bladeLength * 0.40, arcStartX, arcStartY);
			ctx.arc(0, 0, bladeLength, -Math.PI / 2 + bladeArc / 2, -Math.PI / 2 - bladeArc / 2, true);
			ctx.quadraticCurveTo(-bladeWidth * 0.3, -bladeLength * 0.40, 0, 0);
			ctx.closePath();
			ctx.fillStyle = color;
			ctx.shadowColor = 'rgba(34,211,238,0.45)';
			ctx.shadowBlur = 10;
			ctx.fill();
			ctx.lineWidth = 1.2;
			ctx.strokeStyle = 'rgba(255,255,255,0.35)';
			ctx.stroke();
			ctx.restore();
		}

		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, 18, 0, 2 * Math.PI);
		ctx.fillStyle = '#e0e0e0';
		ctx.shadowBlur = 4;
		ctx.shadowColor = 'rgba(0,0,0,0.25)';
		ctx.fill();
		ctx.restore();

		requestAnimationFrame(function() { self.drawFan(); });
	}
});
