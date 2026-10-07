'use strict';
'require airpi-fancontrol.utils';
'require airpi-fancontrol.api';
'require airpi-fancontrol.config';
'require airpi-fancontrol.components.icons';

/*
 * airpi-fancontrol / components.config-panel
 * 高级配置面板：驱动模式 / GPIO 引脚 / 调制周期。
 * 读取与保存均走 UCI（/etc/config/airpi-fan），保存后触发服务 reload。
 *
 * 与原版 form.Map 等价，但完全自定义渲染，样式统一。
 */

function build(actions) {
	var driverSel = E('select', { 'class': 'afc-select' }, [
		E('option', { 'value': 'auto' }, _('自动感知与适配 (推荐)')),
		E('option', { 'value': 'pwm' }, _('硬件 PWM (pwm-fan)')),
		E('option', { 'value': 'softpwm' }, _('软件 PWM (GPIO 软中断)'))
	]);
	var gpioInput = E('input', { 'type': 'text', 'class': 'afc-input', 'placeholder': '540' });
	var freqInput = E('input', { 'type': 'text', 'class': 'afc-input', 'placeholder': '15000' });

	function loadInto() {
		return config.load().then(function() {
			var all = config.getAll() || {};
			driverSel.value = all.fan_driver || config.DEFAULTS.fan_driver;
			gpioInput.value = all.fan_gpio || config.DEFAULTS.fan_gpio;
			freqInput.value = all.fan_freq || config.DEFAULTS.fan_freq;
		}).catch(function() {
			driverSel.value = config.DEFAULTS.fan_driver;
			gpioInput.value = config.DEFAULTS.fan_gpio;
			freqInput.value = config.DEFAULTS.fan_freq;
		});
	}

	function row(label, desc, control) {
		return E('div', { 'class': 'afc-form-row' }, [
			E('div', {}, [
				E('div', { 'class': 'afc-form-label' }, label),
				E('div', { 'class': 'afc-form-desc' }, desc)
			]),
			E('div', { 'class': 'afc-form-control' }, control)
		]);
	}

	var card = E('div', { 'class': 'afc-card' }, [
		E('div', { 'class': 'afc-card-head' }, [
			E('div', { 'class': 'afc-card-title' }, [
				E('span', { 'html': icons.gear }),
				_('高级配置')
			]),
			E('span', { 'class': 'afc-card-sub' }, _('/etc/config/airpi-fan'))
		]),
		row(_('风扇驱动调度策略'), _('自动模式根据 eMMC 规格自动适配，亦可手动指定。'),
			driverSel),
		row(_('风扇引脚 GPIO 编号'), _('软 PWM 输出引脚，AP3000M 默认为 540。'),
			gpioInput),
		row(_('调制脉冲信号周期 (μs)'), _('PWM 周期，默认 15000μs (约 66.7Hz)。'),
			freqInput),
		E('div', { 'style': 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px' }, [
			E('button', { 'type': 'button', 'class': 'afc-btn', 'id': 'afc-cfg-save' }, _('保存')),
			E('button', { 'type': 'button', 'class': 'afc-btn afc-btn--primary', 'id': 'afc-cfg-apply' }, _('保存并重载驱动'))
		])
	]);

	card.querySelector('#afc-cfg-save').addEventListener('click', function() {
		save(false);
	});
	card.querySelector('#afc-cfg-apply').addEventListener('click', function() {
		save(true);
	});

	function collect() {
		return {
			fan_driver: driverSel.value || config.DEFAULTS.fan_driver,
			fan_gpio: gpioInput.value || config.DEFAULTS.fan_gpio,
			fan_freq: freqInput.value || config.DEFAULTS.fan_freq
		};
	}

	function save(withReload) {
		config.load().then(function() {
			var vals = collect();
			return config.set('fan_driver', vals.fan_driver)
				.then(function() { return config.set('fan_gpio', vals.fan_gpio); })
				.then(function() { return config.set('fan_freq', vals.fan_freq); })
				.then(function() { return config.saveAndApply(); });
		}).then(function() {
			actions.onSaved(vals, withReload);
			if (withReload)
				return api.reloadDriver().catch(function() {});
			return null;
		}).then(function() {
			if (withReload)
				actions.onReloaded();
		}).catch(function(e) {
			actions.onSaveError(e);
		});
	}

	return { card: card, loadInto: loadInto };
}

return { build: build };
