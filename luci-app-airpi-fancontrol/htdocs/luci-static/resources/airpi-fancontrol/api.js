'use strict';
'require fs';

/*
 * airpi-fancontrol / api
 * RPC 封装层：所有对 airpi-fanctl 的调用集中于此。
 * 页面组件禁止直接调用 fs.exec，统一走本模块。
 */

var CTL = '/usr/bin/airpi-fanctl.sh';
var INITD = '/etc/init.d/airpi-fancontrol';

function ctl(args) {
	return fs.exec(CTL, args);
}

function status() {
	return ctl(['status']);
}

function temp() {
	return ctl(['temp']);
}

function temps() {
	return ctl(['temps']);
}

function hwdetect() {
	return ctl(['hwdetect']);
}

function setSpeed(speed, code) {
	return ctl(['set', String(speed), String(code)]);
}

function setAuto() {
	return ctl(['auto']);
}

function setStepless(speed) {
	return ctl(['stepless', String(speed)]);
}

function reloadDriver() {
	return ctl(['reload']);
}

function service(action) {
	/* action: start | stop | restart | reload */
	return fs.exec(INITD, [action]);
}

return {
	CTL: CTL,
	INITD: INITD,
	ctl: ctl,
	status: status,
	temp: temp,
	temps: temps,
	hwdetect: hwdetect,
	setSpeed: setSpeed,
	setAuto: setAuto,
	setStepless: setStepless,
	reloadDriver: reloadDriver,
	service: service
};
