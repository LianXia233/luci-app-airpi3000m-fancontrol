'use strict';
'require view';
'require fs';
'require ui';
'require poll';
'require form';
'require uci';
'require dom';

/*
 * luci-app-airpi-fancontrol — AirPi AP3000M 温控工作台 (v7.0.0)
 *
 * 设计约束:
 *   - 只展示后端真实提供的数据。硬件没有转速(tach)反馈，因此界面上不出现
 *     "RPM / dBA / CFM"这类推算值，只有设定占空比与接口实测回读。
 *   - 单一轮询回调；容器离开文档时主动 poll.remove，站内导航不残留定时器。
 *   - 不使用 requestAnimationFrame 常驻动画;风扇转动用 CSS 动画，切离页面暂停。
 *   - 动态文本一律走 E()/textContent，不用 innerHTML 拼接设备返回值。
 */

var CTL = '/usr/bin/airpi-fanctl.sh';
var CONFIG = 'airpi-fan';
var SECTION = 'settings';
var POLL_INTERVAL = 5;
var HISTORY_LIMIT = 72;

/* 与后端 Config::default() 一致的出厂值，恢复默认时使用 */
var DEFAULTS = {
	fan_driver: 'auto', fan_gpio: '540', fan_freq: '15000',
	temp_high: '85', duty_high: '255',
	temp_mid: '60', duty_mid: '192',
	temp_low: '50', duty_low: '128',
	duty_idle: '64',
	auto_interval: '8', hysteresis: '2', min_hold: '30',
	temp_crit: '95', crit_guard: '1', fail_duty: '255', fail_count: '3',
	stop_duty: '64',
	src_cpu: '1', src_phy: '1', src_wifi: '1', src_modem: '1',
	slow_interval: '30', log_level: '2'
};

var TABS = [
	{ id: 'overview', label: '运行概览' },
	{ id: 'control', label: '风扇控制' },
	{ id: 'curve', label: '温控策略' },
	{ id: 'sensors', label: '传感器与监控' },
	{ id: 'advanced', label: '高级设置' }
];

var MODE_LABEL = {
	auto: '智能温控',
	manual: '手动档位',
	stepless: '无级调速'
};

var SOURCE_LABEL = {
	cpu: 'CPU 核心',
	phy: '网络交换',
	wifi: 'Wi-Fi 射频',
	modem: '通信模组'
};

function ctl(args) {
	return fs.exec(CTL, args);
}

function parseKV(text) {
	var out = {};
	String(text == null ? '' : text).split('\n').forEach(function(line) {
		var i = line.indexOf('=');
		if (i > 0)
			out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	});
	return out;
}

function num(value, fallback) {
	var n = parseInt(value, 10);
	return isNaN(n) ? fallback : n;
}

function flt(value, fallback) {
	var n = parseFloat(value);
	return isNaN(n) ? fallback : n;
}

/* 状态里的 m℃ 字段: -1 表示无有效读数，不能当成 0 ℃ */
function mcToC(mc) {
	var n = num(mc, -1);
	return n > 0 ? n / 1000 : null;
}

function agoText(seconds) {
	if (seconds == null || seconds < 0)
		return _('尚无数据');
	if (seconds < 2)
		return _('刚刚');
	if (seconds < 60)
		return _('%d 秒前').format(seconds);
	if (seconds < 3600)
		return _('%d 分钟前').format(Math.floor(seconds / 60));
	return _('%d 小时前').format(Math.floor(seconds / 3600));
}

function dutyPct(duty) {
	return Math.round((num(duty, 0) / 255) * 100);
}

function toneForCelsius(c, warn, hot) {
	if (c == null)
		return 'idle';
	if (c >= hot)
		return 'danger';
	if (c >= warn)
		return 'warning';
	if (c >= warn - 15)
		return 'ok';
	return 'good';
}

/* ---------------------------- 图标 (内联 SVG) ---------------------------- */

function icon(paths, size) {
	var s = size || 20;
	return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" ' +
		'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
		'stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}

var ICON = {
	fan: '<circle cx="12" cy="12" r="9.2"/><path d="M12 12c0-3.6 1.4-6.4 4.6-6.9 1.5-.2 2.3 1.2 1.6 2.6-.9 1.9-3 3-6.2 3.3z"/><path d="M12 12c-3.1 1.8-4.5 4.6-3.3 7.6.6 1.4 2.3 1.3 3-.1.9-1.9.6-4.2-.6-7z" transform="rotate(-120 12 12)"/><path d="M12 12c-3.1 1.8-4.5 4.6-3.3 7.6.6 1.4 2.3 1.3 3-.1.9-1.9.6-4.2-.6-7z" transform="rotate(120 12 12)"/><path d="M12 12c-3.1 1.8-4.5 4.6-3.3 7.6.6 1.4 2.3 1.3 3-.1.9-1.9.6-4.2-.6-7z"/><circle cx="12" cy="12" r="1.5"/>',
	gauge: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l4.5-3.5"/><circle cx="12" cy="12" r="1.2"/>',
	temp: '<path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/>',
	slider: '<line x1="4" y1="20" x2="4" y2="12"/><line x1="4" y1="8" x2="4" y2="4"/><line x1="12" y1="20" x2="12" y2="14"/><line x1="12" y1="10" x2="12" y2="4"/><line x1="20" y1="20" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="4"/><line x1="1.5" y1="12" x2="6.5" y2="12"/><line x1="9.5" y1="8" x2="14.5" y2="8"/><line x1="17.5" y1="16" x2="22.5" y2="16"/>',
	curve: '<path d="M3 19h18"/><path d="M3 19V5"/><path d="M6 16h4v-4h5V8h6"/>',
	chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M19 9h3M19 15h3M2 9h3M2 15h3"/>',
	wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.1-2.1z"/>',
	alarm: '<path d="M12 3a6 6 0 0 0-6 6c0 3-1 4.5-2 5.5h16c-1-1-2-2.5-2-5.5a6 6 0 0 0-6-6z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
	refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
	power: '<path d="M12 3v9"/><path d="M6.4 6.4a8 8 0 1 0 11.2 0"/>',
	file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'
};

/* ------------------------------ DOM 构造器 ------------------------------ */

function svgIcon(name, size) {
	var host = E('span', { 'class': 'ap-icon' });
	host.innerHTML = icon(ICON[name], size);
	return host;
}

function card(opts) {
	var head = null;
	if (opts.title) {
		head = E('div', { 'class': 'ap-card-head' }, [
			E('div', { 'class': 'ap-card-title' }, [
				opts.icon ? svgIcon(opts.icon, 16) : '',
				E('span', {}, _(opts.title))
			]),
			opts.meta ? E('div', { 'class': 'ap-card-meta' }, opts.meta) : ''
		]);
	}
	var body = E('div', { 'class': 'ap-card-body' }, opts.body || []);
	return E('section', { 'class': 'ap-card' + (opts.class ? ' ' + opts.class : '') },
		head ? [head, body] : [body]);
}

function statChip(label, value, tone) {
	return E('div', { 'class': 'ap-chip' + (tone ? ' is-' + tone : '') }, [
		E('div', { 'class': 'ap-chip-label' }, label),
		E('div', { 'class': 'ap-chip-value' }, value)
	]);
}

function pill(text, tone) {
	return E('span', { 'class': 'ap-pill is-' + (tone || 'muted') }, text);
}

function rows(pairs) {
	return E('div', { 'class': 'ap-dl' }, pairs.map(function(p) {
		return E('div', { 'class': 'ap-dl-row' }, [
			E('span', { 'class': 'ap-dl-key' }, p[0]),
			E('span', { 'class': 'ap-dl-val' + (p[2] ? ' is-' + p[2] : '') }, p[1])
		]);
	}));
}

/* 风扇视觉: 静态扇叶 + CSS 动画，转速由实测占空比驱动 */
function fanVisual() {
	var host = E('div', { 'class': 'ap-stage' });
	host.innerHTML = '' +
		'<svg viewBox="0 0 200 200" class="ap-fan-svg" xmlns="http://www.w3.org/2000/svg">' +
		'<defs>' +
		'<linearGradient id="apBlade" x1="0" y1="0" x2="1" y2="1">' +
		'<stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>' +
		'<stop offset="55%" stop-color="currentColor" stop-opacity="0.32"/>' +
		'<stop offset="100%" stop-color="currentColor" stop-opacity="0.14"/>' +
		'</linearGradient>' +
		'<path id="apBladeShape" d="M100 100 C 92 78 96 52 116 34 C 132 40 138 66 130 92 C 122 106 110 108 100 100 Z"/>' +
		'</defs>' +
		'<circle cx="100" cy="100" r="94" class="ap-duct"/>' +
		'<circle cx="100" cy="100" r="86" class="ap-duct-inner"/>' +
		'<g class="ap-struts">' +
		'<line x1="100" y1="100" x2="34" y2="34"/><line x1="100" y1="100" x2="166" y2="34"/>' +
		'<line x1="100" y1="100" x2="34" y2="166"/><line x1="100" y1="100" x2="166" y2="166"/>' +
		'</g>' +
		'<g class="ap-rotor">' +
		'<use href="#apBladeShape"/><use href="#apBladeShape" transform="rotate(72 100 100)"/>' +
		'<use href="#apBladeShape" transform="rotate(144 100 100)"/>' +
		'<use href="#apBladeShape" transform="rotate(216 100 100)"/>' +
		'<use href="#apBladeShape" transform="rotate(288 100 100)"/>' +
		'</g>' +
		'<circle cx="100" cy="100" r="21" class="ap-hub"/>' +
		'<circle cx="100" cy="100" r="7" class="ap-hub-dot"/>' +
		'</svg>';
	return host;
}

/* 温控曲线阶梯图 */
function curveChart(cfg) {
	var lo = 20, hi = 120;
	function x(c) {
		return 12 + ((c - lo) / (hi - lo)) * 268;
	}
	function y(duty) {
		return 92 - (duty / 255) * 76;
	}
	var pts = [
		[lo, cfg.duties[0]],
		[cfg.temp_low, cfg.duties[1]],
		[cfg.temp_mid, cfg.duties[2]],
		[cfg.temp_high, cfg.duties[3]],
		[hi, cfg.duties[3]]
	];
	var d = 'M ' + x(pts[0][0]).toFixed(1) + ' ' + y(pts[0][1]).toFixed(1);
	pts.slice(1).forEach(function(p) {
		d += ' L ' + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1);
		d += ' L ' + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1);
	});
	var svg = E('svg', {
		'viewBox': '0 0 292 104', 'class': 'ap-chart', 'preserveAspectRatio': 'none',
		'role': 'img', 'aria-label': _('温控曲线预览')
	});
	svg.innerHTML = '<g class="ap-chart-grid">' +
		'<line x1="12" y1="16" x2="280" y2="16"/><line x1="12" y1="54" x2="280" y2="54"/>' +
		'<line x1="12" y1="92" x2="280" y2="92"/>' +
		'<text x="12" y="12">100%</text><text x="12" y="50">50%</text>' +
		'</g>' +
		'<path class="ap-chart-line" d="' + d + '"/>' +
		'<line class="ap-chart-crit" x1="' + x(cfg.temp_crit).toFixed(1) + '" y1="14" x2="' +
		x(cfg.temp_crit).toFixed(1) + '" y2="92"/>' +
		'<g class="ap-chart-marks">' +
		[cfg.temp_low, cfg.temp_mid, cfg.temp_high].map(function(t) {
			return '<line x1="' + x(t).toFixed(1) + '" y1="92" x2="' + x(t).toFixed(1) + '" y2="98"/>' +
				'<text x="' + x(t).toFixed(1) + '" y="104" text-anchor="middle">' + t + '</text>';
		}).join('') +
		'</g>' +
		'<circle class="ap-chart-now" cx="' + x(cfg.now).toFixed(1) + '" cy="' +
		y(cfg.nowDuty).toFixed(1) + '" r="3.5"/>';
	return svg;
}

/* 温度与占空比历史趋势，数据全部来自实际轮询 */
function trendChart(history) {
	if (history.length < 2)
		return E('div', { 'class': 'ap-chart-empty' }, _('正在积累采样数据…'));
	var lo = 20, hi = 110;
	var n = history.length;
	function px(i) {
		return (i / (n - 1)) * 280 + 6;
	}
	function pyTemp(c) {
		return 92 - ((Math.min(Math.max(c, lo), hi) - lo) / (hi - lo)) * 76;
	}
	function pyDuty(d) {
		return 92 - (Math.min(Math.max(d, 0), 255) / 255) * 76;
	}
	var tempPts = [], dutyPts = [];
	history.forEach(function(s, i) {
		if (s.temp != null)
			tempPts.push(px(i).toFixed(1) + ',' + pyTemp(s.temp).toFixed(1));
		dutyPts.push(px(i).toFixed(1) + ',' + pyDuty(s.duty).toFixed(1));
	});
	var svg = E('svg', {
		'viewBox': '0 0 292 104', 'class': 'ap-chart', 'preserveAspectRatio': 'none',
		'role': 'img', 'aria-label': _('温度与占空比趋势')
	});
	svg.innerHTML = '<g class="ap-chart-grid">' +
		'<line x1="6" y1="16" x2="286" y2="16"/><line x1="6" y1="54" x2="286" y2="54"/>' +
		'<line x1="6" y1="92" x2="286" y2="92"/>' +
		'<text x="6" y="12">110℃</text><text x="6" y="50">65℃</text><text x="6" y="88">20℃</text>' +
		'</g>' +
		'<polyline class="ap-chart-duty" points="' + dutyPts.join(' ') + '"/>' +
		'<polyline class="ap-chart-temp" points="' + tempPts.join(' ') + '"/>';
	return svg;
}

/* ------------------------------- 样式表 ------------------------------- */
/*
 * 颜色令牌优先由容器上的 data-ap-theme 决定(渲染时按 LuCI 主题实际背景色判定，
 * 因此能跟随 openwrt21 的深/浅色开关)，并保留 prefers-color-scheme 作为回退。
 */
var CSS = String('') +
	'.ap-root{--ap-radius:16px;--ap-gap:14px;' +
	'--ap-bg:rgba(255,255,255,.82);--ap-bg-soft:rgba(248,250,252,.72);' +
	'--ap-border:rgba(203,213,225,.72);--ap-border-strong:rgba(148,163,184,.5);' +
	'--ap-text:#0f172a;--ap-text-muted:#475569;--ap-text-dim:#94a3b8;' +
	'--ap-accent:#0284c7;--ap-accent-soft:rgba(2,132,199,.1);' +
	'--ap-good:#059669;--ap-good-soft:rgba(5,150,105,.12);' +
	'--ap-warn:#d97706;--ap-warn-soft:rgba(217,119,6,.13);' +
	'--ap-danger:#dc2626;--ap-danger-soft:rgba(220,38,38,.11);' +
	'--ap-shadow:0 10px 28px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.05);' +
	'--ap-ease:cubic-bezier(.4,0,.2,1);' +
	'max-width:1180px;margin:14px auto 34px;padding:0 4px;' +
	'color:var(--ap-text);font-size:14px;line-height:1.5;}\n' +
	'.ap-root[data-ap-theme="dark"]{--ap-bg:rgba(23,32,50,.82);' +
	'--ap-bg-soft:rgba(15,23,42,.62);--ap-border:rgba(148,163,184,.22);' +
	'--ap-border-strong:rgba(148,163,184,.35);--ap-text:#e8eef7;--ap-text-muted:#a9bad0;' +
	'--ap-text-dim:#7d8ea6;--ap-accent:#38bdf8;--ap-accent-soft:rgba(56,189,248,.14);' +
	'--ap-good:#34d399;--ap-good-soft:rgba(52,211,153,.15);--ap-warn:#fbbf24;' +
	'--ap-warn-soft:rgba(251,191,36,.15);--ap-danger:#f87171;' +
	'--ap-danger-soft:rgba(248,113,113,.14);--ap-shadow:0 12px 30px rgba(0,0,0,.38);}\n' +
	'@media (prefers-color-scheme:dark){.ap-root:not([data-ap-theme="light"]){' +
	'--ap-bg:rgba(23,32,50,.82);--ap-bg-soft:rgba(15,23,42,.62);' +
	'--ap-border:rgba(148,163,184,.22);--ap-border-strong:rgba(148,163,184,.35);' +
	'--ap-text:#e8eef7;--ap-text-muted:#a9bad0;--ap-text-dim:#7d8ea6;' +
	'--ap-accent:#38bdf8;--ap-accent-soft:rgba(56,189,248,.14);--ap-good:#34d399;' +
	'--ap-warn:#fbbf24;--ap-danger:#f87171;--ap-shadow:0 12px 30px rgba(0,0,0,.38);}}\n' +
	'.ap-header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;' +
	'padding:14px 18px;margin-bottom:14px;border:1px solid var(--ap-border);' +
	'border-radius:var(--ap-radius);background:var(--ap-bg);' +
	'-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%);' +
	'box-shadow:var(--ap-shadow);}\n' +
	'.ap-header-mark{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;' +
	'justify-content:center;color:var(--ap-accent);background:var(--ap-accent-soft);' +
	'border:1px solid var(--ap-border);flex:0 0 auto;}\n' +
	'.ap-header-text{flex:1 1 auto;min-width:150px;}\n' +
	'.ap-header-title{font-size:16px;font-weight:700;letter-spacing:-.01em;}\n' +
	'.ap-header-sub{font-size:12px;color:var(--ap-text-muted);margin-top:1px;}\n' +
	'.ap-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:99px;' +
	'font-size:11.5px;font-weight:650;letter-spacing:.01em;border:1px solid transparent;white-space:nowrap;}\n' +
	'.ap-pill.is-good{color:var(--ap-good);background:var(--ap-good-soft);border-color:var(--ap-good-soft);}\n' +
	'.ap-pill.is-warning{color:var(--ap-warn);background:var(--ap-warn-soft);border-color:var(--ap-warn-soft);}\n' +
	'.ap-pill.is-danger{color:var(--ap-danger);background:var(--ap-danger-soft);border-color:var(--ap-danger-soft);}\n' +
	'.ap-pill.is-info{color:var(--ap-accent);background:var(--ap-accent-soft);border-color:var(--ap-accent-soft);}\n' +
	'.ap-pill.is-muted{color:var(--ap-text-muted);background:var(--ap-bg-soft);border-color:var(--ap-border);}\n' +
	'.ap-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 auto;}\n' +
	'.ap-dot-live{animation:ap-breathe 2.4s var(--ap-ease) infinite;}\n' +
	'@keyframes ap-breathe{0%,100%{opacity:1}50%{opacity:.35}}\n' +
	'.ap-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 var(--ap-gap);padding:5px;' +
	'border:1px solid var(--ap-border);border-radius:calc(var(--ap-radius) - 2px);' +
	'background:var(--ap-bg);box-shadow:var(--ap-shadow);}\n' +
	'.ap-tab{appearance:none;border:1px solid transparent;background:transparent;color:var(--ap-text-muted);' +
	'font:inherit;font-weight:600;font-size:13px;padding:9px 15px;border-radius:11px;cursor:pointer;' +
	'transition:background .18s var(--ap-ease),color .18s var(--ap-ease);' +
	'min-height:40px;display:inline-flex;align-items:center;gap:7px;}\n' +
	'.ap-tab:hover{background:var(--ap-bg-soft);color:var(--ap-text);}\n' +
	'.ap-tab[aria-selected="true"]{background:var(--ap-accent);color:#fff;box-shadow:0 4px 14px var(--ap-accent-soft);}\n' +
	'.ap-root[data-ap-theme="dark"] .ap-tab[aria-selected="true"]{color:#08111c;}\n' +
	'.ap-tab:focus-visible{outline:2px solid var(--ap-accent);outline-offset:2px;}\n' +
	'.ap-tab-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:99px;' +
	'background:var(--ap-danger-soft);color:var(--ap-danger);}\n' +
	'.ap-tab[aria-selected="true"] .ap-tab-badge{background:rgba(255,255,255,.28);color:inherit;}\n' +
	'.ap-panel{display:none;}\n' +
	'.ap-panel.is-active{display:block;animation:ap-fade .2s var(--ap-ease);}\n' +
	'@keyframes ap-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}\n' +
	'.ap-grid{display:grid;gap:var(--ap-gap);grid-template-columns:repeat(12,1fr);}\n' +
	'.ap-card{grid-column:span 12;border:1px solid var(--ap-border);border-radius:var(--ap-radius);' +
	'background:var(--ap-bg);box-shadow:var(--ap-shadow);overflow:hidden;' +
	'-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%);' +
	'margin-bottom:var(--ap-gap);}\n' +
	'.ap-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;' +
	'padding:12px 16px;border-bottom:1px solid var(--ap-border);}\n' +
	'.ap-card-title{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;' +
	'letter-spacing:.04em;text-transform:uppercase;color:var(--ap-text-muted);}\n' +
	'.ap-card-meta{font-size:11.5px;color:var(--ap-text-dim);display:flex;align-items:center;gap:8px;}\n' +
	'.ap-card-body{padding:16px;}\n' +
	'.ap-icon{display:inline-flex;align-items:center;color:var(--ap-accent);flex:0 0 auto;}\n' +
	'.ap-split{display:grid;gap:var(--ap-gap);grid-template-columns:300px 1fr;}\n' +
	'.ap-duo{display:grid;gap:var(--ap-gap);grid-template-columns:1fr 1fr;}\n' +
	'.ap-stage{width:100%;max-width:230px;margin:0 auto;color:var(--ap-accent);}\n' +
	'.ap-fan-svg{width:100%;height:auto;display:block;}\n' +
	'.ap-duct{fill:none;stroke:var(--ap-border-strong);stroke-width:2;}\n' +
	'.ap-duct-inner{fill:var(--ap-bg-soft);stroke:var(--ap-border);stroke-width:1;}\n' +
	'.ap-struts line{stroke:var(--ap-border-strong);stroke-width:2;stroke-linecap:round;opacity:.75;}\n' +
	'.ap-rotor{transform-origin:100px 100px;fill:url(#apBlade);stroke:var(--ap-border-strong);' +
	'stroke-width:.6;animation:ap-spin var(--ap-rotor,1.1s) linear infinite;' +
	'animation-play-state:paused;}\n' +
	'.ap-rotor.is-running{animation-play-state:running;}\n' +
	'@keyframes ap-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}\n' +
	'.ap-hub{fill:var(--ap-bg-soft);stroke:var(--ap-border-strong);stroke-width:1.2;}\n' +
	'.ap-hub-dot{fill:var(--ap-accent);}\n' +
	'@media (prefers-reduced-motion:reduce){.ap-rotor,.ap-dot-live{animation:none!important;}}\n' +
	'.ap-readout{text-align:center;margin-top:6px;}\n' +
	'.ap-readout-big{font-size:38px;font-weight:800;letter-spacing:-.02em;line-height:1;' +
	'font-variant-numeric:tabular-nums;}\n' +
	'.ap-readout-cap{font-size:11.5px;color:var(--ap-text-muted);margin-top:5px;font-weight:600;}\n' +
	'.ap-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:9px;}\n' +
	'.ap-chip{background:var(--ap-bg-soft);border:1px solid var(--ap-border);border-radius:12px;padding:9px 10px;}\n' +
	'.ap-chip-label{font-size:10.5px;font-weight:650;color:var(--ap-text-dim);letter-spacing:.03em;}\n' +
	'.ap-chip-value{font-size:14.5px;font-weight:750;margin-top:3px;font-variant-numeric:tabular-nums;}\n' +
	'.ap-chip.is-good .ap-chip-value{color:var(--ap-good);}\n' +
	'.ap-chip.is-warning .ap-chip-value{color:var(--ap-warn);}\n' +
	'.ap-chip.is-danger .ap-chip-value{color:var(--ap-danger);}\n' +
	'.ap-chip.is-info .ap-chip-value{color:var(--ap-accent);}\n' +
	'.ap-dl{margin:0;display:grid;gap:2px;}\n' +
	'.ap-dl-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;' +
	'border-bottom:1px dashed var(--ap-border);}\n' +
	'.ap-dl-row:last-child{border-bottom:none;}\n' +
	'.ap-dl-key{font-size:12.5px;color:var(--ap-text-muted);}\n' +
	'.ap-dl-val{margin:0;font-size:12.5px;font-weight:650;text-align:right;' +
	'font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}\n' +
	'.ap-dl-val.is-muted{color:var(--ap-text-dim);font-weight:500;}\n' +
	'.ap-dl-val.is-good{color:var(--ap-good);} .ap-dl-val.is-warning{color:var(--ap-warn);}' +
	' .ap-dl-val.is-danger{color:var(--ap-danger);}\n' +
	'.ap-note{font-size:12px;color:var(--ap-text-muted);background:var(--ap-bg-soft);' +
	'border:1px solid var(--ap-border);border-left:3px solid var(--ap-accent);' +
	'border-radius:10px;padding:10px 12px;margin:0 0 12px;}\n' +
	'.ap-alert{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-radius:12px;' +
	'border:1px solid var(--ap-border);background:var(--ap-bg-soft);margin-bottom:10px;font-size:12.5px;}\n' +
	'.ap-alert.is-warning{border-color:var(--ap-warn);background:var(--ap-warn-soft);color:var(--ap-warn);}\n' +
	'.ap-alert.is-danger{border-color:var(--ap-danger);background:var(--ap-danger-soft);color:var(--ap-danger);}\n' +
	'.ap-alert.is-info{border-color:var(--ap-accent);background:var(--ap-accent-soft);color:var(--ap-accent);}\n' +
	'.ap-alert-body{flex:1 1 auto;color:var(--ap-text);}\n' +
	'.ap-levels{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));}\n' +
	'.ap-level{display:flex;flex-direction:column;align-items:center;gap:3px;padding:13px 9px;' +
	'border:1px solid var(--ap-border);border-radius:13px;background:var(--ap-bg-soft);' +
	'color:var(--ap-text);cursor:pointer;font:inherit;transition:transform .16s var(--ap-ease),' +
	'border-color .16s var(--ap-ease),box-shadow .16s var(--ap-ease);min-height:78px;}\n' +
	'.ap-level:hover{transform:translateY(-2px);border-color:var(--ap-accent);box-shadow:var(--ap-shadow);}\n' +
	'.ap-level:focus-visible{outline:2px solid var(--ap-accent);outline-offset:2px;}\n' +
	'.ap-level[disabled]{opacity:.55;cursor:progress;}\n' +
	'.ap-level.is-active{border-color:var(--ap-accent);background:var(--ap-accent);color:#fff;}\n' +
	'.ap-root[data-ap-theme="dark"] .ap-level.is-active{color:#08111c;}\n' +
	'.ap-level.is-active .ap-level-sub{color:inherit;opacity:.8;}\n' +
	'.ap-level-name{font-size:13.5px;font-weight:700;}\n' +
	'.ap-level-sub{font-size:11px;color:var(--ap-text-dim);font-variant-numeric:tabular-nums;}\n' +
	'.ap-slider-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}\n' +
	'.ap-slider{flex:1 1 200px;min-width:180px;height:26px;}\n' +
	'.ap-slider-value{font-weight:750;font-variant-numeric:tabular-nums;min-width:104px;text-align:right;}\n' +
	'.ap-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px;}\n' +
	'.ap-btn{appearance:none;border:1px solid var(--ap-border);background:var(--ap-bg-soft);' +
	'color:var(--ap-text);font:inherit;font-size:13px;font-weight:650;padding:9px 16px;' +
	'border-radius:11px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;' +
	'min-height:38px;transition:transform .15s var(--ap-ease),box-shadow .15s var(--ap-ease),' +
	'opacity .15s var(--ap-ease);}\n' +
	'.ap-btn:hover{transform:translateY(-1px);box-shadow:var(--ap-shadow);}\n' +
	'.ap-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none;}\n' +
	'.ap-btn.is-primary{background:var(--ap-accent);border-color:var(--ap-accent);color:#fff;}\n' +
	'.ap-root[data-ap-theme="dark"] .ap-btn.is-primary{color:#08111c;}\n' +
	'.ap-btn.is-danger{color:var(--ap-danger);border-color:var(--ap-danger);background:var(--ap-danger-soft);}\n' +
	'.ap-log{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;' +
	'line-height:1.55;background:var(--ap-bg-soft);border:1px solid var(--ap-border);border-radius:11px;' +
	'padding:11px 13px;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;' +
	'margin:0;color:var(--ap-text);}\n' +
	'.ap-area{width:100%;min-height:120px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
	'font-size:11.5px;border:1px solid var(--ap-border);border-radius:11px;background:var(--ap-bg-soft);' +
	'color:var(--ap-text);padding:10px;box-sizing:border-box;resize:vertical;}\n' +
	'.ap-area:focus-visible{outline:2px solid var(--ap-accent);outline-offset:1px;}\n' +
	'.ap-table{width:100%;border-collapse:collapse;font-size:12.5px;}\n' +
	'.ap-table th,.ap-table td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--ap-border);' +
	'vertical-align:top;}\n' +
	'.ap-table th{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;' +
	'color:var(--ap-text-dim);background:var(--ap-bg-soft);}\n' +
	'.ap-table tr:last-child td{border-bottom:none;}\n' +
	'.ap-table td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:650;}\n' +
	'.ap-table code{font-size:11px;color:var(--ap-text-dim);overflow-wrap:anywhere;}\n' +
	'.ap-chart{width:100%;height:auto;display:block;color:var(--ap-accent);}\n' +
	'.ap-chart-empty{font-size:12px;color:var(--ap-text-dim);padding:24px 0;text-align:center;}\n' +
	'.ap-chart-grid line{stroke:var(--ap-border);stroke-width:1;}\n' +
	'.ap-chart-grid text{fill:var(--ap-text-dim);font-size:8px;}\n' +
	'.ap-chart-line{fill:none;stroke:var(--ap-accent);stroke-width:2.2;stroke-linejoin:round;}\n' +
	'.ap-chart-crit{stroke:var(--ap-danger);stroke-width:1.4;stroke-dasharray:4 3;}\n' +
	'.ap-chart-marks line{stroke:var(--ap-border-strong);stroke-width:1.2;}\n' +
	'.ap-chart-marks text{fill:var(--ap-text-dim);font-size:8px;}\n' +
	'.ap-chart-now{fill:var(--ap-warn);stroke:#fff;stroke-width:1;}\n' +
	'.ap-chart-temp{fill:none;stroke:var(--ap-warn);stroke-width:2;stroke-linejoin:round;}\n' +
	'.ap-chart-duty{fill:none;stroke:var(--ap-accent);stroke-width:1.6;' +
	'stroke-dasharray:4 3;opacity:.85;}\n' +
	'.ap-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--ap-text-muted);' +
	'margin-top:8px;}\n' +
	'.ap-legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:5px;' +
	'vertical-align:middle;}\n' +
	'.ap-topo{width:100%;height:auto;display:block;}\n' +
	'.ap-topo-box{fill:var(--ap-bg-soft);stroke:var(--ap-border-strong);stroke-width:1.2;}\n' +
	'.ap-topo-box.is-live{stroke:var(--ap-good);}\n' +
	'.ap-topo-box.is-dead{stroke:var(--ap-danger);stroke-dasharray:4 3;}\n' +
	'.ap-topo-t{fill:var(--ap-text);font-size:11px;font-weight:700;}\n' +
	'.ap-topo-s{fill:var(--ap-text-dim);font-size:9.5px;}\n' +
	'.ap-topo-wire{stroke:var(--ap-border-strong);stroke-width:1.6;fill:none;}\n' +
	'.ap-topo-wire.is-live{stroke:var(--ap-good);}\n' +
	'.ap-topo-wire.is-pulse{stroke-dasharray:5 5;animation:ap-flow 1.6s linear infinite;}\n' +
	'@keyframes ap-flow{to{stroke-dashoffset:-20}}\n' +
	'.ap-form{font-size:13px;}\n' +
	'.ap-form .cbi-section{background:transparent!important;border:none!important;' +
	'padding:0!important;margin:0!important;box-shadow:none!important;}\n' +
	'.ap-form .cbi-value{padding:9px 0!important;border-bottom:1px dashed var(--ap-border);' +
	'display:flex!important;gap:12px;align-items:flex-start;}\n' +
	'.ap-form .cbi-value:last-of-type{border-bottom:none;}\n' +
	'.ap-form .cbi-value-title{width:34%!important;min-width:150px!important;padding:6px 0 0!important;' +
	'font-size:12.5px!important;font-weight:650!important;color:var(--ap-text)!important;}\n' +
	'.ap-form .cbi-value-field{flex:1 1 auto!important;}\n' +
	'.ap-form .cbi-value-description{font-size:11.5px!important;color:var(--ap-text-dim)!important;' +
	'margin-top:4px!important;}\n' +
	'.ap-form input[type="text"],.ap-form input[type="password"],.ap-form select,.ap-form textarea' +
	'{border-radius:10px!important;border:1px solid var(--ap-border)!important;' +
	'background:var(--ap-bg-soft)!important;color:var(--ap-text)!important;padding:8px 11px!important;' +
	'min-height:36px;font-size:13px!important;max-width:220px;}\n' +
	'.ap-form input:focus-visible,.ap-form select:focus-visible{outline:2px solid var(--ap-accent);' +
	'outline-offset:1px;}\n' +
	'.ap-form .cbi-button{border-radius:10px!important;font-weight:650!important;}\n' +
	'.ap-form .cbi-value-error,.ap-form .cbi-value .error{color:var(--ap-danger)!important;}\n' +
	'.ap-form .cbi-value .cbi-validate-message{font-size:11.5px!important;color:var(--ap-danger)!important;}\n' +
	'@media (max-width:900px){.ap-split{grid-template-columns:1fr;}.ap-duo{grid-template-columns:1fr;}}\n' +
	'@media (max-width:640px){.ap-root{--ap-gap:11px;margin:8px auto 24px;}' +
	'.ap-card-body{padding:13px;}.ap-form .cbi-value{display:block!important;}' +
	'.ap-form .cbi-value-title{width:auto!important;min-width:0!important;padding-bottom:4px!important;}' +
	'.ap-form input[type="text"],.ap-form select{max-width:100%!important;width:100%!important;}' +
	'.ap-tab{flex:1 1 auto;justify-content:center;font-size:12.5px;padding:9px 10px;}' +
	'.ap-readout-big{font-size:32px;}.ap-stage{max-width:180px;}}\n';

/* LuCI 主题变量并不保证存在，深/浅色直接由页面实际背景亮度判定 */
function detectTheme(root) {
	var probe = document.body;
	var bg = window.getComputedStyle(probe).backgroundColor;
	var match = String(bg).match(/(\d+)[^\d]+(\d+)[^\d]+(\d+)/);
	if (!match) {
		root.setAttribute('data-ap-theme', 'light');
		return;
	}
	var r = Number(match[1]), g = Number(match[2]), b = Number(match[3]);
	var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	root.setAttribute('data-ap-theme', lum < 0.5 ? 'dark' : 'light');
}

/* ------------------------------- 表单区 ------------------------------- */
/*
 * 三个独立 Map 分别归属温控策略 / 传感器 / 高级设置三个标签页。
 * 标签页切换只做显隐，不重建表单，因此未保存的编辑内容不会丢失。
 */

function sectionOf(m, title, description) {
	var s = m.section(form.NamedSection, SECTION, 'fan', title, description);
	s.anonymous = true;
	return s;
}

function makeCurveMap(self) {
	var m = new form.Map(CONFIG, _('温控策略'),
		_('温度阶梯曲线决定自动模式下的风扇占空比。修改后需保存并应用，守护进程会在下一个控制周期生效。'));

	var s = sectionOf(m, _('温度阈值与档位'),
		_('阈值需严格递增，占空比需随温度单调不降，否则后端会回退到出厂阶梯并在概览页报告原因。'));

	[['temp_high', _('高温阈值 (℃)'), '85', 20, 120, 'duty_high', _('高温占空比 (0-255)'), '255'],
		['temp_mid', _('中温阈值 (℃)'), '60', 20, 120, 'duty_mid', _('中温占空比 (0-255)'), '192'],
		['temp_low', _('低温阈值 (℃)'), '50', 20, 120, 'duty_low', _('低温占空比 (0-255)'), '128']
	].forEach(function(row) {
		var t = s.option(form.Value, row[0], row[1],
			_('温度达到该值时进入更高一档；回落超过迟滞量后才降档。'));
		t.datatype = 'and(float,min(' + row[4] + '),max(' + row[5] + '))';
		t.default = row[2];
		t.validate = function(sid, value) {
			var n = parseFloat(value);
			if (isNaN(n))
				return _('请输入温度数值');
			if (n < row[4] || n > row[5])
				return _('温度需在 %d 到 %d ℃ 之间').format(row[4], row[5]);
			return true;
		};
		var d = s.option(form.Value, row[6], row[7], _('0 为停转，255 为满速。'));
		d.datatype = 'and(uinteger,min(0),max(255))';
		d.default = row[8];
		d.validate = function(sid, value) {
			var n = parseInt(value, 10);
			if (isNaN(n) || n < 0 || n > 255)
				return _('占空比需在 0 到 255 之间');
			return true;
		};
	});

	var idle = s.option(form.Value, 'duty_idle', _('基础占空比 (0-255)'),
		_('低于低温阈值时保持的风扇档位。'));
	idle.datatype = 'and(uinteger,min(0),max(255))';
	idle.default = '64';

	var interval = s.option(form.Value, 'auto_interval', _('控制周期 (秒)'),
		_('自动模式的采样与调节间隔。周期越短响应越快，采样开销也越高。'));
	interval.datatype = 'and(uinteger,min(2),max(300))';
	interval.default = '8';

	var hyst = s.option(form.Value, 'hysteresis', _('降档迟滞 (℃)'),
		_('温度需低于阈值减去该值才允许降档，用于抑制风扇抖动。'));
	hyst.datatype = 'and(float,min(0),max(15))';
	hyst.default = '2';

	var hold = s.option(form.Value, 'min_hold', _('降档最小保持 (秒)'),
		_('两次降档之间的最短间隔。升温调整不受该限制。'));
	hold.datatype = 'and(uinteger,min(0),max(600))';
	hold.default = '30';

	return m;
}

function makeSensorMap(self) {
	var m = new form.Map(CONFIG, _('传感器与采样'),
		_('仅展示本设备实际可用的温度来源。停用某个来源可减少外部命令调用。'));

	var s = sectionOf(m, _('温度来源'));
	[['src_cpu', _('CPU 核心温度'), '来自 /sys/class/thermal/thermal_zone*/temp。'],
		['src_phy', _('网络交换温度'), '来自 /sys/class/hwmon/*/temp1_input。'],
		['src_wifi', _('Wi-Fi 射频温度'), '来自 iwpriv <iface> stat，需要调用外部命令。'],
		['src_modem', _('通信模组温度'), '来自 ubus call modem_ctrl info，需要调用外部命令。']
	].forEach(function(row) {
		var o = s.option(form.Flag, row[0], row[1], _(row[2]));
		o.default = '1';
		o.rmempty = false;
	});

	var slow = s.option(form.Value, 'slow_interval', _('外部命令采样周期 (秒)'),
		_('Wi-Fi 与模组温度需要 fork 外部命令，按该周期低频采样，其余时间沿用上一次读数。'));
	slow.datatype = 'and(uinteger,min(5),max(600))';
	slow.default = '30';

	return m;
}

function makeAdvancedMap(self) {
	var m = new form.Map(CONFIG, _('高级设置'),
		_('驱动选择、安全兜底与诊断参数。修改驱动相关项前请确认设备实际接线与内核模块状态。'));

	var d = sectionOf(m, _('风扇驱动'),
		_('auto 依据 eMMC 容量判定硬件 PWM 或 GPIO 软件 PWM；错误组合会导致服务无法启动。'));
	var driver = d.option(form.ListValue, 'fan_driver', _('驱动调度策略'));
	driver.value('auto', _('自动感知 (推荐)'));
	driver.value('pwm', _('硬件 PWM (pwm-fan)'));
	driver.value('softpwm', _('软件 PWM (airpi_gpio_fan)'));
	driver.default = 'auto';
	var gpio = d.option(form.Value, 'fan_gpio', _('软件 PWM 引脚 (GPIO 编号)'),
		_('AP3000M 常见为 540 (gpiochip512 offset 28)。修改后守护进程会重新加载内核模块。'));
	gpio.datatype = 'and(uinteger,min(0),max(1023))';
	gpio.default = '540';
	gpio.depends('fan_driver', 'softpwm');
	var freq = d.option(form.Value, 'fan_freq', _('PWM 周期 (微秒)'),
		_('默认 15000μs ≈ 66.7Hz。修改后由守护进程热更新内核模块参数。'));
	freq.datatype = 'and(uinteger,min(100),max(1000000))';
	freq.default = '15000';
	freq.depends('fan_driver', 'softpwm');

	var safety = sectionOf(m, _('安全与兜底'),
		_('这些参数决定异常时的散热行为，请谨慎下调。'));
	var crit = safety.option(form.Value, 'temp_crit', _('温控守护触发温度 (℃)'),
		_('手动或无级模式下超过该温度时，守护进程会临时接管并拉满风扇。'));
	crit.datatype = 'and(float,min(20),max(120))';
	crit.default = '95';
	var guard = safety.option(form.Flag, 'crit_guard', _('启用温控守护'),
		_('关闭后手动档位将持续生效，即使温度过高。仅建议在排查问题时短时关闭。'));
	guard.default = '1';
	guard.rmempty = false;
	var failduty = safety.option(form.Value, 'fail_duty', _('传感器失效占空比 (0-255)'),
		_('连续取不到有效温度时使用的兜底档位，默认满速。'));
	failduty.datatype = 'and(uinteger,min(0),max(255))';
	failduty.default = '255';
	var failcount = safety.option(form.Value, 'fail_count', _('判定失效的连续次数'),
		_('避免单次采样抖动就触发兜底。'));
	failcount.datatype = 'and(uinteger,min(1),max(10))';
	failcount.default = '3';
	var stop = safety.option(form.Value, 'stop_duty', _('服务停止后保留占空比 (0-255)'),
		_('服务停止时写入风扇接口的保底档位；历史版本写 0 会直接停转。'));
	stop.datatype = 'and(uinteger,min(0),max(255))';
	stop.default = '64';

	var diag = sectionOf(m, _('诊断'));
	var loglevel = diag.option(form.ListValue, 'log_level', _('日志级别'),
		_('日志写入 /tmp/airpi-fancontrol.log（不落在 Flash 上），并转发到系统日志。'));
	loglevel.value('0', _('关闭'));
	loglevel.value('1', _('仅错误'));
	loglevel.value('2', _('信息'));
	loglevel.value('3', _('调试'));
	loglevel.default = '2';

	return m;
}

/* ------------------------------- 视图主体 ------------------------------- */

/*
 * 未保存提醒。监听器在模块作用域只注册一次(避免视图重建时累积)，
 * 实例通过共享的 dirty 标记告知是否有未保存的表单编辑。
 * 浏览器只在整页离开(刷新/关闭/地址跳转)时触发 beforeunload；
 * LuCI 站内 SPA 切换不会触发它，切换标签页本身也不会丢编辑内容。
 */
var dirty = { flag: false };
var unloadListenerBound = false;

function armUnloadGuard() {
	if (unloadListenerBound)
		return;
	unloadListenerBound = true;
	window.addEventListener('beforeunload', function(ev) {
		if (!dirty.flag)
			return;
		ev.preventDefault();
		ev.returnValue = '';
	});
}

return view.extend({
	tab: 'overview',
	root: null,
	refs: {},
	history: [],
	panels: {},
	seq: 0,
	tick: 0,
	inflight: false,
	busy: false,
	status: {},
	hw: null,
	hwPending: false,
	logsPending: false,

	load: function() {
		return Promise.all([
			ctl(['snapshot']).then(function(r) {
				return r.stdout || '';
			}).catch(function() {
				return '';
			}),
			uci.load(CONFIG)
		]);
	},

	/* ------------------------------ 状态读取 ------------------------------ */

	fetch: function() {
		var self = this;

		/* 上一轮还没回来就跳过，避免慢响应堆积 */
		if (this.inflight)
			return Promise.resolve();

		this.inflight = true;
		var seq = ++this.seq;

		return ctl(['snapshot']).then(function(res) {
			if (seq !== self.seq)
				return;
			self.applyStatus(parseKV(res.stdout));
		}).catch(function(e) {
			if (seq !== self.seq)
				return;
			self.applyStatus({ alarm: 'interface', alarm_msg: _('状态读取失败: ') + (e && e.message ? e.message : e) });
		}).then(function() {
			if (seq === self.seq)
				self.inflight = false;
		});
	},

	applyStatus: function(st) {
		if (!st || !Object.keys(st).length)
			return;

		this.status = st;

		/* 以快照时间戳去重，避免轮询比控制周期快时把同一条采样塞进历史多次 */
		var ts = num(st.ts, 0),
			temp = flt(st.temp, NaN),
			last = this.history[this.history.length - 1];

		if (!last || last.ts !== ts) {
			this.history.push({
				ts: ts,
				temp: isNaN(temp) ? null : temp,
				duty: num(st.duty, 0)
			});
			if (this.history.length > HISTORY_LIMIT)
				this.history.shift();
		}

		this.paint();
	},

	/* 温控曲线：优先用编辑中的表单值，便于在保存前预览 */
	curveConfig: function() {
		var staged = this.readStagedCurve();
		var st = this.status;
		var text = String(st.policy || '').trim();
		var fallback = [
			[85, 255], [60, 192], [50, 128]
		];
		var curve = fallback.slice();

		if (text) {
			var parsed = [];
			text.split(/\s+/).forEach(function(pair) {
				var kv = pair.split(':');
				if (kv.length === 2 && kv[0] !== '*')
					parsed.push([parseFloat(kv[0]), parseInt(kv[1], 10)]);
			});
			if (parsed.length === 3)
				curve = parsed;
		}

		var base = {
			temp_high: staged.temp_high != null ? staged.temp_high : curve[0][0],
			temp_mid: staged.temp_mid != null ? staged.temp_mid : curve[1][0],
			temp_low: staged.temp_low != null ? staged.temp_low : curve[2][0],
			duties: [
				staged.duty_idle != null ? staged.duty_idle : (curve[2][1] != null ? num(curve[2][1], 64) : 64),
				staged.duty_low != null ? staged.duty_low : num(curve[2][1], 128),
				staged.duty_mid != null ? staged.duty_mid : num(curve[1][1], 192),
				staged.duty_high != null ? staged.duty_high : num(curve[0][1], 255)
			],
			temp_crit: staged.temp_crit != null ? staged.temp_crit : flt(uciget('temp_crit'), 95),
			now: flt(st.temp, NaN),
			nowDuty: num(st.duty, 0)
		};
		if (isNaN(base.now))
			base.now = 20;
		return base;
	},

	readStagedCurve: function() {
		var out = {},
			keys = ['temp_high', 'temp_mid', 'temp_low', 'duty_idle', 'duty_low',
				'duty_mid', 'duty_high', 'temp_crit'];

		/* 表单输入框里的值优先，其次 uci 暂存值 */
		keys.forEach(function(key) {
			var el = document.getElementById('cbid.' + CONFIG + '.' + SECTION + '.' + key);
			var raw = null;
			if (el && el.value != null && el.value !== '')
				raw = el.value;
			else
				raw = uci.get(CONFIG, SECTION, key);
			var n = parseFloat(raw);
			if (!isNaN(n))
				out[key] = n;
		});
		return out;
	},

	/* ------------------------------ 渲染骨架 ------------------------------ */

	render: function(data) {
		var self = this;

		this.applyStatus(parseKV(data[0]));

		this.root = E('div', { 'class': 'ap-root' }, [
			E('style', { 'type': 'text/css' }, CSS)
		]);
		detectTheme(this.root);

		this.header = this.buildHeader();
		this.nav = this.buildNav();
		this.root.appendChild(this.header);
		this.root.appendChild(this.nav);

		/* 单个委托监听器即可覆盖三个表单，容器随视图一起销毁 */
		armUnloadGuard();
		this.root.addEventListener('change', function(ev) {
			if (ev.target && ev.target.closest && ev.target.closest('.ap-form'))
				dirty.flag = true;
		});

		TABS.forEach(function(t) {
			var panel = E('div', {
				'class': 'ap-panel',
				'id': 'ap-panel-' + t.id,
				'role': 'tabpanel',
				'aria-labelledby': 'ap-tab-' + t.id
			});
			self.panels[t.id] = panel;
			self.root.appendChild(panel);
		});

		this.buildOverview();
		this.buildControl();
		this.buildSensors();

		/* 三个表单各自归属一个标签页，渲染完成后放入对应面板；任一失败只影响该页 */
		[['curve', makeCurveMap, self.onCurvePanelReady],
			['sensors', makeSensorMap, null],
			['advanced', makeAdvancedMap, self.onAdvancedPanelReady]].forEach(function(spec) {
			var panel = self.panels[spec[0]];
			var host = E('div', { 'class': 'ap-form' });
			var err = E('div', { 'class': 'ap-alert is-danger hidden' });
			panel.appendChild(err);
			panel.appendChild(host);
			spec[1](self).render().then(function(el) {
				host.appendChild(el);
				if (spec[2])
					spec[2].call(self, panel);
			}).catch(function(e) {
				dom.content(err, _('表单加载失败: ') + (e && e.message ? e.message : e));
				err.classList.remove('hidden');
			});
		});

		var initial = (location.hash || '').replace('#', '');
		this.activateTab(TABS.some(function(t) { return t.id === initial; }) ? initial : 'overview', true);

		/* 用 onhashchange 赋值而非 addEventListener: 视图重建时不会累积监听器 */
		window.onhashchange = function() {
			var id = (location.hash || '').replace('#', '');
			if (TABS.some(function(t) { return t.id === id; }))
				self.activateTab(id);
		};

		/*
		 * LuCI 的 poll.add(fn, interval) 没有"绑定节点自动回收"的语义，回调会一直
		 * 活到整页刷新。这里保存绑定后的引用，并在容器离开文档时主动 poll.remove，
		 * 避免站内导航反复累积轮询任务。
		 */
		this.pollFn = L.bind(this.pollTick, this);
		poll.add(this.pollFn, POLL_INTERVAL);

		return this.root;
	},

	pollTick: function() {
		/* 容器已被移除(站内导航): 注销自己，不再持有任何 DOM 引用 */
		if (!this.root || !document.body.contains(this.root)) {
			if (this.pollFn)
				poll.remove(this.pollFn);
			return Promise.resolve();
		}

		/* 浏览器后台标签不做任何请求；回到前台下一轮自动恢复 */
		if (document.hidden)
			return Promise.resolve();

		this.tick++;
		var chain = [this.fetch()];

		if (this.tab === 'advanced' && !this.hwPending && this.tick % 3 === 0)
			chain.push(this.fetchHardware());

		return Promise.all(chain);
	},

	buildHeader: function() {
		var self = this;
		var host = E('header', { 'class': 'ap-header' }, [
			E('div', { 'class': 'ap-header-mark' }),
			E('div', { 'class': 'ap-header-text' }, [
				E('div', { 'class': 'ap-header-title' }, _('AirPi AP3000M 温控工作台')),
				E('div', { 'class': 'ap-header-sub' }, _('PWM 调速 · 由 airpi-fanctl 守护进程独立执行'))
			]),
			E('div', { 'class': 'ap-header-status' }, [
				pill(_('连接中'), 'muted')
			])
		]);
		host.querySelector('.ap-header-mark').innerHTML = icon(ICON.fan, 22);
		this.refs.headerStatus = host.querySelector('.ap-header-status');
		return host;
	},

	buildNav: function() {
		var self = this;
		var nav = E('nav', { 'class': 'ap-tabs', 'role': 'tablist', 'aria-label': _('功能分区') });
		this.refs.tabButtons = {};
		TABS.forEach(function(t) {
			var btn = E('button', {
				'class': 'ap-tab',
				'id': 'ap-tab-' + t.id,
				'type': 'button',
				'role': 'tab',
				'aria-selected': 'false',
				'tabindex': '-1'
			}, [_(t.label)]);
			btn.addEventListener('click', function() {
				self.activateTab(t.id);
			});
			nav.appendChild(btn);
			self.refs.tabButtons[t.id] = btn;
		});
		return nav;
	},

	activateTab: function(id, silent) {
		var self = this;
		this.tab = id;

		TABS.forEach(function(t) {
			var btn = self.refs.tabButtons[t.id];
			var panel = self.panels[t.id];
			if (!btn || !panel)
				return;
			var on = t.id === id;
			btn.setAttribute('aria-selected', on ? 'true' : 'false');
			btn.setAttribute('tabindex', on ? '0' : '-1');
			panel.classList.toggle('is-active', on);
			/* 风扇动画只在进行中的标签页里跑，切走即暂停，省 CPU */
		});

		if (!silent && (location.hash || '').replace('#', '') !== id)
			history.replaceState(null, '', '#' + id);

		/* 立刻用已有状态重绘，动画/可见性不必等下一轮轮询 */
		if (this.root && Object.keys(this.status).length)
			this.paint();

		if (id === 'advanced' && !this.hw)
			this.fetchHardware();
		if (id === 'curve')
			this.paintCurve();
	},

	/* --------------------------- 各标签页结构 --------------------------- */

	buildOverview: function() {
		var stage = fanVisual();
		this.refs.rotor = stage.querySelector('.ap-rotor');

		this.refs.dutyBig = E('div', { 'class': 'ap-readout-big' }, '—');
		this.refs.dutyCap = E('div', { 'class': 'ap-readout-cap' }, _('等待守护进程数据'));

		var fanCard = card({
			title: '风扇运行状态',
			icon: 'fan',
			meta: pill(_('未连接'), 'muted'),
			body: [stage, E('div', { 'class': 'ap-readout' }, [this.refs.dutyBig, this.refs.dutyCap])]
		});
		this.refs.fanMeta = fanCard.querySelector('.ap-card-meta');

		this.refs.runRows = E('div', {});
		var runCard = card({
			title: '控制链路',
			icon: 'gauge',
			meta: pill(_('实时'), 'info'),
			body: [this.refs.runRows]
		});

		this.refs.alarmHost = E('div', {});
		var alarmCard = card({
			title: '告警与自检',
			icon: 'alarm',
			body: [this.refs.alarmHost]
		});

		this.refs.tempChips = E('div', { 'class': 'ap-chips' });
		var tempCard = card({
			title: '温度来源',
			icon: 'temp',
			meta: E('span', {}, _('热源: —')),
			body: [this.refs.tempChips]
		});
		this.refs.tempMeta = tempCard.querySelector('.ap-card-meta');

		this.refs.trendHost = E('div', {});
		var trendCard = card({
			title: '温度与占空比趋势',
			icon: 'curve',
			meta: pill(_('最近 %d 次采样').format(HISTORY_LIMIT), 'muted'),
			body: [this.refs.trendHost, E('div', { 'class': 'ap-legend' }, [
				E('span', {}, [E('i', { 'style': 'background:var(--ap-warn)' }), _('温度')]),
				E('span', {}, [E('i', { 'style': 'background:var(--ap-accent)' }), _('占空比')])
			])]
		});

		this.refs.policyHost = E('div', {});
		var policyCard = card({
			title: '当前生效策略',
			icon: 'curve',
			body: [this.refs.policyHost]
		});

		var left = E('div', {}, [fanCard, policyCard]);
		var right = E('div', {}, [alarmCard, runCard, tempCard, trendCard]);
		this.panels.overview.appendChild(E('div', { 'class': 'ap-split' }, [left, right]));
	},

	buildControl: function() {
		var self = this;

		var levels = [
			{ name: '静音', duty: 64, code: 0 },
			{ name: '巡航', duty: 128, code: 1 },
			{ name: '强冷', duty: 192, code: 2 },
			{ name: '全速', duty: 255, code: 3 }
		];

		this.refs.levelBtns = {};
		var levelsHost = E('div', { 'class': 'ap-levels' });

		var auto = E('button', {
			'class': 'ap-level', 'type': 'button',
			'style': 'grid-column:1/-1;flex-direction:row;justify-content:center;gap:10px'
		}, [
			svgIcon('chip', 18),
			E('span', { 'class': 'ap-level-name' }, _('智能温控')),
			E('span', { 'class': 'ap-level-sub' }, _('按温控曲线自动调节'))
		]);
		auto.addEventListener('click', function() {
			self.command(['auto'], _('切换为智能温控'));
		});
		levelsHost.appendChild(auto);
		this.refs.levelBtns.auto = auto;

		levels.forEach(function(lv) {
			var btn = E('button', { 'class': 'ap-level', 'type': 'button' }, [
				E('span', { 'class': 'ap-level-name' }, _(lv.name)),
				E('span', { 'class': 'ap-level-sub' }, '%d%% · PWM %d'.format(dutyPct(lv.duty), lv.duty))
			]);
			btn.addEventListener('click', function() {
				self.command(['set', String(lv.duty), String(lv.code)],
					_('%s（固定 %d%%）').format(_(lv.name), dutyPct(lv.duty)));
			});
			levelsHost.appendChild(btn);
			self.refs.levelBtns[lv.code] = btn;
		});

		this.refs.slider = E('input', {
			'class': 'ap-slider', 'type': 'range',
			'min': '0', 'max': '255', 'step': '1', 'value': '128',
			'aria-label': _('目标占空比')
		});
		this.refs.sliderText = E('span', { 'class': 'ap-slider-value' }, 'PWM 128 · 50%');
		this.refs.sliderApply = E('button', { 'class': 'ap-btn is-primary', 'type': 'button' }, _('应用到风扇'));
		this.refs.sliderApply.addEventListener('click', function() {
			var v = num(self.refs.slider.value, 0);
			self.command(['stepless', String(v)], _('无级调速 PWM %d').format(v),
				v <= 0 ? _('设置为 0 会让风扇完全停转，散热保护随之失效。确定继续吗？') : null);
		});
		this.refs.slider.addEventListener('input', function() {
			/* 拖动期间不让轮询回填滑块位置；只有"应用到风扇"成功后才交还设备值 */
			self.sliderTouched = true;
			var v = num(self.refs.slider.value, 0);
			self.refs.sliderText.textContent = 'PWM %d · %d%%'.format(v, dutyPct(v));
		});

		var stepless = card({
			title: '无级调速',
			icon: 'slider',
			body: [
				E('p', { 'class': 'ap-note' }, _('拖动滑块只改预览值，点击"应用到风扇"才会真正下发，避免连续拖动反复写硬件。')),
				E('div', { 'class': 'ap-slider-row' }, [self.refs.slider, self.refs.sliderText]),
				E('div', { 'class': 'ap-actions' }, [self.refs.sliderApply])
			]
		});

		var modeCard = card({
			title: '运行模式',
			icon: 'fan',
			body: [
				E('p', { 'class': 'ap-note' }, _('手动档位与无级调速会暂停自动曲线；超过临界温度时温控守护仍会临时接管。')),
				levelsHost
			]
		});

		this.refs.controlState = E('div', {});
		var stateCard = card({
			title: '设定值与实测回读',
			icon: 'gauge',
			body: [this.refs.controlState]
		});

		this.panels.control.appendChild(E('div', { 'class': 'ap-duo' }, [modeCard, stepless]));
		this.panels.control.appendChild(stateCard);
	},

	buildSensors: function() {
		var head = E('tr', {}, [
			E('th', {}, _('来源')),
			E('th', {}, _('实测值')),
			E('th', {}, _('时效')),
			E('th', {}, _('状态'))
		]);
		this.refs.sensorBody = E('tbody', {});
		var table = E('table', { 'class': 'ap-table' }, [E('thead', {}, head), this.refs.sensorBody]);

		var tableCard = card({
			title: '温度采样明细',
			icon: 'temp',
			body: [
				E('p', { 'class': 'ap-note' }, _('本硬件仅有占空比回读，没有转速(tach)反馈，因此界面不显示转速估算值；所有温度都来自上表列出的实际接口。')),
				table
			]
		});

		this.refs.samplingState = E('div', {});
		var stateCard = card({
			title: '采集与执行',
			icon: 'chip',
			body: [this.refs.samplingState]
		});

		this.panels.sensors.appendChild(E('div', {}, [tableCard, stateCard]));
	},

	onCurvePanelReady: function(panel) {
		var self = this;
		var chartHost = E('div', {});
		panel.insertBefore(card({
			title: '曲线预览',
			icon: 'curve',
			meta: pill(_('随表单实时预览'), 'info'),
			body: [chartHost, E('p', { 'class': 'ap-note' }, _('橙色圆点是当前实测温度与占空比在曲线上的位置。'))]
		}), panel.firstChild);
		self.refs.curveChart = chartHost;

		/* 事件委托: 只挂一个监听器，随容器一起回收 */
		panel.addEventListener('input', function() {
			self.paintCurve();
		});
		self.paintCurve();
	},

	onAdvancedPanelReady: function(panel) {
		var self = this;

		this.refs.hwHost = E('div', {}, E('p', { 'class': 'ap-note' }, _('正在探测硬件接口…')));
		this.refs.logHost = E('div', {});
		this.refs.serviceState = E('div', {});
		this.refs.ioHost = E('div', {});

		var hwCard = card({
			title: '驱动与硬件接口',
			icon: 'chip',
			meta: E('span', {}, ''),
			body: [this.refs.hwHost]
		});
		this.refs.hwMeta = hwCard.querySelector('.ap-card-meta');

		var logBtn = E('button', { 'class': 'ap-btn', 'type': 'button' }, _('刷新日志'));
		logBtn.addEventListener('click', function() {
			self.fetchLogs();
		});
		var logCard = card({
			title: '运行日志',
			icon: 'file',
			meta: logBtn,
			body: [this.refs.logHost]
		});

		var reloadBtn = E('button', { 'class': 'ap-btn is-primary', 'type': 'button' }, _('重载配置'));
		reloadBtn.addEventListener('click', function() {
			self.reloadConfig();
		});

		var svcCard = card({
			title: '服务状态',
			icon: 'power',
			body: [this.refs.serviceState, E('div', { 'class': 'ap-actions' }, [reloadBtn])]
		});

		var ioCard = card({
			title: '配置导入导出',
			icon: 'wrench',
			body: [this.refs.ioHost]
		});

		[hwCard, svcCard, logCard, ioCard].forEach(function(c) {
			panel.appendChild(c);
		});

		this.fetchLogs();
	},

	/* ------------------------------ 数据下发 ------------------------------ */

	command: function(args, label, dangerHint) {
		var self = this;

		if (this.busy)
			return Promise.resolve();

		var chain = Promise.resolve();
		if (dangerHint !== undefined && dangerHint !== null) {
			chain = ui.confirm(_('危险操作确认'), [E('p', {}, dangerHint)], true);
		} else if (args[0] !== 'auto' && this.status.mode === 'auto') {
			chain = ui.confirm(_('退出智能温控'), [E('p', {},
				_('切换到 %s 后，风扇将不再随温度自动调节。仅当温度超过临界值时温控守护会临时接管。')
					.format(label))], true);
		}

		/* 返回整条链: 调用方(和离线测试)需要能等待命令真正落地 */
		return chain.then(function(proceed) {
			if (proceed === false)
				return;
			self.setBusy(true);
			return ctl(args).then(function(res) {
				var kv = parseKV(res.stdout);
				if (res.rc !== 0 || kv.result === 'fail')
					throw new Error(kv.error || (res.stderr || '').trim() || _('设备返回失败'));
				self.sliderTouched = false;
				ui.addNotification(null, E('p', {}, _('%s 已下发。').format(label)), 'info');
			}).catch(function(e) {
				ui.addNotification(null, E('p', {},
					_('%s 失败: %s').format(label, e && e.message ? e.message : e)), 'error');
			}).then(function() {
				self.setBusy(false);
				return self.fetch();
			});
		}).catch(function() { /* 用户取消确认框 */ });
	},

	setBusy: function(busy) {
		this.busy = busy;
		Object.keys(this.refs.levelBtns || {}).forEach(function(k) {
			var btn = this.refs.levelBtns[k];
			if (btn)
				btn.disabled = !!busy;
		}, this);
		if (this.refs.sliderApply)
			this.refs.sliderApply.disabled = !!busy;
	},

	/* ------------------------------ 绘制更新 ------------------------------ */

	paint: function() {
		/* 只看容器是否存在: 首屏渲染时节点尚未挂进文档，也必须完成绘制 */
		if (!this.root)
			return;

		var st = this.status,
			duty = num(st.duty, 0),
			actual = num(st.duty_sysfs, -1),
			pct = dutyPct(duty),
			running = duty > 0,
			alarm = st.alarm || 'none',
			mode = st.mode || 'auto',
			temp = flt(st.temp, NaN),
			age = num(st.age, -1),
			daemonAlive = st.daemon === '1',
			warn = flt(uciget('temp_mid'), 60),
			hot = flt(uciget('temp_high'), 85),
			tone = toneForCelsius(isNaN(temp) ? null : temp, warn, hot),
			self = this;

		/* 风扇动画 */
		if (this.refs.rotor) {
			this.refs.rotor.style.setProperty('--ap-rotor',
				Math.max(0.28, (1 - duty / 255) * 1.25 + 0.28).toFixed(2) + 's');
			/* 只在概览页播放动画，切到其他标签页即暂停 */
			this.refs.rotor.classList.toggle('is-running', running && this.tab === 'overview');
		}

		if (this.refs.dutyBig)
			this.refs.dutyBig.textContent = running ? pct + '%' : '0%';
		if (this.refs.dutyCap)
			this.refs.dutyCap.textContent = running
				? _('设定占空比 %d/255').format(duty)
				: _('风扇停转');

		if (this.refs.fanMeta)
			dom.content(this.refs.fanMeta, pill(
				mode === 'auto' ? _('智能温控') : (mode === 'stepless' ? _('无级调速') : _('手动档位')),
				mode === 'auto' ? 'info' : 'warning'));

		if (this.refs.headerStatus) {
			var tone2 = !daemonAlive ? 'danger' : (alarm === 'none' ? 'good' : alarm);
			dom.content(this.refs.headerStatus, [pill([
				E('span', { 'class': 'ap-dot' + (daemonAlive ? ' ap-dot-live' : '') }),
				daemonAlive ? _('守护进程运行中') : _('温控服务未运行'),
				' · ', agoText(age)
			], tone2)]);
		}

		this.paintAlerts(st, daemonAlive, alarm);
		this.paintRunRows(st, duty, actual, age, daemonAlive);
		this.paintTemps(st, tone, warn, hot);
		this.paintPolicy(st);
		this.paintTrend();
		this.paintControl(st, duty, mode);
		this.paintSensorTable(st, warn, hot);
		this.paintAdvanced(st, daemonAlive);

		/* 曲线预览只在可见时重绘: 橙色"当前点"跟随实测数据 */
		if (this.tab === 'curve')
			this.paintCurve();

		/* 标签页上的告警角标 */
		TABS.forEach(function(t) {
			var btn = self.refs.tabButtons ? self.refs.tabButtons[t.id] : null;
			if (!btn)
				return;
			var badge = btn.querySelector('.ap-tab-badge');
			var want = (alarm !== 'none' && (t.id === 'overview' || t.id === 'control'));
			if (want && !badge) {
				btn.appendChild(E('span', { 'class': 'ap-tab-badge' }, '!'));
			} else if (!want && badge) {
				btn.removeChild(badge);
			}
		});
	},

	paintAlerts: function(st, daemonAlive, alarm) {
		var host = this.refs.alarmHost;
		if (!host)
			return;

		var items = [];
		if (!daemonAlive)
			items.push(['danger', _('温控服务未在运行，风扇当前不受自动调节保护。'),
				_('智能温控依赖常驻守护进程，请检查服务状态。')]);
		if (alarm === 'sensor')
			items.push([st.misses >= 1 ? 'warning' : 'danger', _('温度采样异常'), st.alarm_msg || '']);
		if (alarm === 'thermal')
			items.push(['danger', _('温控守护已接管'), st.alarm_msg || '']);
		if (alarm === 'interface')
			items.push(['danger', _('风扇接口异常'), st.alarm_msg || '']);
		if (st.guarded === '1')
			items.push(['danger', _('临界温度守护生效中'), _('手动/无级设定已被临时覆盖为满速。')]);
		String(st.config_errors || '').split('|').forEach(function(err) {
			if (err.trim())
				items.push(['warning', _('配置项异常'), err.trim()]);
		});

		if (!items.length) {
			dom.content(host, E('div', { 'class': 'ap-alert is-info' }, [
				svgIcon('chip', 18),
				E('div', { 'class': 'ap-alert-body' }, [_('自检通过：温度采集、控制接口与服务运行均正常。')])
			]));
			return;
		}

		dom.content(host, items.map(function(item) {
			return E('div', { 'class': 'ap-alert is-' + item[0] }, [
				svgIcon('alarm', 18),
				E('div', { 'class': 'ap-alert-body' }, [
					E('strong', {}, item[1]),
					E('div', {}, item[2] || ''),
					item[3] ? E('div', { 'class': 'ap-note', 'style': 'margin:6px 0 0' }, item[3]) : ''
				])
			]);
		}));
	},

	paintRunRows: function(st, duty, actual, age, daemonAlive) {
		var host = this.refs.runRows;
		if (!host)
			return;

		var agree = actual < 0 ? ['—', 'muted'] : (actual === duty ? [_('一致'), 'good'] : [_('不一致'), 'danger']);
		dom.content(host, rows([
			[_('执行者'), daemonAlive ? _('airpi-fanctl 守护进程') : _('无（仅静态接口值）'), daemonAlive ? 'good' : 'danger'],
			[_('设定占空比'), '%d / 255 (%d%%)'.format(duty, dutyPct(duty)), 'info'],
			[_('接口实测回读'), actual < 0 ? _('不可读') : '%d / 255 (%d%%)'.format(actual, dutyPct(actual)), agree[1]],
			[_('驱动'), (st.driver || '—') + (st.driver_state ? ' · ' + st.driver_state : ''), 'muted'],
			[_('控制接口'), st.pwm_path || '—', 'muted'],
			[_('控制周期'), (st.interval || '—') + ' s', 'muted'],
			[_('最近采样'), agoText(age), age >= 0 && age <= (num(st.interval, 8) * 3) ? 'good' : 'warning'],
			[_('快照来源'), st.snapshot === 'daemon' ? _('守护进程状态文件') : _('CLI 即时采集'), 'muted']
		]));
	},

	paintTemps: function(st, tone, warn, hot) {
		var host = this.refs.tempChips;
		if (!host)
			return;

		var chips = [];
		['cpu', 'phy', 'wifi', 'modem'].forEach(function(key) {
			var c = mcToC(st[key + '_mc']);
			if (c == null && st[key + '_age'] === '-1' && !st[key + '_err'])
				return;
			chips.push(statChip(
				_(SOURCE_LABEL[key]),
				c == null ? '—' : c.toFixed(1) + ' ℃',
				c == null ? 'idle' : toneForCelsius(c, warn, hot)));
		});
		if (!chips.length)
			chips.push(statChip(_('温度'), _('无有效读数'), 'danger'));

		dom.content(host, chips);
		if (this.refs.tempMeta)
			this.refs.tempMeta.textContent = st.temp_source
				? _('热源: %s').format(_(SOURCE_LABEL[st.temp_source] || st.temp_source))
				: _('暂无热源');
	},

	paintPolicy: function(st) {
		var host = this.refs.policyHost;
		if (!host)
			return;

		var band = num(st.band, 0),
			duties = (st.policy || '').split(/\s+/).map(function(p) {
				return p.split(':')[1];
			});

		dom.content(host, [
			rows([
				[_('生效曲线'), st.policy || '—', 'muted'],
				[_('当前档位'), '%d / 3'.format(band), band >= 3 ? 'danger' : (band > 0 ? 'warning' : 'good')],
				[_('降档迟滞'), (st.hysteresis || '—') + ' ℃', 'muted'],
				[_('最小保持'), (st.min_hold || '—') + ' s', 'muted'],
				[_('临界守护'), st.crit_guard === '1' ? _('开启 (%s ℃)').format(st.temp_crit || uciget('temp_crit') || '95') : _('关闭'),
					st.crit_guard === '1' ? 'good' : 'danger'],
				[_('失效兜底'), 'PWM %s × %s 次'.format(st.fail_duty || '—', st.fail_count || '—'), 'muted'],
				[_('连续失效'), String(st.misses || '0'), num(st.misses, 0) > 0 ? 'warning' : 'good']
			]),
			E('div', { 'style': 'margin-top:12px' }, [
				E('div', { 'class': 'ap-chip-label', 'style': 'margin-bottom:6px' }, _('占空比档位: ' + duties.join(' → ')))
			])
		]);
	},

	paintTrend: function() {
		if (!this.refs.trendHost)
			return;
		dom.content(this.refs.trendHost, [trendChart(this.history)]);
	},

	paintCurve: function() {
		if (!this.refs.curveChart)
			return;
		var cfg = this.curveConfig(),
			invalid = !(cfg.temp_low < cfg.temp_mid && cfg.temp_mid < cfg.temp_high);

		dom.content(this.refs.curveChart, [
			curveChart(cfg),
			invalid
				? E('div', { 'class': 'ap-alert is-danger' }, [
					svgIcon('alarm', 18),
					E('div', { 'class': 'ap-alert-body' }, _('温度阈值必须严格递增，否则后端会拒绝该曲线并回退到出厂阶梯。'))
				])
				: '',
			E('div', { 'class': 'ap-legend' }, [
				E('span', {}, _('低温 %d ℃ → PWM %d').format(cfg.temp_low, cfg.duties[1])),
				E('span', {}, _('中温 %d ℃ → PWM %d').format(cfg.temp_mid, cfg.duties[2])),
				E('span', {}, _('高温 %d ℃ → PWM %d').format(cfg.temp_high, cfg.duties[3])),
				E('span', {}, _('红色虚线为临界守护温度 %d ℃').format(cfg.temp_crit))
			])
		]);
	},

	paintControl: function(st, duty, mode) {
		var codes = { auto: 'auto' };
		[
			[64, 0], [128, 1], [192, 2], [255, 3]
		].forEach(function(p) {
			codes[p[1]] = p[1];
		});

		Object.keys(this.refs.levelBtns || {}).forEach(function(key) {
			var btn = this.refs.levelBtns[key];
			if (!btn)
				return;
			var active = false;
			if (key === 'auto')
				active = mode === 'auto';
			else if (mode === 'manual')
				active = num(st.fanval, -1) === num(key, -1);
			btn.classList.toggle('is-active', active);
			btn.setAttribute('aria-pressed', active ? 'true' : 'false');
		}, this);

		if (this.refs.slider && mode === 'stepless' && !this.sliderTouched)
			this.refs.slider.value = String(duty);
		if (this.refs.sliderText) {
			var v = num(this.refs.slider ? this.refs.slider.value : duty, 0);
			this.refs.sliderText.textContent = 'PWM %d · %d%%'.format(v, dutyPct(v));
		}

		if (this.refs.controlState) {
			var actual = num(st.duty_sysfs, -1);
			dom.content(this.refs.controlState, [
				E('p', { 'class': 'ap-note' }, _('设定值是你要的目标，实测回读是接口当前的真实档位；两者不一致说明有第三方在写同一接口或写入失败。')),
				rows([
					[_('模式'), _(MODE_LABEL[mode] || mode), 'info'],
					[_('fanvall 记录'), String(st.fanval || '—'), 'muted'],
					[_('fanspeed.conf 镜像'), String(st.fanspd || '—'), 'muted'],
					[_('设定占空比'), 'PWM %d (%d%%)'.format(duty, dutyPct(duty)), 'info'],
					[_('实测回读'), actual < 0 ? _('不可读') : 'PWM %d (%d%%)'.format(actual, dutyPct(actual)),
						actual === duty ? 'good' : (actual < 0 ? 'muted' : 'danger')]
				])
			]);
		}
	},

	paintSensorTable: function(st, warn, hot) {
		var body = this.refs.sensorBody;
		if (!body)
			return;

		var paths = {
			cpu: '/sys/class/thermal/thermal_zone*/temp',
			phy: '/sys/class/hwmon/*/temp1_input',
			wifi: 'iwpriv <iface> stat',
			modem: 'ubus call modem_ctrl info'
		};
		var trs = ['cpu', 'phy', 'wifi', 'modem'].map(function(key) {
			var c = mcToC(st[key + '_mc']),
				age = num(st[key + '_age'], -1),
				err = st[key + '_err'] || '',
				state = c == null ? (err || _('无有效读数'))
				: (age < 0 ? _('未知时效') : _('正常'));
			return E('tr', {}, [
				E('td', {}, [
					E('strong', {}, _(SOURCE_LABEL[key])),
					E('div', {}, E('code', {}, paths[key]))
				]),
				E('td', { 'class': 'num' }, c == null ? '—' : c.toFixed(1) + ' ℃'),
				E('td', {}, c == null ? pill(state, 'muted') : pill(agoText(age), age > num(st.slow_interval, 30) * 2 ? 'warning' : 'good')),
				E('td', {}, [
					c == null ? pill(err ? _('不可用') : _('无数据'), 'danger') : pill(_('有效'), 'good'),
					err ? E('div', { 'style': 'font-size:11.5px;color:var(--ap-text-dim);margin-top:4px' }, err) : ''
				])
			]);
		});
		dom.content(body, trs);

		if (this.refs.samplingState) {
			dom.content(this.refs.samplingState, rows([
				[_('主控温度'), st.temp_source ? _(SOURCE_LABEL[st.temp_source]) : _('无'), 'info'],
				[_('快采周期'), (st.interval || '—') + ' s', 'muted'],
				[_('外部命令周期'), (st.slow_interval || '—') + ' s', 'muted'],
				[_('热源判定'), _('取所有有效来源的最大值'), 'muted'],
				[_('无转速反馈'), _('该硬件不提供 tach 输入'), 'muted']
			]));
		}
	},

	paintAdvanced: function(st, daemonAlive) {
		if (!this.refs.serviceState)
			return;

		/* 只更新数据行: 按钮在面板就绪时创建并绑定一次，避免每轮重建 */
		dom.content(this.refs.serviceState, rows([
			[_('守护进程'), daemonAlive ? _('运行中') : _('未运行'), daemonAlive ? 'good' : 'danger'],
			[_('状态文件'), '/tmp/airpi-fan.state', 'muted'],
			[_('日志级别'), (st.log_level || '—') + ' / 3', 'muted'],
			[_('停止后保底占空比'), 'PWM ' + (st.stop_duty || '—'), st.stop_duty === '0' ? 'danger' : 'muted'],
			[_('配置文件'), '/etc/config/airpi-fan', 'muted']
		]));

		if (this.refs.ioHost && !this.ioBuilt) {
			this.ioBuilt = true;
			this.buildIO();
		}
	},

	/* ------------------------------ 硬件与日志 ------------------------------ */

	fetchHardware: function() {
		var self = this;
		this.hwPending = true;
		return ctl(['hwdetect']).then(function(res) {
			self.hw = parseKV(res.stdout);
			self.hwPending = false;
			self.paintHardware();
		}).catch(function(e) {
			self.hwPending = false;
			if (self.refs.hwHost)
				dom.content(self.refs.hwHost, E('div', { 'class': 'ap-alert is-danger' },
					_('硬件探测失败: ') + (e && e.message ? e.message : e)));
		});
	},

	paintHardware: function() {
		if (!this.hw || !this.refs.hwHost)
			return;

		var hw = this.hw,
			hwPwmOk = hw.hw_pwm && hw.hw_pwm !== 'none',
			swLoaded = hw.softpwm_loaded === '1',
			is16g = num(hw.emmc_sectors, 0) > 25000000;

		var svg = E('svg', {
			'viewBox': '0 0 560 150', 'class': 'ap-topo', 'preserveAspectRatio': 'xMidYMid meet',
			'role': 'img', 'aria-label': _('硬件拓扑')
		});
		svg.innerHTML = '' +
			'<rect class="ap-topo-box' + (is16g ? '' : ' is-live') + '" x="8" y="42" rx="12" width="120" height="62"/>' +
			'<text class="ap-topo-t" x="68" y="66" text-anchor="middle">eMMC ' + (hw.emmc_gb || '?') + 'GB</text>' +
			'<text class="ap-topo-s" x="68" y="82" text-anchor="middle">' + (is16g ? '16GB 增强版' : '8GB 标准版') + '</text>' +
			'<text class="ap-topo-s" x="68" y="96" text-anchor="middle">' + (is16g ? '软件 PWM 通道' : '硬件 PWM 通道') + '</text>' +
			'<path class="ap-topo-wire' + (hwPwmOk ? ' is-live is-pulse' : '') + '" d="M128 60 L196 40"/>' +
			'<path class="ap-topo-wire' + (swLoaded ? ' is-live is-pulse' : '') + '" d="M128 86 L196 106"/>' +
			'<rect class="ap-topo-box ' + (hwPwmOk ? 'is-live' : 'is-dead') + '" x="196" y="16" rx="11" width="150" height="46"/>' +
			'<text class="ap-topo-t" x="271" y="36" text-anchor="middle">内核硬件 PWM</text>' +
			'<text class="ap-topo-s" x="271" y="52" text-anchor="middle">' + (hwPwmOk ? hw.hw_pwm : '未挂载') + '</text>' +
			'<rect class="ap-topo-box ' + (swLoaded ? 'is-live' : 'is-dead') + '" x="196" y="84" rx="11" width="150" height="46"/>' +
			'<text class="ap-topo-t" x="271" y="104" text-anchor="middle">airpi_gpio_fan</text>' +
			'<text class="ap-topo-s" x="271" y="120" text-anchor="middle">' + (swLoaded ? '已加载 · duty ' + (hw.duty || 'na') : '未加载') + '</text>' +
			'<path class="ap-topo-wire is-live is-pulse" d="M346 39 C 396 39 396 74 436 74"/>' +
			'<path class="ap-topo-wire is-live is-pulse" d="M346 107 C 396 107 396 74 436 74"/>' +
			'<rect class="ap-topo-box is-live" x="436" y="52" rx="11" width="116" height="44"/>' +
			'<text class="ap-topo-t" x="494" y="72" text-anchor="middle">' + (hw.driver || '—') + '</text>' +
			'<text class="ap-topo-s" x="494" y="87" text-anchor="middle">当前 PWM ' + (hw.duty || 'na') + '/255</text>';

		dom.content(this.refs.hwHost, [
			svg,
			E('div', { 'class': 'ap-chips', 'style': 'margin-top:12px' }, [
				statChip(_('eMMC'), (hw.emmc_gb || '?') + ' GB', is16g ? 'info' : 'good'),
				statChip(_('硬件 PWM'), hwPwmOk ? _('可用') : _('无节点'), hwPwmOk ? 'good' : 'idle'),
				statChip(_('软件 PWM'), swLoaded ? _('已加载') : _('未加载'), swLoaded ? 'good' : 'idle'),
				statChip(_('当前占空比'), String(hw.duty || '—'), 'info'),
				statChip(_('pwmchip'), String(hw.pwmchip || '—'), 'muted'),
				statChip(_('停止保底'), 'PWM ' + (hw.stop_duty || '—'), hw.stop_duty === '0' ? 'danger' : 'good')
			]),
			E('p', { 'class': 'ap-note', 'style': 'margin-top:12px' },
				_('占空比数值直接来自 /sys/kernel/duty_cycle 与 pwm-fan 接口，未做任何换算或推算。'))
		]);

		if (this.refs.hwMeta)
			dom.content(this.refs.hwMeta, pill(_('驱动: %s').format(hw.driver || '—'),
				hw.driver === 'pwm' ? 'info' : 'good'));
	},

	fetchLogs: function() {
		var self = this;
		if (this.logsPending || !this.refs.logHost)
			return Promise.resolve();

		this.logsPending = true;
		dom.content(this.refs.logHost, E('p', { 'class': 'ap-note' }, _('正在读取日志…')));

		return ctl(['logs', '200']).then(function(res) {
			self.logsPending = false;
			var kv = parseKV(res.stdout);
			var text = String(res.stdout || '').replace(/^logfile=.*$/gm, '').trim();
			dom.content(self.refs.logHost, [
				E('pre', { 'class': 'ap-log' }, text || _('（暂无日志，可把日志级别调到"信息"或"调试"）')),
				E('div', { 'class': 'ap-legend' }, [
					E('span', {}, _('来源: ' + (kv.logfile || '/tmp/airpi-fancontrol.log'))),
					E('span', {}, _('时间为 UTC，设备未配置时区数据库'))
				])
			]);
		}).catch(function(e) {
			self.logsPending = false;
			dom.content(self.refs.logHost, E('div', { 'class': 'ap-alert is-danger' },
				_('读取日志失败: ') + (e && e.message ? e.message : e)));
		});
	},

	reloadConfig: function() {
		var self = this;
		uci.save().then(function() {
			dirty.flag = false;
			return ctl(['reload']);
		}).then(function(res) {
			var kv = parseKV(res.stdout);
			ui.addNotification(null, E('p', {},
				kv.reloaded === 'daemon'
					? _('配置已保存，守护进程将在下一个控制周期应用（无需重启，风扇不会中断）。')
					: _('配置已保存并拉起温控服务。')), 'info');
			return self.fetch();
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, _('重载失败: ') + (e && e.message ? e.message : e)), 'error');
		});
	},

	/* --------------------------- 导入 / 导出 / 重置 --------------------------- */

	buildIO: function() {
		var self = this;

		this.refs.exportArea = E('textarea', { 'class': 'ap-area', 'readonly': 'readonly', 'rows': '8' });
		this.refs.importArea = E('textarea', {
			'class': 'ap-area', 'rows': '8',
			'placeholder': _('粘贴 option 形式或 key=value 形式的配置，导入后需保存并应用。')
		});

		var exportBtn = E('button', { 'class': 'ap-btn', 'type': 'button' }, _('导出当前配置'));
		exportBtn.addEventListener('click', function() {
			self.refs.exportArea.value = self.exportConfig();
			self.refs.exportArea.select();
		});
		var importBtn = E('button', { 'class': 'ap-btn is-primary', 'type': 'button' }, _('导入并暂存'));
		importBtn.addEventListener('click', function() {
			self.importConfig(self.refs.importArea.value);
		});
		var resetBtn = E('button', { 'class': 'ap-btn is-danger', 'type': 'button' }, _('恢复出厂设置值'));
		resetBtn.addEventListener('click', function() {
			self.restoreDefaults();
		});

		dom.content(this.refs.ioHost, [
			E('p', { 'class': 'ap-note' }, _('导出内容取自 uci 暂存值；导入只接受本项目已知且范围合法的配置项，其余行会被拒绝并列出。')),
			E('div', { 'class': 'ap-card-title', 'style': 'margin:8px 0 6px' }, _('导出')),
			this.refs.exportArea,
			E('div', { 'class': 'ap-card-title', 'style': 'margin:12px 0 6px' }, _('导入')),
			this.refs.importArea,
			E('div', { 'class': 'ap-actions' }, [exportBtn, importBtn, resetBtn])
		]);
	},

	exportConfig: function() {
		var lines = ['config fan \'' + SECTION + '\''];
		Object.keys(DEFAULTS).forEach(function(key) {
			var value = uci.get(CONFIG, SECTION, key);
			if (value == null || value === '')
				value = this.status[key] != null ? String(this.status[key]) : DEFAULTS[key];
			lines.push('\toption ' + key + ' \'' + String(value).replace(/'/g, '') + '\'');
		}, this);
		return lines.join('\n') + '\n';
	},

	importConfig: function(text) {
		var problems = [],
			accepted = {};

		String(text || '').split('\n').forEach(function(line) {
			var trimmed = line.trim();
			if (!trimmed || trimmed.charAt(0) === '#' || /^config\s/.test(trimmed))
				return;

			var key = null,
				value = null,
				opt = trimmed.match(/^option\s+([a-z0-9_]+)\s+'?(.*?)'?$/i),
				kv = trimmed.match(/^([a-z0-9_]+)=(.*)$/i);

			if (opt) {
				key = opt[1];
				value = opt[2];
			} else if (kv) {
				key = kv[1];
				value = kv[2];
			} else {
				problems.push(_('无法解析: ') + trimmed);
				return;
			}

			if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
				problems.push(_('未知配置项: ') + key);
				return;
			}
			var err = validateOption(key, value);
			if (err) {
				problems.push(key + ': ' + err);
				return;
			}
			accepted[key] = value;
		});

		if (!Object.keys(accepted).length) {
			ui.addNotification(null, E('p', {},
				_('没有可导入的配置项。') + (problems.length ? '\n' + problems.join('\n') : '')), 'error');
			return;
		}

		Object.keys(accepted).forEach(function(key) {
			uci.set(CONFIG, SECTION, key, accepted[key]);
		});

		uci.save().then(L.bind(function() {
			dirty.flag = false;
			ui.addNotification(null, E('p', {},
				_('已写入 %d 项配置，页面将重新加载以反映新值。').format(Object.keys(accepted).length)
				+ (problems.length ? _('（已跳过 %d 项无效内容）').format(problems.length) : '')), 'info');
			location.reload();
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, _('保存失败: ') + (e && e.message ? e.message : e)), 'error');
		});
	},

	restoreDefaults: function() {
		var self = this;
		ui.confirm(_('恢复出厂设置值'), [E('p', {}, _(
			'将删除所有自定义项（驱动选择、温控曲线、安全兜底等），回到出厂默认。保存后守护进程在下一个控制周期应用，风扇不会中断。'))],
			true).then(function(proceed) {
			if (!proceed)
				return;

			Object.keys(DEFAULTS).forEach(function(key) {
				uci.delete(CONFIG, SECTION, key);
			});

			return uci.save().then(function() {
				dirty.flag = false;
				return ctl(['reload']);
			}).then(function() {
				ui.addNotification(null, E('p', {}, _('已恢复出厂设置值并保存。')), 'info');
				location.hash = '#advanced';
				location.reload();
			});
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, _('恢复默认失败: ') + (e && e.message ? e.message : e)), 'error');
		});
	}
});

/* ------------------------------ 通用小工具 ------------------------------ */

function uciget(key) {
	try {
		var v = uci.get(CONFIG, SECTION, key);
		return v == null ? null : String(v);
	} catch (e) {
		return null;
	}
}

/*
 * 注意: 模块体在下面的 `return view.extend(...)` 处结束执行，因此这里只允许
 * 出现函数声明(整体提升)，不能有依赖赋值顺序的 var 初始化。
 */
function validateOption(key, value) {
	var ranges = {
		temp_high: [20, 120, 'float'], temp_mid: [20, 120, 'float'], temp_low: [20, 120, 'float'],
		temp_crit: [20, 120, 'float'], hysteresis: [0, 15, 'float'],
		duty_high: [0, 255, 'int'], duty_mid: [0, 255, 'int'], duty_low: [0, 255, 'int'],
		duty_idle: [0, 255, 'int'], fail_duty: [0, 255, 'int'], stop_duty: [0, 255, 'int'],
		auto_interval: [2, 300, 'int'], slow_interval: [5, 600, 'int'], min_hold: [0, 600, 'int'],
		fail_count: [1, 10, 'int'], fan_gpio: [0, 1023, 'int'], fan_freq: [100, 1000000, 'int'],
		log_level: [0, 3, 'int']
	};
	var range = ranges[key];

	if (range) {
		var n = parseFloat(value);
		if (isNaN(n) || n < range[0] || n > range[1])
			return _('%s 需在 %s 到 %s 之间').format(key, range[0], range[1]);
		if (range[2] === 'int' && String(value).indexOf('.') >= 0)
			return _('%s 必须是整数').format(key);
		return null;
	}
	if (key === 'crit_guard' || /^src_/.test(key)) {
		if (['0', '1', 'yes', 'no', 'on', 'off', 'true', 'false'].indexOf(String(value).toLowerCase()) < 0)
			return _('%s 需为 0 或 1').format(key);
		return null;
	}
	if (key === 'fan_driver') {
		if (['auto', 'pwm', 'softpwm'].indexOf(value) < 0)
			return _('fan_driver 只能是 auto/pwm/softpwm');
		return null;
	}
	return null;
}
