/*
 * airpi-gpio-fan.c - AirPi GPIO Bit-Bang Soft-PWM Fan Driver
 *
 * Supported kernels: Linux 6.0 - 6.19 (source level; build per target vermagic)
 *
 * Kernel compatibility is converged into three conditionals; the PWM engine,
 * the sysfs interface and the module plumbing carry no version branching.
 *
 *   1) GPIO acquisition path
 *
 *      The legacy integer interface (gpio_request()/gpio_free()) moved into the
 *      GPIO_LEGACY export namespace in 5.15 and -- more importantly -- became
 *      optional on 6.17 via CONFIG_GPIOLIB_LEGACY (commit 678bae2eaa81,
 *      "gpiolib: make legacy interfaces optional").  When that symbol is
 *      disabled the legacy wrappers are not built at all, so any module calling
 *      gpio_request() fails to load with "Unknown symbol".
 *
 *      CONFIG_GPIOLIB_LEGACY is a *configuration* item, not a version item, so
 *      it is probed with IS_ENABLED() instead of being inferred from
 *      LINUX_VERSION_CODE:
 *
 *        - IS_ENABLED(CONFIG_GPIOLIB_LEGACY) || < 6.17  ->  legacy path
 *          gpio_request() is guaranteed to exist (kernels before 6.17 have no
 *          such switch at all and always build gpiolib-legacy.o).
 *
 *        - 6.17+ with the switch off  ->  descriptor path
 *          legacy symbols are gone, so the pin is acquired the proper way:
 *          derive (chip label, chip-relative hwnum) from the global GPIO number,
 *          publish it through a gpiod lookup table bound to our own platform
 *          device, then claim it with gpiod_get_index().  This keeps full
 *          gpiolib ownership tracking (the descriptor is requested) and needs
 *          no device tree change.
 *
 *      Note that gpiod_request() is NOT usable here: it is an internal gpiolib
 *      interface, neither exported nor declared in <linux/gpio/consumer.h>.
 *      gpiod_get_index() is the public, exported equivalent.
 *
 *   2) hrtimer initialisation
 *      hrtimer_init() was deleted in 6.15 and replaced by hrtimer_setup().
 *
 *   3) Everything else uses interfaces that are stable across the whole 6.x
 *      range: gpio_to_desc(), gpiod_direction_output(), gpiod_set_value(),
 *      gpiod_put(), hrtimer_start(), hrtimer_cancel(), hrtimer_forward_now().
 *
 * Userspace interface (unchanged, LuCI compatible):
 *   /sys/kernel/duty_cycle    write 0..cycle, read back the current value
 *
 * Module parameters:
 *   fangpio  - global GPIO number driving the fan (default 540, load time only)
 *   cycle    - upper bound of the duty_cycle value (default 255 -> 256 levels)
 *   period   - PWM period in microseconds (default 15000, about 66.7 Hz)
 *   fanen    - 1 = run the PWM engine, 0 = output LOW and stop the timer
 *
 * duty_cycle is linearly mapped onto the fixed 256-slice PWM resolution, so a
 * value equal to `cycle` yields a permanent HIGH (true 100% duty) and 0 yields
 * a permanent LOW.  The timer is stopped in both of those cases as an
 * optimisation and restarted as soon as an intermediate value is written.
 *
 * License: GPL-2.0-only
 */

#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/kconfig.h>
#include <linux/version.h>
#include <linux/init.h>
#include <linux/hrtimer.h>
#include <linux/ktime.h>
#include <linux/kobject.h>
#include <linux/sysfs.h>
#include <linux/slab.h>
#include <linux/string.h>
#include <linux/mutex.h>
#include <linux/overflow.h>
#include <linux/gpio/consumer.h>

/* ======================================================================== */
/* Compatibility layer 1: GPIO acquisition path                             */
/* ======================================================================== */

#if IS_ENABLED(CONFIG_GPIOLIB_LEGACY) || LINUX_VERSION_CODE < KERNEL_VERSION(6, 17, 0)

#define FAN_GPIO_USE_LEGACY 1
#include <linux/gpio.h>

#if LINUX_VERSION_CODE >= KERNEL_VERSION(6, 13, 0)
MODULE_IMPORT_NS("GPIO_LEGACY");
#else
MODULE_IMPORT_NS(GPIO_LEGACY);
#endif

#else /* 6.17+ with CONFIG_GPIOLIB_LEGACY disabled */

#define FAN_GPIO_USE_LEGACY 0
#include <linux/gpio/driver.h>
#include <linux/gpio/machine.h>
#include <linux/platform_device.h>

#endif /* GPIO acquisition path */

/* ======================================================================== */
/* Compatibility layer 2: hrtimer initialisation                            */
/* ======================================================================== */

static inline void fan_hrtimer_setup(struct hrtimer *timer,
				     enum hrtimer_restart (*cb)(struct hrtimer *))
{
#if LINUX_VERSION_CODE >= KERNEL_VERSION(6, 15, 0)
	hrtimer_setup(timer, cb, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
#else
	hrtimer_init(timer, CLOCK_MONOTONIC, HRTIMER_MODE_REL);
	timer->function = cb;
#endif
}

/* ======================================================================== */

#define DRV_NAME    "airpi_gpio_fan"
#define DRV_VERSION "4.0.0"

/* A PWM period is divided into this many fixed slices. */
#define PWM_SLICES  256

/*
 * Function name the fan pin is published and claimed under.  It also becomes
 * the line label shown in /sys/kernel/debug/gpio, so it deliberately matches
 * the label used by the previous revision to keep field diagnostics
 * comparable.
 */
#define FAN_GPIO_CON_ID "airpi-fan-pwm"

/* ------------------------------------------------------------------------ */
/* Module parameters                                                        */
/* ------------------------------------------------------------------------ */

static int fangpio = 540;
module_param(fangpio, int, 0444);
MODULE_PARM_DESC(fangpio, "Global GPIO number driving the fan (load time only)");

static int cycle = 255;
module_param(cycle, int, 0644);
MODULE_PARM_DESC(cycle, "Upper bound of the duty_cycle value (1-255)");

static int period = 15000;
module_param(period, int, 0644);
MODULE_PARM_DESC(period, "PWM period in microseconds (256-1000000)");

static int fanen = 1;
static int fanen_set(const char *val, const struct kernel_param *kp);

static const struct kernel_param_ops fanen_ops = {
	.set = fanen_set,
	.get = param_get_int,
};
module_param_cb(fanen, &fanen_ops, &fanen, 0644);
MODULE_PARM_DESC(fanen, "Fan enable: 1 = PWM output, 0 = output LOW and stop");

/* ------------------------------------------------------------------------ */
/* Runtime state                                                            */
/* ------------------------------------------------------------------------ */

/*
 * Single instance state.  Pulled into a struct so that a future multi-fan
 * variant does not have to fight file-scope statics (the previous revision kept
 * the PWM slice counter as a function-local static).
 */
struct fan_state {
	struct gpio_desc	*desc;
	struct hrtimer		timer;
	unsigned int		duty;	/* logical value, 0..cycle */
	unsigned int		tick;	/* current slice, 0..PWM_SLICES-1 */
	bool			running;
#if !FAN_GPIO_USE_LEGACY
	struct platform_device		*pdev;
	struct gpiod_lookup_table	*lookup;
#endif
};

static struct fan_state fan;
static DEFINE_MUTEX(fan_lock);

/* ------------------------------------------------------------------------ */
/* duty value <-> slice conversion                                          */
/* ------------------------------------------------------------------------ */

/*
 * Map the user visible value (0..limit) onto the fixed slice resolution.
 * duty == limit maps to PWM_SLICES, i.e. a permanent HIGH -- the previous
 * revision could never reach 100% because it compared the slice index directly
 * against the raw duty value (255 of 256 slices).
 */
static unsigned int fan_duty_to_slices(unsigned int duty, unsigned int limit)
{
	if (limit == 0)
		return 0;
	if (duty >= limit)
		return PWM_SLICES;

	return (unsigned int)((unsigned long long)duty * PWM_SLICES / limit);
}

/* ------------------------------------------------------------------------ */
/* PWM engine                                                               */
/* ------------------------------------------------------------------------ */

static enum hrtimer_restart fan_timer_cb(struct hrtimer *timer)
{
	unsigned int limit, duty, slice_us, on_slices;

	duty = (unsigned int)READ_ONCE(fan.duty);

	limit = (unsigned int)READ_ONCE(cycle);
	if (limit == 0)
		limit = 1;

	slice_us = (unsigned int)READ_ONCE(period) / PWM_SLICES;
	if (slice_us < 1)
		slice_us = 1;

	on_slices = fan_duty_to_slices(duty, limit);

	if (on_slices == 0)
		gpiod_set_value(fan.desc, 0);
	else if (on_slices >= PWM_SLICES)
		gpiod_set_value(fan.desc, 1);
	else
		gpiod_set_value(fan.desc, fan.tick < on_slices);

	fan.tick++;
	if (fan.tick >= PWM_SLICES)
		fan.tick = 0;

	/*
	 * Forward from the timer's own expiry rather than from ktime_get():
	 * the latter folds every softirq delay into the period and drifts.
	 */
	hrtimer_forward_now(timer, ktime_set(0, (long)slice_us * 1000L));

	return HRTIMER_RESTART;
}

/* Caller must hold fan_lock. */
static void fan_timer_start_locked(void)
{
	unsigned int slice_us;

	if (fan.running)
		return;

	slice_us = (unsigned int)period / PWM_SLICES;
	if (slice_us < 1)
		slice_us = 1;

	fan.tick = 0;
	hrtimer_start(&fan.timer, ktime_set(0, (long)slice_us * 1000L),
		      HRTIMER_MODE_REL);
	fan.running = true;

	pr_info(DRV_NAME ": PWM running: period=%d us, %u slices of %u us\n",
		period, PWM_SLICES, slice_us);
}

/* Caller must hold fan_lock. */
static void fan_timer_stop_locked(void)
{
	if (!fan.running)
		return;

	hrtimer_cancel(&fan.timer);
	gpiod_set_value(fan.desc, 0);
	fan.running = false;

	pr_info(DRV_NAME ": PWM stopped, output LOW\n");
}

/*
 * Caller must hold fan_lock.  Drive a static level and leave the timer off.
 *
 * Both degenerate duty values take this path because a permanent level needs no
 * interrupts.  100% must output HIGH, which is why it cannot simply reuse
 * fan_timer_stop_locked() -- that one always drives LOW.  (Found on hardware:
 * writing duty == cycle used to stop the timer and pull the line low, so the
 * fan ran at 0% instead of 100%.)
 */
static void fan_output_static_locked(int value)
{
	if (fan.running) {
		hrtimer_cancel(&fan.timer);
		fan.running = false;
	}

	gpiod_set_value(fan.desc, value ? 1 : 0);

	pr_info(DRV_NAME ": output static %s\n",
		value ? "HIGH (100%)" : "LOW (0%)");
}

/* ------------------------------------------------------------------------ */
/* /sys/kernel/duty_cycle                                                   */
/* ------------------------------------------------------------------------ */

static ssize_t fan_duty_format(char *buf)
{
	return sysfs_emit(buf, "%u\n", READ_ONCE(fan.duty));
}

static ssize_t fan_duty_parse(const char *buf, size_t count)
{
	unsigned int val, limit;
	int ret;

	ret = kstrtouint(buf, 0, &val);
	if (ret < 0)
		return ret;

	limit = (unsigned int)READ_ONCE(cycle);
	if (limit == 0)
		limit = 1;
	if (val > limit)
		val = limit;

	WRITE_ONCE(fan.duty, val);

	/*
	 * Keep the two degenerate cases free of timer load: a permanent level
	 * needs no further interrupts.  100% must drive HIGH -- do not route it
	 * through fan_timer_stop_locked(), which pulls the line low.
	 */
	mutex_lock(&fan_lock);
	if (!fan.desc) {
		mutex_unlock(&fan_lock);
		return count;
	}

	if (!READ_ONCE(fanen) || val == 0)
		fan_output_static_locked(0);
	else if (val >= limit)
		fan_output_static_locked(1);
	else
		fan_timer_start_locked();
	mutex_unlock(&fan_lock);

	return count;
}

static ssize_t duty_cycle_show(struct kobject *kobj,
			       struct kobj_attribute *attr, char *buf)
{
	return fan_duty_format(buf);
}

static ssize_t duty_cycle_store(struct kobject *kobj,
				struct kobj_attribute *attr,
				const char *buf, size_t count)
{
	return fan_duty_parse(buf, count);
}

static struct kobj_attribute duty_cycle_attr =
	__ATTR(duty_cycle, 0664, duty_cycle_show, duty_cycle_store);

/* ------------------------------------------------------------------------ */
/* GPIO acquisition                                                         */
/* ------------------------------------------------------------------------ */

#if FAN_GPIO_USE_LEGACY

static int fan_gpio_acquire(void)
{
	int ret;

	/*
	 * gpio_request() is the only public way to claim a pin by number
	 * without a device context.  It exists unconditionally on kernels
	 * before 6.17 and on 6.17+ whenever CONFIG_GPIOLIB_LEGACY is enabled --
	 * which is exactly when this branch is compiled in.
	 */
	ret = gpio_request(fangpio, FAN_GPIO_CON_ID);
	if (ret) {
		pr_err(DRV_NAME ": cannot request GPIO %d (%d)\n", fangpio, ret);
		return ret;
	}

	fan.desc = gpio_to_desc(fangpio);
	if (!fan.desc) {
		pr_err(DRV_NAME ": GPIO %d has no descriptor\n", fangpio);
		gpio_free(fangpio);
		return -ENODEV;
	}

	ret = gpiod_direction_output(fan.desc, 0);
	if (ret) {
		pr_err(DRV_NAME ": cannot drive GPIO %d as output (%d)\n",
		       fangpio, ret);
		fan.desc = NULL;
		gpio_free(fangpio);
		return ret;
	}

	pr_info(DRV_NAME ": GPIO %d claimed through the legacy integer interface\n",
		fangpio);
	return 0;
}

static void fan_gpio_release(void)
{
	if (!fan.desc)
		return;

	gpiod_set_value(fan.desc, 0);
	fan.desc = NULL;
	gpio_free(fangpio);
}

#else /* !FAN_GPIO_USE_LEGACY */

/*
 * Resolve the global GPIO number into the (chip label, chip-relative hwnum)
 * pair the lookup table expects.  gpiod_lookup::key is the gpio chip label and
 * gpiod_lookup::chip_hwnum is the 0-based offset inside that chip (gpiolib
 * validates it against gc->ngpio and calls gpio_device_get_desc() with it).
 */
static int fan_gpio_resolve(char **label_out, unsigned int *hwnum_out)
{
	struct gpio_device *gdev;
	struct gpio_desc *probe;
	const char *label;
	int base, ret = 0;

	probe = gpio_to_desc(fangpio);
	if (!probe) {
		pr_err(DRV_NAME ": GPIO %d does not exist\n", fangpio);
		return -ENODEV;
	}

	/*
	 * gpiod_to_gpio_device() returns a borrowed reference; take a real one
	 * so the chip cannot vanish while we read its label.
	 */
	gdev = gpiod_to_gpio_device(probe);
	if (!gdev)
		return -ENODEV;

	gdev = gpio_device_get(gdev);

	label = gpio_device_get_label(gdev);
	base = gpio_device_get_base(gdev);

	if (!label || base < 0 || (unsigned int)fangpio < (unsigned int)base) {
		pr_err(DRV_NAME ": cannot resolve GPIO %d (chip base %d)\n",
		       fangpio, base);
		ret = -EINVAL;
	} else {
		*hwnum_out = (unsigned int)fangpio - (unsigned int)base;
		*label_out = kstrdup(label, GFP_KERNEL);
		if (!*label_out)
			ret = -ENOMEM;
	}

	gpio_device_put(gdev);
	return ret;
}

static int fan_gpio_acquire(void)
{
	struct platform_device_info pinfo = {
		.name	= DRV_NAME,
		.id	= PLATFORM_DEVID_NONE,
	};
	struct gpiod_lookup_table *lut;
	char *chip_label = NULL;
	unsigned int hwnum = 0;
	int ret;

	ret = fan_gpio_resolve(&chip_label, &hwnum);
	if (ret)
		return ret;

	/*
	 * U16_MAX is gpiolib's sentinel meaning "key is a GPIO line name", so a
	 * real hardware offset must stay below it.
	 */
	if (hwnum >= 0xFFFFU) {
		pr_err(DRV_NAME ": GPIO %d maps to hwnum %u, out of range\n",
		       fangpio, hwnum);
		kfree(chip_label);
		return -EINVAL;
	}

	/* One entry plus the zeroed terminator gpiolib iterates over. */
	lut = kzalloc(struct_size(lut, table, 2), GFP_KERNEL);
	if (!lut) {
		ret = -ENOMEM;
		goto out_label;
	}

	lut->table[0].key	= chip_label;
	lut->table[0].chip_hwnum = (u16)hwnum;
	lut->table[0].con_id	= FAN_GPIO_CON_ID;
	lut->table[0].idx	= 0;
	lut->table[0].flags	= GPIO_ACTIVE_HIGH;

	/* dev_id must match dev_name() of the platform device below. */
	lut->dev_id = kstrdup(DRV_NAME, GFP_KERNEL);
	if (!lut->dev_id) {
		ret = -ENOMEM;
		goto out_lut;
	}

	fan.lookup = lut;
	gpiod_add_lookup_table(lut);

	fan.pdev = platform_device_register_full(&pinfo);
	if (IS_ERR(fan.pdev)) {
		ret = PTR_ERR(fan.pdev);
		fan.pdev = NULL;
		pr_err(DRV_NAME ": cannot register platform device (%d)\n", ret);
		goto out_added;
	}

	fan.desc = gpiod_get_index(&fan.pdev->dev, FAN_GPIO_CON_ID, 0,
				   GPIOD_OUT_LOW);
	if (IS_ERR(fan.desc)) {
		ret = PTR_ERR(fan.desc);
		fan.desc = NULL;
		pr_err(DRV_NAME ": cannot claim GPIO %d on chip %s hwnum %u (%d)\n",
		       fangpio, chip_label, hwnum, ret);
		goto out_pdev;
	}

	pr_info(DRV_NAME ": GPIO %d claimed by descriptor lookup on chip %s hwnum %u\n",
		fangpio, chip_label, hwnum);
	return 0;

out_pdev:
	platform_device_unregister(fan.pdev);
	fan.pdev = NULL;
out_added:
	gpiod_remove_lookup_table(lut);
	fan.lookup = NULL;
	kfree(lut->dev_id);
out_lut:
	kfree(lut);
out_label:
	kfree(chip_label);
	return ret;
}

static void fan_gpio_release(void)
{
	if (fan.desc) {
		gpiod_set_value(fan.desc, 0);
		gpiod_put(fan.desc);
		fan.desc = NULL;
	}

	if (fan.pdev) {
		platform_device_unregister(fan.pdev);
		fan.pdev = NULL;
	}

	if (fan.lookup) {
		gpiod_remove_lookup_table(fan.lookup);
		kfree(fan.lookup->dev_id);
		kfree(fan.lookup->table[0].key);
		kfree(fan.lookup);
		fan.lookup = NULL;
	}
}

#endif /* FAN_GPIO_USE_LEGACY */

/* ------------------------------------------------------------------------ */
/* fanen parameter setter                                                   */
/* ------------------------------------------------------------------------ */

static int fanen_set(const char *val, const struct kernel_param *kp)
{
	int enable;
	int ret;

	ret = kstrtoint(val, 0, &enable);
	if (ret)
		return ret;

	enable = enable ? 1 : 0;

	mutex_lock(&fan_lock);
	*(int *)kp->arg = enable;

	/*
	 * During module parameter parsing the GPIO has not been acquired yet,
	 * so there is nothing to drive -- init reads the value afterwards.
	 */
	if (fan.desc) {
		if (enable)
			fan_timer_start_locked();
		else
			fan_timer_stop_locked();
	}
	mutex_unlock(&fan_lock);

	return 0;
}

/* ------------------------------------------------------------------------ */
/* Module init / exit                                                       */
/* ------------------------------------------------------------------------ */

static int __init airpi_gpio_fan_init(void)
{
	unsigned int slices;
	int ret;

	pr_info(DRV_NAME ": loading v%s (legacy GPIO path: %s)\n",
		DRV_VERSION, FAN_GPIO_USE_LEGACY ? "yes" : "no");

	if (cycle < 1 || cycle > 255) {
		pr_warn(DRV_NAME ": cycle=%d out of range, using 255\n", cycle);
		cycle = 255;
	}

	if (period < PWM_SLICES || period > 1000000) {
		pr_warn(DRV_NAME ": period=%d out of range, using 15000\n",
			period);
		period = 15000;
	}

	if (fangpio < 0) {
		pr_err(DRV_NAME ": fangpio=%d is not a valid GPIO number\n",
		       fangpio);
		return -EINVAL;
	}

	ret = fan_gpio_acquire();
	if (ret)
		return ret;

	fan.tick = 0;
	fan.running = false;
	fan_hrtimer_setup(&fan.timer, fan_timer_cb);

	ret = sysfs_create_file(kernel_kobj, &duty_cycle_attr.attr);
	if (ret) {
		pr_err(DRV_NAME ": cannot create /sys/kernel/duty_cycle (%d)\n",
		       ret);
		goto err_gpio;
	}

	slices = (unsigned int)period / PWM_SLICES;

	mutex_lock(&fan_lock);
	if (READ_ONCE(fanen))
		fan_timer_start_locked();
	else
		gpiod_set_value(fan.desc, 0);
	mutex_unlock(&fan_lock);

	pr_info(DRV_NAME ": loaded: gpio=%d cycle=%d period=%d us (%u slices of %u us) fanen=%d\n",
		fangpio, cycle, period, PWM_SLICES, slices, READ_ONCE(fanen));

	return 0;

err_gpio:
	fan_gpio_release();
	return ret;
}

static void __exit airpi_gpio_fan_exit(void)
{
	mutex_lock(&fan_lock);
	fan_timer_stop_locked();
	mutex_unlock(&fan_lock);

	sysfs_remove_file(kernel_kobj, &duty_cycle_attr.attr);

	fan_gpio_release();

	pr_info(DRV_NAME ": unloaded\n");
}

module_init(airpi_gpio_fan_init);
module_exit(airpi_gpio_fan_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("AirPi Community");
MODULE_DESCRIPTION("AirPi GPIO soft-PWM fan driver");
MODULE_VERSION(DRV_VERSION);
