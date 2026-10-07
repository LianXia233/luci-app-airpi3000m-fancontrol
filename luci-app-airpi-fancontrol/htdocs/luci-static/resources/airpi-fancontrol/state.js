'use strict';

/*
 * airpi-fancontrol / state
 * 页面状态层：单一数据源 + 订阅通知。
 * 组件通过 subscribe 感知状态变化并刷新视图，避免各自维护散乱状态。
 */

var listeners = [];

var state = {
	/* 运行状态（status 命令） */
	status: null,
	/* 温度（temp 命令） */
	temp: null,
	/* 多传感器（temps 命令） */
	temps: null,
	/* 硬件探测（hwdetect 命令） */
	hw: null,
	/* UCI 配置 */
	cfg: null,
	/* 刷新节流标记 */
	lastRefresh: 0,
	/* 请求进行中标记（防止重叠） */
	busy: false,
	/* 全局错误（连续失败时置位） */
	error: null
};

function set(partial) {
	Object.keys(partial || {}).forEach(function(k) {
		state[k] = partial[k];
	});
	listeners.forEach(function(fn) {
		try { fn(state); } catch (e) { /* 单个监听器异常不影响其它监听器 */ }
	});
}

function subscribe(fn) {
	if (listeners.indexOf(fn) < 0)
		listeners.push(fn);
	return function() {
		var i = listeners.indexOf(fn);
		if (i >= 0)
			listeners.splice(i, 1);
	};
}

function get() {
	return state;
}

return {
	get: get,
	set: set,
	subscribe: subscribe
};
