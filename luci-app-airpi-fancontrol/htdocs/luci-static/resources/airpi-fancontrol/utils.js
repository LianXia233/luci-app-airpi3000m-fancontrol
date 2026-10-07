'use strict';

/*
 * airpi-fancontrol / utils
 * 通用工具：KV 解析、数值格式化、DOM 辅助、防抖。
 */

function parseKV(s) {
	var o = {};
	String(s || '').split('\n').forEach(function(line) {
		var i = line.indexOf('=');
		if (i > 0)
			o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	});
	return o;
}

function toInt(v, fallback) {
	var n = parseInt(v, 10);
	return isNaN(n) ? (fallback || 0) : n;
}

function clamp(v, min, max) {
	return Math.min(max, Math.max(min, v));
}

function pct(speed) {
	return Math.round(clamp(speed, 0, 255) / 255 * 100);
}

function debounce(fn, delay) {
	var timer = null;
	return function() {
		var ctx = this, args = arguments;
		if (timer)
			window.clearTimeout(timer);
		timer = window.setTimeout(function() {
			timer = null;
			fn.apply(ctx, args);
		}, delay);
	};
}

function el(tag, attrs, children) {
	var node = document.createElement(tag);
	if (attrs)
		Object.keys(attrs).forEach(function(k) {
			if (k === 'class')
				node.className = attrs[k];
			else if (k === 'html')
				node.innerHTML = attrs[k];
			else
				node.setAttribute(k, attrs[k]);
		});
	(children || []).forEach(function(child) {
		if (child != null)
			node.appendChild(
				typeof child === 'string' ? document.createTextNode(child) : child);
	});
	return node;
}

function clear(node) {
	while (node.firstChild)
		node.removeChild(node.firstChild);
}

return {
	parseKV: parseKV,
	toInt: toInt,
	clamp: clamp,
	pct: pct,
	debounce: debounce,
	el: el,
	clear: clear
};
