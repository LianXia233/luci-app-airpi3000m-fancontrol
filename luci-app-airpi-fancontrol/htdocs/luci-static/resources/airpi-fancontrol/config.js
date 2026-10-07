'use strict';
'require uci';

/*
 * airpi-fancontrol / config
 * UCI 配置层：负责 airpi-fan 配置的读取、修改、保存与应用。
 * UI 组件不得直接操作 UCI，统一走本模块。
 */

var CONFIG = 'airpi-fan';
var SECTION = 'settings';

function load() {
	return uci.load(CONFIG);
}

function get(option) {
	return uci.get(CONFIG, SECTION, option);
}

function getAll() {
	return uci.get(CONFIG, SECTION);
}

function set(option, value) {
	return uci.set(CONFIG, SECTION, option, value);
}

function save() {
	return uci.save(CONFIG);
}

function apply() {
	return uci.apply();
}

function saveAndApply() {
	return save().then(function() {
		return apply();
	});
}

/* 默认值（与 /etc/config/airpi-fan 及 init.d 保持一致） */
var DEFAULTS = {
	fan_driver: 'auto',
	fan_gpio: '540',
	fan_freq: '15000'
};

return {
	CONFIG: CONFIG,
	SECTION: SECTION,
	DEFAULTS: DEFAULTS,
	load: load,
	get: get,
	getAll: getAll,
	set: set,
	save: save,
	apply: apply,
	saveAndApply: saveAndApply
};
