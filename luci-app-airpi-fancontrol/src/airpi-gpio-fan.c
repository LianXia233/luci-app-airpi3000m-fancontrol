/*
 * airpi-gpio-fan.c - AirPi GPIO Bit-Bang Soft-PWM Fan Driver
 *
 * Reconstructed from Airpi-gpio-fan.ko (vermagic: 6.6.133 SMP mod_unload aarch64)
 *
 * This driver creates a software PWM signal on a GPIO pin using a high-resolution
 * timer. The PWM duty cycle is controlled via /sys/kernel/duty_cycle (0-255).
 *
 * Parameters:
 *   fangpio  - GPIO pin number (default 540)
 *   cycle    - Maximum duty cycle value (default 255)
 *   period   - PWM period in microseconds (default 15000, ~66.67Hz)
 *   fanen    - Fan enable: 1=on, 0=off (default 1)
 *
 * License: GPL-2.0-only
 */

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/gpio.h>
#include <linux/hrtimer.h>
#include <linux/ktime.h>
#include <linux/kobject.h>
#include <linux/sysfs.h>
#include <linux/delay.h>

#define DRV_NAME    "airpi_gpio_fan"
#define DRV_VERSION "3.0.0"

/* Module parameters */
static int fangpio = 540;
module_param(fangpio, int, 0644);
MODULE_PARM_DESC(fangpio, "GPIO pin number for fan PWM output");

static int cycle = 255;
module_param(cycle, int, 0644);
MODULE_PARM_DESC(cycle, "Maximum duty cycle value (0-255)");

static int period = 15000;
module_param(period, int, 0644);
MODULE_PARM_DESC(period, "PWM period in microseconds");

static int fanen = 1;
module_param(fanen, int, 0644);
MODULE_PARM_DESC(fanen, "Fan enable: 1=on, 0=off (output LOW)");

/* Runtime state */
static unsigned int duty_cycle_val = 0;
static struct hrtimer pwm_timer;
static ktime_t kperiod;
static int timer_running = 0;
static DEFINE_MUTEX(pwm_mutex);

/* Number of ticks per period: cycle+1 slices for 0..cycle resolution */
#define PWM_TICKS 256  /* 0-255 = 256 slices */

/*
 * The PWM engine works as follows:
 *   - One full PWM period = 'period' microseconds
 *   - Each tick = period / PWM_TICKS microseconds
 *   - duty_cycle_val (0-255) ticks output HIGH, remaining ticks output LOW
 *   - hrtimer fires every tick
 */

/* ---- hrtimer callback ---- */
static enum hrtimer_restart pwm_timer_cb(struct hrtimer *timer)
{
	static unsigned int tick;
	ktime_t now, next;
	unsigned long on_ticks;
	unsigned int slice_us;

	if (!fanen) {
		gpio_set_value(fangpio, 0);
		tick = 0;
		next = ktime_add(ktime_get(), kperiod);
		hrtimer_forward(timer, ktime_get(), kperiod);
		return HRTIMER_RESTART;
	}

	slice_us = period / PWM_TICKS;
	if (slice_us < 1)
		slice_us = 1;

	on_ticks = (unsigned long)duty_cycle_val;

	if (tick < on_ticks && on_ticks > 0)
		gpio_set_value(fangpio, 1);
	else
		gpio_set_value(fangpio, 0);

	tick++;
	if (tick >= PWM_TICKS)
		tick = 0;

	now = ktime_get();
	next = ktime_add_ns(now, (u64)slice_us * 1000ULL);
	hrtimer_forward(timer, now, ktime_set(0, slice_us * 1000));
	return HRTIMER_RESTART;
}

static void start_pwm_timer(void)
{
	unsigned int slice_us;

	mutex_lock(&pwm_mutex);
	if (timer_running) {
		mutex_unlock(&pwm_mutex);
		return;
	}

	slice_us = period / PWM_TICKS;
	if (slice_us < 1)
		slice_us = 1;

	kperiod = ktime_set(0, period * 1000);
	hrtimer_init(&pwm_timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
	pwm_timer.function = pwm_timer_cb;
	hrtimer_start(&pwm_timer, ktime_set(0, slice_us * 1000), HRTIMER_MODE_REL);
	timer_running = 1;
	mutex_unlock(&pwm_mutex);

	pr_info(DRV_NAME ": PWM timer started (period=%d us, freq=%d Hz)\n",
		period, 1000000 / period);
}

static void stop_pwm_timer(void)
{
	mutex_lock(&pwm_mutex);
	if (timer_running) {
		hrtimer_cancel(&pwm_timer);
		timer_running = 0;
	}
	mutex_unlock(&pwm_mutex);
	pr_info(DRV_NAME ": PWM timer stopped\n");
}

/* ---- /sys/kernel/duty_cycle ---- */
static struct kobject *fan_kobj;

static ssize_t duty_cycle_show(struct kobject *kobj,
			       struct kobj_attribute *attr, char *buf)
{
	return scnprintf(buf, PAGE_SIZE, "%u\n", duty_cycle_val);
}

static ssize_t duty_cycle_store(struct kobject *kobj,
				struct kobj_attribute *attr,
				const char *buf, size_t count)
{
	unsigned int val;
	int ret;

	ret = kstrtouint(buf, 0, &val);
	if (ret < 0)
		return ret;

	if (val > (unsigned int)cycle)
		val = (unsigned int)cycle;

	duty_cycle_val = val;
	return count;
}

static struct kobj_attribute duty_cycle_attr =
	__ATTR(duty_cycle, 0664, duty_cycle_show, duty_cycle_store);

static struct attribute *fan_attrs[] = {
	&duty_cycle_attr.attr,
	NULL,
};

static struct attribute_group fan_attr_group = {
	.attrs = fan_attrs,
};

/* ---- module init / exit ---- */

static int __init airpi_gpio_fan_init(void)
{
	int ret;

	pr_info(DRV_NAME ": AirPi GPIO soft-PWM fan driver v%s loading\n", DRV_VERSION);
	pr_info(DRV_NAME ": GPIO=%d, cycle=%d, period=%d us, fanen=%d\n",
		fangpio, cycle, period, fanen);

	/* Request GPIO */
	ret = gpio_request(fangpio, "airpi-fan-pwm");
	if (ret) {
		pr_err(DRV_NAME ": Failed to request GPIO %d (err=%d)\n", fangpio, ret);
		return ret;
	}

	ret = gpio_direction_output(fangpio, 0);
	if (ret) {
		pr_err(DRV_NAME ": Failed to set GPIO %d direction (err=%d)\n", fangpio, ret);
		gpio_free(fangpio);
		return ret;
	}

	/* Create sysfs entry */
	fan_kobj = kobject_create_and_add("kernel", NULL);
	if (!fan_kobj) {
		pr_err(DRV_NAME ": Failed to create kernel kobject\n");
		gpio_free(fangpio);
		return -ENOMEM;
	}

	ret = sysfs_create_group(fan_kobj, &fan_attr_group);
	if (ret) {
		pr_err(DRV_NAME ": Failed to create sysfs group (err=%d)\n", ret);
		kobject_put(fan_kobj);
		gpio_free(fangpio);
		return ret;
	}

	/* Start PWM timer if fan enabled */
	start_pwm_timer();

	pr_info(DRV_NAME ": Module loaded successfully\n");
	return 0;
}

static void __exit airpi_gpio_fan_exit(void)
{
	stop_pwm_timer();

	/* Output LOW on exit to stop fan */
	gpio_set_value(fangpio, 0);
	gpio_free(fangpio);

	sysfs_remove_group(fan_kobj, &fan_attr_group);
	kobject_put(fan_kobj);

	pr_info(DRV_NAME ": Module unloaded\n");
}

module_init(airpi_gpio_fan_init);
module_exit(airpi_gpio_fan_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("AirPi Community");
MODULE_DESCRIPTION("AirPi GPIO soft-PWM fan driver");
MODULE_VERSION(DRV_VERSION);
