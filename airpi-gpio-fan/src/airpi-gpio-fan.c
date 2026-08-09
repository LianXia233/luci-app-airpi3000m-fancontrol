/*
 * airpi-gpio-fan.c - AirPi GPIO Bit-Bang Soft-PWM Fan Driver
 *
 * Kernel compatibility: 4.14 LTS up to latest immortalwrt mainline (6.12+).
 *
 *  GPIO API selection:
 *    - Kernels < 6.14 : legacy integer GPIO API (gpio_request / gpio_set_value)
 *                       Symbols are in the GPIO_LEGACY export namespace from 5.15;
 *                       MODULE_IMPORT_NS is declared below for strict-namespace kernels.
 *    - Kernels >= 6.14: GPIO descriptor API via gpio_to_desc() + gpiod_* functions.
 *                       The legacy gpio_request() is still used to claim the pin by
 *                       number (there is no device-context-free gpiod equivalent);
 *                       all direction/value operations use the descriptor API.
 *
 *  hrtimer API:
 *    - Kernels < 6.15 : hrtimer_init() + .function assignment
 *    - Kernels >= 6.15: hrtimer_setup() (hrtimer_init was removed)
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
#include <linux/hrtimer.h>
#include <linux/ktime.h>
#include <linux/kobject.h>
#include <linux/sysfs.h>
#include <linux/delay.h>
#include <linux/version.h>

/*
 * GPIO API: choose descriptor-based (gpiod) on kernels >= 6.14, and legacy
 * integer API on older kernels.  Both paths need the legacy gpio_request()
 * call to claim the numbered GPIO because there is no descriptor-API equivalent
 * that works without a device context (DT/ACPI).
 */
#if LINUX_VERSION_CODE >= KERNEL_VERSION(6, 14, 0)
#  include <linux/gpio.h>          /* gpio_request / gpio_free (claim by number) */
#  include <linux/gpio/consumer.h> /* gpio_to_desc / gpiod_direction_output / gpiod_set_value */
#  define FAN_USE_GPIOD 1
#else
#  include <linux/gpio.h>
#  define FAN_USE_GPIOD 0
#endif

/*
 * Legacy GPIO integer symbols (gpio_request, gpio_set_value, …) were moved to
 * the GPIO_LEGACY export-symbol namespace in Linux 5.15.  Declare the import so
 * modules load correctly on kernels built with strict namespace enforcement.
 * In kernel 6.13 the MODULE_IMPORT_NS() macro changed to take a string literal.
 */
#if LINUX_VERSION_CODE >= KERNEL_VERSION(6, 13, 0)
MODULE_IMPORT_NS("GPIO_LEGACY");
#elif LINUX_VERSION_CODE >= KERNEL_VERSION(5, 15, 0)
MODULE_IMPORT_NS(GPIO_LEGACY);
#endif

#define DRV_NAME    "airpi_gpio_fan"
#define DRV_VERSION "3.4.0"

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

#if FAN_USE_GPIOD
static struct gpio_desc *fan_desc;
#endif

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
	unsigned long on_ticks;
	unsigned int slice_us;

	if (!fanen) {
#if FAN_USE_GPIOD
		gpiod_set_value(fan_desc, 0);
#else
		gpio_set_value(fangpio, 0);
#endif
		tick = 0;
		hrtimer_forward(timer, ktime_get(), kperiod);
		return HRTIMER_RESTART;
	}

	slice_us = period / PWM_TICKS;
	if (slice_us < 1)
		slice_us = 1;

	on_ticks = (unsigned long)duty_cycle_val;

	if (tick < on_ticks && on_ticks > 0) {
#if FAN_USE_GPIOD
		gpiod_set_value(fan_desc, 1);
#else
		gpio_set_value(fangpio, 1);
#endif
	} else {
#if FAN_USE_GPIOD
		gpiod_set_value(fan_desc, 0);
#else
		gpio_set_value(fangpio, 0);
#endif
	}

	tick++;
	if (tick >= PWM_TICKS)
		tick = 0;

	hrtimer_forward(timer, ktime_get(),
			ktime_set(0, (long)slice_us * 1000L));
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

	kperiod = ktime_set(0, (long)period * 1000L);
#if LINUX_VERSION_CODE >= KERNEL_VERSION(6, 15, 0)
	hrtimer_setup(&pwm_timer, pwm_timer_cb, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
#else
	hrtimer_init(&pwm_timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
	pwm_timer.function = pwm_timer_cb;
#endif
	hrtimer_start(&pwm_timer, ktime_set(0, (long)slice_us * 1000L),
		      HRTIMER_MODE_REL);
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

/* ---- module init / exit ---- */

static int __init airpi_gpio_fan_init(void)
{
	int ret;

	pr_info(DRV_NAME ": AirPi GPIO soft-PWM fan driver v%s loading\n", DRV_VERSION);

	/* Sanity-check module parameters before they reach the timer maths */
	if (period < PWM_TICKS || period > 1000000) {
		pr_warn(DRV_NAME ": period=%d out of range, falling back to 15000 us\n",
			period);
		period = 15000;
	}
	if (cycle < 1 || cycle > 255) {
		pr_warn(DRV_NAME ": cycle=%d out of range, falling back to 255\n", cycle);
		cycle = 255;
	}

	pr_info(DRV_NAME ": GPIO=%d, cycle=%d, period=%d us, fanen=%d\n",
		fangpio, cycle, period, fanen);

	/* Request GPIO */
	ret = gpio_request(fangpio, "airpi-fan-pwm");
	if (ret) {
		pr_err(DRV_NAME ": Failed to request GPIO %d (err=%d)\n", fangpio, ret);
		return ret;
	}

#if FAN_USE_GPIOD
	fan_desc = gpio_to_desc(fangpio);
	if (!fan_desc) {
		pr_err(DRV_NAME ": Failed to get GPIO descriptor for pin %d\n", fangpio);
		gpio_free(fangpio);
		return -ENODEV;
	}
	ret = gpiod_direction_output(fan_desc, 0);
#else
	ret = gpio_direction_output(fangpio, 0);
#endif
	if (ret) {
		pr_err(DRV_NAME ": Failed to set GPIO %d direction (err=%d)\n", fangpio, ret);
		gpio_free(fangpio);
		return ret;
	}

	/*
	 * Attach the attribute to the existing /sys/kernel kobject exported by
	 * the kernel. Creating our own kobject named "kernel" would collide
	 * with it and fail, leaving userspace without /sys/kernel/duty_cycle.
	 */
	ret = sysfs_create_file(kernel_kobj, &duty_cycle_attr.attr);
	if (ret) {
		pr_err(DRV_NAME ": Failed to create /sys/kernel/duty_cycle (err=%d)\n", ret);
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

	sysfs_remove_file(kernel_kobj, &duty_cycle_attr.attr);

	/* Output LOW on exit to stop fan */
#if FAN_USE_GPIOD
	gpiod_set_value(fan_desc, 0);
#else
	gpio_set_value(fangpio, 0);
#endif
	gpio_free(fangpio);

	pr_info(DRV_NAME ": Module unloaded\n");
}

module_init(airpi_gpio_fan_init);
module_exit(airpi_gpio_fan_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("AirPi Community");
MODULE_DESCRIPTION("AirPi GPIO soft-PWM fan driver");
MODULE_VERSION(DRV_VERSION);
