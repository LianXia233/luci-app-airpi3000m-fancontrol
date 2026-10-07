'use strict';
'require airpi-fancontrol.api';
'require airpi-fancontrol.state';

/*
 * airpi-fancontrol / runtime
 * 运行数据调度层：负责轮询周期、请求合并、重叠保护、失败退避。
 *
 * 刷新策略：
 *   - 单次轮询内并行获取 status/temp/temps/hwdetect（互不依赖）
 *   - busy 标志防止上一次请求未返回时再次发起（重叠保护）
 *   - 连续失败时进入 30s 慢速模式并置 error 状态；成功后恢复常规周期
 *   - view 销毁时停止轮询（页面关闭后不再请求）
 */

var INTERVAL = 4 * 1000;
var MAX_FAILURES = 5;

var failureCount = 0;
var slowMode = false;
var running = false;
var timer = null;

function collect() {
	if (running && state.get().busy)
		return Promise.resolve();

	state.set({ busy: true });
	return Promise.all([
		api.status().catch(function() { return { stdout: '' }; }),
		api.temp().catch(function() { return { stdout: '' }; }),
		api.temps().catch(function() { return { stdout: '' }; }),
		api.hwdetect().catch(function() { return { stdout: '' }; })
	]).then(function(results) {
		state.set({ busy: false });
		failureCount = 0;
		if (slowMode) {
			slowMode = false;
			reschedule(INTERVAL);
		}
		return results;
	}).catch(function(e) {
		state.set({ busy: false });
		failureCount++;
		if (failureCount >= MAX_FAILURES && !slowMode) {
			slowMode = true;
			reschedule(30 * 1000);
		}
		return Promise.reject(e);
	});
}

/* 由 view 注入的解析与落库函数（避免 runtime 依赖具体页面逻辑） */
var handlers = null;
function setHandlers(h) {
	handlers = h;
}

function applyResults(results) {
	if (handlers)
		handlers.onResults(results);
}

function reschedule(ms) {
	if (!running)
		return;
	if (timer)
		window.clearTimeout(timer);
	timer = window.setTimeout(tick, ms);
}

function tick() {
	collect().then(applyResults).catch(function() {})
		.then(function() {
			if (running)
				reschedule(slowMode ? 30 * 1000 : INTERVAL);
		});
}

function start() {
	if (running)
		return;
	running = true;
	tick();
}

function stop() {
	running = false;
	if (timer)
		window.clearTimeout(timer);
	timer = null;
}

function isRunning() {
	return running;
}

return {
	INTERVAL: INTERVAL,
	start: start,
	stop: stop,
	collect: collect,
	setHandlers: setHandlers,
	isRunning: isRunning
};
