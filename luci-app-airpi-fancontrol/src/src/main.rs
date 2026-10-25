// airpi-fanctl — AirPi AP3000M fan control helper (LuCI backend)
//
// Responsibilities are deliberately separated:
//   sampling  -> policy      -> actuation -> reporting
//   (sysfs)      (UCI curve)    (sysfs)      (/tmp state file)
//
// The daemon is the single periodic writer of the fan interface.  Manual and
// stepless requests do not stop it: it keeps sampling, keeps reporting and
// keeps the thermal guard armed, it only refrains from overriding the level
// the user asked for.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DUTY_PATH: &str = "/sys/kernel/duty_cycle";
const SPEED_FILE: &str = "/usr/bin/fanspeed.conf";
const FANVAL_FILE: &str = "/etc/fanvall";
const PID_FILE: &str = "/var/run/airpi-fancontrol.pid";
const STATE_FILE: &str = "/tmp/airpi-fan.state";
const LOG_FILE: &str = "/tmp/airpi-fancontrol.log";
const EMMC_FILE: &str = "/sys/block/mmcblk0/size";
const EMMC_THRESHOLD: u64 = 25_000_000;
const MODULE_NAME: &str = "airpi_gpio_fan";

/// Levels accepted by log() — 1 error, 2 info, 3 debug.
const LOG_ERROR: u8 = 1;
const LOG_INFO: u8 = 2;
const LOG_DEBUG: u8 = 3;

type Result<T> = std::result::Result<T, String>;

// ---------------------------------------------------------------------------
// Small primitives
// ---------------------------------------------------------------------------

fn read_trim(path: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn read_number(path: impl AsRef<Path>) -> Option<i64> {
    read_trim(path)?.parse().ok()
}

fn write_value(path: impl AsRef<Path>, value: impl ToString) -> Result<()> {
    fs::write(path.as_ref(), value.to_string())
        .map_err(|e| format!("{}: {}", path.as_ref().display(), e))
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    Command::new(program)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
}

fn run_status(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn parse_range(value: &str, min: u32, max: u32, name: &str) -> Result<u32> {
    let n = value
        .parse::<u32>()
        .map_err(|_| format!("invalid {}", name))?;
    (min..=max)
        .contains(&n)
        .then_some(n)
        .ok_or_else(|| format!("{} out of range", name))
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/// Writes to /dev/log when available and always keeps a tmpfs copy so the
/// LuCI log panel works regardless of which system logger is configured.
fn log(level: u8, threshold: u8, msg: &str) {
    if level > threshold || threshold == 0 {
        return;
    }
    let tag = match level {
        1 => "error",
        2 => "info",
        _ => "debug",
    };
    let line = format!("{} [{}] {}\n", now_secs(), tag, msg);
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(LOG_FILE)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(line.as_bytes())
        });
    send_syslog(msg);
}

#[cfg(unix)]
fn send_syslog(msg: &str) {
    use std::os::unix::net::UnixDatagram;
    // Busybox syslogd supplies its own timestamp for messages received on
    // /dev/log, so only the tag and the text are handed over.
    if let Ok(socket) = UnixDatagram::unbound() {
        if socket.connect("/dev/log").is_ok() {
            let _ = socket.send(format!("<14>airpi-fancontrol: {msg}").as_bytes());
        }
    }
}

#[cfg(not(unix))]
fn send_syslog(_msg: &str) {}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Driver {
    Pwm,
    SoftPwm,
}

/// Sensor sources in display order.  Index into Config::enabled.
const SOURCES: [&str; 4] = ["cpu", "phy", "wifi", "modem"];

#[derive(Clone, Debug, PartialEq)]
struct Config {
    fan_driver: String,
    fan_gpio: u32,
    fan_freq: u32,
    /// Control loop period in seconds.
    interval: u64,
    /// Slow sources (iwpriv / ubus) are resampled at this period.
    slow_interval: u64,
    /// Ascending temperature breakpoints, milli-degrees.
    temp_low: i64,
    temp_mid: i64,
    temp_high: i64,
    /// Duty for band 0..3.
    duties: [u32; 4],
    /// Downshift allowance band in milli-degrees.
    hysteresis: i64,
    /// Minimum seconds between two downshifts.
    min_hold: u64,
    /// Temperature that overrides every non-auto mode with full duty.
    temp_crit: i64,
    crit_guard: bool,
    /// Duty used when no sensor delivers a plausible reading.
    fail_duty: u32,
    /// Consecutive failed loops before the fail-safe kicks in.
    fail_count: u64,
    /// Duty left in the fan interface when the service stops.
    stop_duty: u32,
    enabled: [bool; 4],
    log_level: u8,
    /// Invalid or unusable option values, surfaced to the UI instead of being
    /// silently replaced by defaults.
    errors: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            fan_driver: "auto".into(),
            fan_gpio: 540,
            fan_freq: 15_000,
            interval: 8,
            slow_interval: 30,
            temp_low: 50_000,
            temp_mid: 60_000,
            temp_high: 85_000,
            duties: [64, 128, 192, 255],
            hysteresis: 2_000,
            min_hold: 30,
            temp_crit: 95_000,
            crit_guard: true,
            fail_duty: 255,
            fail_count: 3,
            stop_duty: 64,
            enabled: [true; 4],
            log_level: 2,
            errors: Vec::new(),
        }
    }
}

/// Parses `uci show` output into `key -> value` for one section.
fn parse_uci_show(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let (path, raw) = match line.split_once('=') {
            Some(pair) => pair,
            None => continue,
        };
        // Only "pkg.section.key" option lines are interesting; the two-segment
        // "pkg.section" lines declare the section type.
        let mut parts = path.split('.');
        let _package = parts.next();
        let _section = parts.next();
        let key = match parts.next() {
            Some(key) if parts.next().is_none() => key,
            _ => continue,
        };
        let value = raw.trim().trim_matches('\'').trim();
        out.insert(key.to_string(), value.to_string());
    }
    out
}

fn uci_options() -> HashMap<String, String> {
    command_output("uci", &["-q", "show", "airpi-fan"])
        .map(|text| parse_uci_show(&text))
        .unwrap_or_default()
}

/// Integer option inside a closed range; a stored value outside it is kept out
/// of the running configuration and reported instead of being clamped away.
fn read_bounded(
    kv: &HashMap<String, String>,
    key: &str,
    current: i64,
    min: i64,
    max: i64,
    errors: &mut Vec<String>,
) -> i64 {
    let raw = match kv.get(key) {
        Some(value) => value.clone(),
        None => return current,
    };
    match raw.parse::<i64>() {
        Ok(value) if (min..=max).contains(&value) => value,
        Ok(value) => {
            errors.push(format!(
                "{key}={value} 需在 {min}..={max} 之间，已沿用 {current}"
            ));
            current
        }
        Err(_) => {
            errors.push(format!("{key}={raw} 不是合法整数，已沿用 {current}"));
            current
        }
    }
}

fn read_celsius(
    kv: &HashMap<String, String>,
    key: &str,
    current: i64,
    errors: &mut Vec<String>,
) -> i64 {
    let raw = match kv.get(key) {
        Some(value) => value.clone(),
        None => return current,
    };
    // Integer degrees are stored in UCI; a missing or broken value keeps the
    // previous one and is reported.
    match raw.parse::<f64>() {
        Ok(value) if (20.0..=120.0).contains(&value) => (value * 1000.0).round() as i64,
        Ok(value) => {
            errors.push(format!("{key}={value} 温度需在 20..=120 ℃ 之间"));
            current
        }
        Err(_) => {
            errors.push(format!("{key}={raw} 不是合法温度值"));
            current
        }
    }
}

fn read_duty(
    kv: &HashMap<String, String>,
    key: &str,
    current: u32,
    errors: &mut Vec<String>,
) -> u32 {
    read_bounded(kv, key, current as i64, 0, 255, errors) as u32
}

fn read_bool(kv: &HashMap<String, String>, key: &str, current: bool) -> bool {
    match kv.get(key).map(|v| v.as_str()) {
        Some("1") | Some("yes") | Some("true") => true,
        Some("0") | Some("no") | Some("false") => false,
        _ => current,
    }
}

impl Config {
    fn load() -> Config {
        Self::from_kv(&uci_options())
    }

    fn from_kv(kv: &HashMap<String, String>) -> Config {
        let mut cfg = Config::default();
        let mut errors = Vec::new();

        if let Some(driver) = kv.get("fan_driver") {
            match driver.as_str() {
                "auto" | "pwm" | "softpwm" => cfg.fan_driver = driver.clone(),
                other => errors.push(format!("fan_driver={other} 无效，已按 auto 处理")),
            }
        }

        cfg.interval = read_bounded(
            kv,
            "auto_interval",
            cfg.interval as i64,
            2,
            300,
            &mut errors,
        ) as u64;
        cfg.slow_interval = read_bounded(
            kv,
            "slow_interval",
            cfg.slow_interval as i64,
            5,
            600,
            &mut errors,
        ) as u64;
        cfg.min_hold =
            read_bounded(kv, "min_hold", cfg.min_hold as i64, 0, 600, &mut errors) as u64;
        cfg.fail_count =
            read_bounded(kv, "fail_count", cfg.fail_count as i64, 1, 10, &mut errors) as u64;
        cfg.log_level =
            read_bounded(kv, "log_level", cfg.log_level as i64, 0, 3, &mut errors) as u8;
        cfg.fan_gpio =
            read_bounded(kv, "fan_gpio", cfg.fan_gpio as i64, 0, 1023, &mut errors) as u32;
        // The driver splits `period` into 256 slices and floors each slice at
        // 1 µs, so a period below 256 µs means ~1M hrtimer wakeups per second.
        // Loading enforced that floor; a hot parameter write must not bypass it.
        cfg.fan_freq = read_bounded(
            kv,
            "fan_freq",
            cfg.fan_freq as i64,
            256,
            1_000_000,
            &mut errors,
        ) as u32;

        cfg.temp_low = read_celsius(kv, "temp_low", cfg.temp_low, &mut errors);
        cfg.temp_mid = read_celsius(kv, "temp_mid", cfg.temp_mid, &mut errors);
        cfg.temp_high = read_celsius(kv, "temp_high", cfg.temp_high, &mut errors);
        cfg.temp_crit = read_celsius(kv, "temp_crit", cfg.temp_crit, &mut errors);

        cfg.duties[0] = read_duty(kv, "duty_idle", cfg.duties[0], &mut errors);
        cfg.duties[1] = read_duty(kv, "duty_low", cfg.duties[1], &mut errors);
        cfg.duties[2] = read_duty(kv, "duty_mid", cfg.duties[2], &mut errors);
        cfg.duties[3] = read_duty(kv, "duty_high", cfg.duties[3], &mut errors);
        cfg.fail_duty = read_duty(kv, "fail_duty", cfg.fail_duty, &mut errors);
        cfg.stop_duty = read_duty(kv, "stop_duty", cfg.stop_duty, &mut errors);

        cfg.hysteresis = match kv.get("hysteresis") {
            None => cfg.hysteresis,
            Some(raw) => match raw.parse::<f64>() {
                Ok(value) if (0.0..=15.0).contains(&value) => (value * 1000.0).round() as i64,
                Ok(value) => {
                    errors.push(format!("hysteresis={value} 需在 0..=15 ℃ 之间"));
                    cfg.hysteresis
                }
                Err(_) => {
                    errors.push(format!("hysteresis={raw} 不是合法数值"));
                    cfg.hysteresis
                }
            },
        };

        cfg.crit_guard = read_bool(kv, "crit_guard", cfg.crit_guard);
        for (index, name) in SOURCES.iter().enumerate() {
            cfg.enabled[index] = read_bool(kv, &format!("src_{name}"), cfg.enabled[index]);
        }

        // Ordering is what makes the curve monotonic; a reversed pair would
        // silently pin the fan at one band.
        if !(cfg.temp_low < cfg.temp_mid && cfg.temp_mid < cfg.temp_high) {
            errors.push(format!(
                "温度阈值需严格递增: low={} mid={} high={} ℃，温控曲线回退到默认阶梯",
                cfg.temp_low / 1000,
                cfg.temp_mid / 1000,
                cfg.temp_high / 1000
            ));
            cfg.temp_low = Config::default().temp_low;
            cfg.temp_mid = Config::default().temp_mid;
            cfg.temp_high = Config::default().temp_high;
        }
        if !(cfg.duties[0] <= cfg.duties[1]
            && cfg.duties[1] <= cfg.duties[2]
            && cfg.duties[2] <= cfg.duties[3])
        {
            errors.push(format!(
                "占空比需随温度单调不降: {:?}，已按升序重排",
                cfg.duties
            ));
            cfg.duties.sort_unstable();
        }
        if cfg.temp_crit <= cfg.temp_high {
            errors.push(format!(
                "临界温度 {} ℃ 需高于高温阈值 {} ℃，已抬升",
                cfg.temp_crit / 1000,
                cfg.temp_high / 1000
            ));
            cfg.temp_crit = cfg.temp_high + 5_000;
        }

        cfg.errors = errors;
        cfg
    }

    /// `85:255 60:192 50:128 *:64` — the live curve, for display.
    fn policy_text(&self) -> String {
        format!(
            "{}:{} {}:{} {}:{} {}:{}",
            self.temp_high / 1000,
            self.duties[3],
            self.temp_mid / 1000,
            self.duties[2],
            self.temp_low / 1000,
            self.duties[1],
            "*",
            self.duties[0]
        )
    }
}

// ---------------------------------------------------------------------------
// Hardware interfaces
// ---------------------------------------------------------------------------

fn emmc_sectors() -> Option<u64> {
    read_trim(EMMC_FILE)?.parse().ok().filter(|n: &u64| *n > 0)
}

fn module_loaded() -> bool {
    read_trim("/proc/modules")
        .map(|s| {
            s.lines()
                .any(|l| l.split_whitespace().next() == Some(MODULE_NAME))
        })
        .unwrap_or(false)
}

fn pwm_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir("/sys/class/hwmon") {
        for entry in entries.flatten() {
            let dir = entry.path();
            let name = read_trim(dir.join("name")).unwrap_or_default();
            if matches!(name.as_str(), "pwmfan" | "pwm-fan") {
                let path = dir.join("pwm1");
                if path.exists() {
                    paths.push(path);
                }
            }
        }
    }
    // AP3000M hardware PWM may be exported directly by the MT7981 PWM
    // controller. This device-specific interface uses the same 0..255
    // fan value expected by the existing LuCI controls.
    if let Ok(chips) = fs::read_dir("/sys/class/pwm") {
        for chip in chips.flatten() {
            if let Ok(pwms) = fs::read_dir(chip.path()) {
                for pwm in pwms.flatten() {
                    let path = pwm.path().join("duty_cycle");
                    if path.exists() {
                        paths.push(path);
                    }
                }
            }
        }
    }
    paths
}

fn pwm_path() -> Option<PathBuf> {
    pwm_paths()
        .into_iter()
        .find(|p| fs::OpenOptions::new().write(true).open(p).is_ok())
}

fn resolve_driver(fan_driver: &str) -> Driver {
    match fan_driver {
        "pwm" => Driver::Pwm,
        "softpwm" => Driver::SoftPwm,
        _ => match emmc_sectors() {
            Some(n) if n > EMMC_THRESHOLD => Driver::SoftPwm,
            Some(_) => Driver::Pwm,
            None if pwm_path().is_some() => Driver::Pwm,
            None => Driver::SoftPwm,
        },
    }
}

fn duty_target_path(cfg: &Config) -> Result<PathBuf> {
    match resolve_driver(&cfg.fan_driver) {
        Driver::Pwm => pwm_path().ok_or_else(|| "hardware PWM path not found".to_string()),
        Driver::SoftPwm => Ok(PathBuf::from(DUTY_PATH)),
    }
}

fn module_param(name: &str) -> Option<String> {
    read_trim(format!("/sys/module/{MODULE_NAME}/parameters/{name}"))
}

fn set_module_param(name: &str, value: &str) -> Result<()> {
    write_value(
        format!("/sys/module/{MODULE_NAME}/parameters/{name}"),
        value,
    )
}

/// Bring the kernel side in line with the configuration.  A live soft-PWM
/// module already holding the right pin only needs its period nudged: the
/// timer callback reads `period` every slice, so no unload — and therefore no
/// cooling gap — is involved.
fn ensure_driver(cfg: &Config) -> Result<()> {
    match resolve_driver(&cfg.fan_driver) {
        Driver::Pwm => {
            if module_loaded() {
                log(
                    LOG_INFO,
                    cfg.log_level,
                    "hardware PWM selected, unloading airpi_gpio_fan",
                );
                run_status("rmmod", &[MODULE_NAME]);
            }
            Ok(())
        }
        Driver::SoftPwm if module_loaded() => {
            let wanted = cfg.fan_freq.to_string();
            if module_param("fangpio").as_deref() != Some(cfg.fan_gpio.to_string().as_str()) {
                log(
                    LOG_INFO,
                    cfg.log_level,
                    &format!(
                        "GPIO changed, reloading soft-PWM module on pin {}",
                        cfg.fan_gpio
                    ),
                );
                run_status("rmmod", &[MODULE_NAME]);
            } else if module_param("period").as_deref() != Some(wanted.as_str()) {
                return match set_module_param("period", &wanted) {
                    Ok(()) => {
                        log(
                            LOG_INFO,
                            cfg.log_level,
                            &format!("PWM period set to {wanted} us"),
                        );
                        Ok(())
                    }
                    Err(error) => Err(format!("failed to set PWM period: {error}")),
                };
            }
            if module_loaded() {
                return Ok(());
            }
            load_softpwm(cfg)
        }
        Driver::SoftPwm => load_softpwm(cfg),
    }
}

fn load_softpwm(cfg: &Config) -> Result<()> {
    let gpio = cfg.fan_gpio.to_string();
    let freq = cfg.fan_freq.to_string();
    let params = [
        format!("fangpio={gpio}"),
        "cycle=255".to_string(),
        format!("period={freq}"),
        "fanen=1".to_string(),
    ];
    let loaded = run_status(
        "insmod",
        &[
            "airpi-gpio-fan",
            &params[0],
            &params[1],
            &params[2],
            &params[3],
        ],
    ) || run_status(
        "modprobe",
        &[MODULE_NAME, &params[0], &params[1], &params[2], &params[3]],
    );
    if !loaded {
        return Err("failed to load airpi-gpio-fan".into());
    }
    // Module exit drives the pin low, so start spinning the fan again right
    // away instead of waiting for the next control loop.
    let _ = write_value(DUTY_PATH, cfg.stop_duty);
    log(
        LOG_INFO,
        cfg.log_level,
        &format!("soft-PWM driver loaded (gpio={gpio} period={freq})"),
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Temperature sampling
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Sensor {
    name: &'static str,
    mc: i64,
}

fn valid_mc(value: i64) -> bool {
    (1_000..=150_000).contains(&value)
}

/// Hottest plausible reading among `values`, ignoring out-of-range noise such
/// as the negative cpu-thermal samples some AP3000M kernels report.
fn valid_max(values: impl IntoIterator<Item = i64>) -> Option<i64> {
    values.into_iter().filter(|v| valid_mc(*v)).max()
}

fn read_cpu_mc() -> Option<i64> {
    let mut values = Vec::new();
    if let Ok(entries) = fs::read_dir("/sys/class/thermal") {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with("thermal_zone")
            {
                continue;
            }
            if let Some(v) = read_number(dir.join("temp")) {
                values.push(v);
            }
        }
    }
    valid_max(values)
}

/// Hottest `temp1_input` across every non-fan hwmon chip.  On the AP3000M this
/// bucket holds both the switch PHY (`mdio_bus:*`, ~40 °C) and the Wi-Fi radios
/// (`mt7915_phy*`, 60 °C+); stopping at the first match would under-report the
/// control temperature and let the fan lag behind the real hotspot.
fn read_phy_mc() -> Option<i64> {
    let mut values = Vec::new();
    if let Ok(entries) = fs::read_dir("/sys/class/hwmon") {
        for entry in entries.flatten() {
            let dir = entry.path();
            let name = read_trim(dir.join("name")).unwrap_or_default();
            if matches!(name.as_str(), "pwmfan" | "pwm-fan" | "fan") {
                continue;
            }
            if let Some(v) = read_number(dir.join("temp1_input")) {
                values.push(v);
            }
        }
    }
    valid_max(values)
}

fn read_wifi_mc() -> Option<i64> {
    for dev in ["ra0", "rax0", "rai0"] {
        if !Path::new(&format!("/sys/class/net/{dev}")).exists() {
            continue;
        }
        let text = command_output("iwpriv", &[dev, "stat"])?;
        return text
            .lines()
            .find(|l| l.to_ascii_lowercase().contains("currenttemperature"))
            .and_then(|l| {
                l.split(|c: char| !c.is_ascii_digit())
                    .find(|s| !s.is_empty())
            })
            .and_then(|s| s.parse::<i64>().ok())
            .map(|n| n * 1000)
            .filter(|v| valid_mc(*v));
    }
    None
}

fn read_modem_mc() -> Option<i64> {
    command_output("ubus", &["call", "modem_ctrl", "info"])
        .and_then(|text| parse_modem_temperature(&text))
}

fn parse_modem_temperature(text: &str) -> Option<i64> {
    let lower = text.to_ascii_lowercase();
    let start = lower.find("temperature")? + "temperature".len();
    let section = &text[start..];
    let value_start = section
        .to_ascii_lowercase()
        .find("value")
        .map_or(0, |index| index + "value".len());
    let value = section[value_start..]
        .split(|c: char| !c.is_ascii_digit() && c != '-')
        .find(|part| !part.is_empty() && *part != "-")?
        .parse::<i64>()
        .ok()?;
    let mc = if value >= 1_000 { value } else { value * 1_000 };
    valid_mc(mc).then_some(mc)
}

fn add_sensor(sensors: &mut Vec<Sensor>, name: &'static str, mc: i64) {
    if let Some(sensor) = sensors.iter_mut().find(|sensor| sensor.name == name) {
        sensor.mc = sensor.mc.max(mc);
    } else {
        sensors.push(Sensor { name, mc });
    }
}

/// Aggregated reading used by the legacy temperature commands: every source,
/// one entry per source, hottest wins.
fn thermal_sensors() -> Vec<Sensor> {
    let mut out = Vec::new();
    for (name, mc) in [
        ("cpu", read_cpu_mc()),
        ("phy", read_phy_mc()),
        ("wifi", read_wifi_mc()),
        ("modem", read_modem_mc()),
    ] {
        if let Some(mc) = mc {
            add_sensor(&mut out, name, mc);
        }
    }
    out
}

/// One source as seen by the daemon, including how old the value is so the UI
/// can tell a live reading from a cached one.  `age` is seconds since the
/// sample was taken, or -1 when the source produced no value at all.
#[derive(Clone, Debug)]
struct Sample {
    name: &'static str,
    mc: i64,
    age: i64,
    error: Option<String>,
}

#[derive(Default)]
struct Sampler {
    /// source index -> (value, timestamp, error)
    cache: HashMap<usize, (i64, u64, Option<String>)>,
}

impl Sampler {
    fn read(&mut self, index: usize, slow: bool, now: u64, slow_interval: u64) -> Sample {
        let cached = self
            .cache
            .get(&index)
            .map(|(mc, ts, err)| (*mc, *ts, err.clone()));
        let fresh = slow
            && match cached {
                Some((_, ts, _)) => now.saturating_sub(ts) < slow_interval,
                None => false,
            };
        if fresh {
            let (mc, ts, err) = cached.expect("checked above");
            return Sample {
                name: SOURCES[index],
                mc,
                age: (now - ts) as i64,
                error: err,
            };
        }
        let (mc, error) = match index {
            0 => match read_cpu_mc() {
                Some(mc) => (mc, None),
                None => (-1, Some("thermal zone 无有效读数".into())),
            },
            1 => match read_phy_mc() {
                Some(mc) => (mc, None),
                None => (-1, Some("hwmon temp1_input 不可用".into())),
            },
            2 => match read_wifi_mc() {
                Some(mc) => (mc, None),
                None => (-1, Some("iwpriv 温度接口不可用".into())),
            },
            _ => match read_modem_mc() {
                Some(mc) => (mc, None),
                None => (-1, Some("modem_ctrl 无温度字段".into())),
            },
        };
        let sample = Sample {
            name: SOURCES[index],
            mc,
            age: 0,
            error,
        };
        self.cache
            .insert(index, (sample.mc, now, sample.error.clone()));
        sample
    }

    fn disabled(index: usize, error: &str) -> Sample {
        Sample {
            name: SOURCES[index],
            mc: -1,
            age: -1,
            error: Some(error.to_string()),
        }
    }

    fn collect(&mut self, cfg: &Config, now: u64) -> Vec<Sample> {
        let mut out = Vec::new();
        for (index, name) in SOURCES.iter().enumerate() {
            if !cfg.enabled[index] {
                out.push(Self::disabled(index, "已在设置中停用"));
                continue;
            }
            let slow = matches!(*name, "wifi" | "modem");
            out.push(self.read(index, slow, now, cfg.slow_interval));
        }
        out
    }

    /// Hottest plausible reading across enabled sources.
    fn hottest(samples: &[Sample]) -> Option<(i64, &'static str)> {
        samples
            .iter()
            .filter(|s| valid_mc(s.mc))
            .max_by_key(|s| s.mc)
            .map(|s| (s.mc, s.name))
    }
}

// ---------------------------------------------------------------------------
// Control policy
// ---------------------------------------------------------------------------

/// Manual levels kept for compatibility with the historic fanvall values.
const STEP_DUTIES: [u32; 4] = [64, 128, 192, 255];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    /// Automatic temperature curve (fanvall 9, or anything unrecognised).
    Auto,
    /// One of the four fixed levels (fanvall 0..3).
    Step(usize),
    /// Free-form level the user picked (fanvall 999).
    Stepless,
}

fn decode_mode(raw: i64) -> Mode {
    match raw {
        0..=3 => Mode::Step(raw as usize),
        999 => Mode::Stepless,
        _ => Mode::Auto,
    }
}

fn encode_mode(mode: Mode) -> i64 {
    match mode {
        Mode::Auto => 9,
        Mode::Step(index) => index as i64,
        Mode::Stepless => 999,
    }
}

fn read_mode() -> Mode {
    match read_trim(FANVAL_FILE).and_then(|s| s.parse::<i64>().ok()) {
        Some(raw) => decode_mode(raw),
        None => Mode::Auto,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Alarm {
    None,
    Sensor,
    Thermal,
    Config,
    Interface,
}

impl Alarm {
    fn key(self) -> &'static str {
        match self {
            Alarm::None => "none",
            Alarm::Sensor => "sensor",
            Alarm::Thermal => "thermal",
            Alarm::Config => "config",
            Alarm::Interface => "interface",
        }
    }
}

#[derive(Debug)]
struct Decision {
    duty: u32,
    band: usize,
    alarm: Alarm,
    reason: String,
    /// True when the loop wrote the fan interface this round.
    changed: bool,
    /// True when the thermal guard overrode a user-chosen level.
    guarded: bool,
}

/// Temperature band for the curve, with hysteresis on the way down.
fn band_index(temp_mc: i64, previous: usize, cfg: &Config) -> usize {
    let floors = [0, cfg.temp_low, cfg.temp_mid, cfg.temp_high];
    let mut band = previous.min(3);
    while band < 3 && temp_mc >= floors[band + 1] {
        band += 1;
    }
    while band > 0 && temp_mc <= floors[band] - cfg.hysteresis {
        band -= 1;
    }
    band
}

/// Fresh band for the first sample of a loop, i.e. without hysteresis.
fn band_initial(temp_mc: i64, cfg: &Config) -> usize {
    let floors = [0, cfg.temp_low, cfg.temp_mid, cfg.temp_high];
    let mut band = 0;
    while band < 3 && temp_mc >= floors[band + 1] {
        band += 1;
    }
    band
}

#[derive(Default)]
struct LoopState {
    band: usize,
    applied: Option<u32>,
    last_change: u64,
    misses: u64,
    guarded: bool,
    initialised: bool,
}

/// Pure policy step.  `requested` is the duty a manual/stepless user asked
/// for; `None` means the loop has to adopt whatever the interface already
/// holds.
fn decide(
    cfg: &Config,
    mode: Mode,
    temp: Option<(i64, &'static str)>,
    requested: Option<u32>,
    state: &mut LoopState,
    now: u64,
) -> Decision {
    let mut alarm = Alarm::None;
    let mut reason = String::new();

    // 1. No plausible reading at all: fail safe, never fail silent.
    let temp = match temp {
        Some(pair) => {
            state.misses = 0;
            pair
        }
        None => {
            state.misses += 1;
            alarm = Alarm::Sensor;
            if state.misses < cfg.fail_count {
                // 短暂抖动: 维持已知档位。只在档位真的变化时才写接口，
                // 否则每个控制周期都会重写一次并刷一行日志。
                let duty = state.applied.or(requested).unwrap_or(cfg.fail_duty);
                let changed = state.applied != Some(duty);
                if changed {
                    state.applied = Some(duty);
                    state.last_change = now;
                }
                reason.push_str("温度采样失败，暂维持上一次占空比");
                return Decision {
                    duty,
                    band: state.band,
                    alarm,
                    reason,
                    changed,
                    guarded: state.guarded,
                };
            }
            let changed = state.applied != Some(cfg.fail_duty);
            if changed {
                state.applied = Some(cfg.fail_duty);
                state.last_change = now;
            }
            reason.push_str(&format!(
                "连续 {} 次无有效温度，已启用失效安全占空比 {}",
                state.misses, cfg.fail_duty
            ));
            return Decision {
                duty: cfg.fail_duty,
                band: state.band,
                alarm,
                reason,
                changed,
                guarded: false,
            };
        }
    };

    if !state.initialised {
        state.band = band_initial(temp.0, cfg);
        state.initialised = true;
    }

    let floors = [0, cfg.temp_low, cfg.temp_mid, cfg.temp_high];
    debug_assert_eq!(floors.len(), cfg.duties.len());

    let (target, guarded) = match mode {
        Mode::Auto => {
            let band = band_index(temp.0, state.band, cfg);
            state.band = band;
            (cfg.duties[band], false)
        }
        Mode::Step(index) => {
            let base = STEP_DUTIES[index.min(3)];
            if cfg.crit_guard && temp.0 >= cfg.temp_crit {
                (255, true)
            } else {
                (base, false)
            }
        }
        Mode::Stepless => {
            let base = requested.or(state.applied).unwrap_or(cfg.duties[0]);
            if cfg.crit_guard && temp.0 >= cfg.temp_crit {
                (255, true)
            } else {
                (base, false)
            }
        }
    };

    if guarded {
        alarm = Alarm::Thermal;
        reason.push_str(&format!(
            "{} ℃ 已超过临界温度 {} ℃，温控守护已接管至满速",
            temp.0 / 1000,
            cfg.temp_crit / 1000
        ));
    } else if state.guarded {
        reason.push_str("温度已回落到临界值以下，恢复用户设定档位");
    }

    let mut duty = target;
    let mut changed = false;

    match state.applied {
        // Nothing known to be live on the fan interface yet: write it.
        None => changed = true,
        Some(current) if target > current => {
            // Upshifts are never delayed: cooling demand wins over smoothing.
            changed = true;
            reason.push_str(&format!(
                "升至 {target}（{}）",
                if guarded { "温控守护" } else { "策略" }
            ));
        }
        Some(current) if target < current => {
            // 最小保持时间只用于平滑自动曲线的降档。用户显式选择的手动/无级
            // 目标必须立即生效，否则守护进程会把刚设好的低档又顶回旧值。
            let held = mode != Mode::Auto || now.saturating_sub(state.last_change) >= cfg.min_hold;
            if held {
                changed = true;
                reason.push_str(&format!(
                    "降至 {target}（{}）",
                    if mode == Mode::Auto {
                        "曲线降档，迟滞与最小保持已满足"
                    } else {
                        "用户显式设定，不等待最小保持"
                    }
                ));
            } else {
                duty = current;
                reason.push_str(&format!(
                    "目标 {target} 低于当前 {current}，最小保持时间还需 {} 秒",
                    cfg.min_hold
                        .saturating_sub(now.saturating_sub(state.last_change))
                ));
            }
        }
        Some(current) => {
            duty = current;
            if reason.is_empty() {
                reason.push_str("维持当前占空比");
            }
        }
    }

    if changed {
        state.last_change = now;
    }
    state.applied = Some(duty);
    state.guarded = guarded;

    Decision {
        duty,
        band: state.band,
        alarm,
        reason,
        changed,
        guarded,
    }
}

// ---------------------------------------------------------------------------
// State snapshot
// ---------------------------------------------------------------------------

fn render_state(fields: &[(&str, String)]) -> String {
    fields
        .iter()
        .map(|(k, v)| format!("{k}={v}\n"))
        .collect::<String>()
}

/// Static state-file keys per source index, so the loop never allocates keys.
fn source_keys(index: usize) -> (&'static str, &'static str, &'static str) {
    match index {
        0 => ("cpu_mc", "cpu_age", "cpu_err"),
        1 => ("phy_mc", "phy_age", "phy_err"),
        2 => ("wifi_mc", "wifi_age", "wifi_err"),
        _ => ("modem_mc", "modem_age", "modem_err"),
    }
}

fn sample_fields(samples: &[Sample]) -> Vec<(&'static str, String)> {
    let mut out = Vec::with_capacity(SOURCES.len() * 3);
    for (index, name) in SOURCES.iter().enumerate() {
        let sample = samples.iter().find(|s| s.name == *name);
        let (mc_key, age_key, err_key) = source_keys(index);
        out.push((
            mc_key,
            sample
                .map(|s| s.mc.to_string())
                .unwrap_or_else(|| "-1".into()),
        ));
        out.push((
            age_key,
            sample
                .map(|s| s.age.to_string())
                .unwrap_or_else(|| "-1".into()),
        ));
        out.push((
            err_key,
            sample.and_then(|s| s.error.clone()).unwrap_or_default(),
        ));
    }
    out
}

fn daemon_running() -> bool {
    let Some(pid) = read_trim(PID_FILE).and_then(|s| s.parse::<u32>().ok()) else {
        return false;
    };
    read_trim(format!("/proc/{pid}/cmdline"))
        .map(|cmdline| cmdline.contains("airpi-fanctl") && cmdline.contains("daemon"))
        .unwrap_or(false)
}

fn write_state(fields: &[(&str, String)]) -> Result<()> {
    let tmp = format!("{STATE_FILE}.new");
    fs::write(&tmp, render_state(fields)).map_err(|e| format!("{tmp}: {e}"))?;
    fs::rename(&tmp, STATE_FILE).map_err(|e| e.to_string())
}

fn read_state() -> HashMap<String, String> {
    let mut out = HashMap::new();
    let text = match fs::read_to_string(STATE_FILE) {
        Ok(text) => text,
        Err(_) => return out,
    };
    for line in text.lines() {
        if let Some((key, value)) = line.split_once('=') {
            out.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

struct PidCleanup;

impl Drop for PidCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_file(PID_FILE);
    }
}

fn run_daemon() -> Result<()> {
    if daemon_running() {
        return Err("airpi-fancontrol already running".into());
    }
    write_value(PID_FILE, std::process::id())?;
    let _cleanup = PidCleanup;

    let mut cfg = Config::load();
    for error in &cfg.errors {
        log(LOG_ERROR, cfg.log_level, error);
    }
    ensure_driver(&cfg)?;
    let mut path = duty_target_path(&cfg)?;
    log(
        LOG_INFO,
        cfg.log_level,
        &format!(
            "daemon started pid={} driver={:?} path={} policy={}",
            std::process::id(),
            resolve_driver(&cfg.fan_driver),
            path.display(),
            cfg.policy_text()
        ),
    );

    let mut sampler = Sampler::default();
    // Adopt the level the interface already holds so the first loop does not
    // jerk the fan when the service restarts.
    let mut state = LoopState {
        applied: read_number(&path).and_then(|v| u32::try_from(v).ok()),
        ..LoopState::default()
    };

    loop {
        let now = now_secs();
        let next_cfg = Config::load();
        if next_cfg.fan_driver != cfg.fan_driver
            || next_cfg.fan_gpio != cfg.fan_gpio
            || next_cfg.fan_freq != cfg.fan_freq
        {
            if let Err(error) = ensure_driver(&next_cfg) {
                log(
                    LOG_ERROR,
                    cfg.log_level,
                    &format!("driver switch failed: {error}"),
                );
            }
            path = duty_target_path(&next_cfg).unwrap_or(path.clone());
            // A fresh interface may have come up stopped; put a known-good
            // level on it before reseeding the loop state.
            let _ = write_value(&path, next_cfg.stop_duty);
            state.applied = None;
            state.initialised = false;
            state.guarded = false;
        }
        for error in next_cfg.errors.iter().filter(|e| !cfg.errors.contains(e)) {
            log(LOG_ERROR, next_cfg.log_level, error);
        }
        cfg = next_cfg;

        let mode = read_mode();
        let samples = sampler.collect(&cfg, now);
        let hottest = Sampler::hottest(&samples);
        let requested = match mode {
            Mode::Stepless => read_number(SPEED_FILE).and_then(|v| u32::try_from(v).ok()),
            _ => None,
        };

        let decision = decide(&cfg, mode, hottest, requested, &mut state, now);

        let readback = read_number(&path).and_then(|v| u32::try_from(v).ok());
        // The fan interface is the ground truth: re-assert whenever it
        // disagrees with what the loop believes is live, no matter the mode.
        let drift = readback != Some(decision.duty);
        let mut written = false;
        let mut write_error: Option<String> = None;
        // 临时接管(临界守护 / 传感器失效兜底)不回写 fanspeed.conf，
        // 否则无级模式的用户目标会被覆盖掉，条件消失后回不去。
        let mirror = !(decision.guarded || decision.alarm == Alarm::Sensor);
        if decision.changed || drift {
            match write_duty(&cfg, &path, decision.duty, mirror) {
                Ok(()) => written = true,
                Err(error) => {
                    state.applied = readback;
                    write_error = Some(error);
                }
            }
            log(
                if written { LOG_INFO } else { LOG_ERROR },
                cfg.log_level,
                &format!(
                    "duty {:?} -> {} mode={} {} | {}",
                    readback,
                    decision.duty,
                    mode_key(mode),
                    if written { "ok" } else { "写入失败" },
                    decision.reason
                ),
            );
        } else {
            log(
                LOG_DEBUG,
                cfg.log_level,
                &format!("hold duty={} {}", decision.duty, decision.reason),
            );
        }

        let actual = if written {
            read_number(&path)
                .and_then(|v| u32::try_from(v).ok())
                .or(Some(decision.duty))
        } else {
            readback
        };

        let mut alarm = decision.alarm;
        if alarm == Alarm::None {
            if write_error.is_some() || actual != Some(decision.duty) {
                alarm = Alarm::Interface;
            } else if !cfg.errors.is_empty() {
                alarm = Alarm::Config;
            }
        }
        let alarm_msg = match &write_error {
            Some(error) => format!("写入 {} 失败: {}", path.display(), error),
            None if actual != Some(decision.duty) && actual.is_some() => format!(
                "接口回读 {} 与目标 {} 不一致",
                actual.unwrap_or(0),
                decision.duty
            ),
            None => decision.reason.clone(),
        };

        let fields = vec![
            ("ts", now.to_string()),
            ("daemon", "1".into()),
            ("mode", mode_key(mode).into()),
            ("mode_code", encode_mode(mode).to_string()),
            ("duty", decision.duty.to_string()),
            (
                "duty_sysfs",
                actual.map(|v| v.to_string()).unwrap_or_else(|| "-1".into()),
            ),
            (
                "duty_source",
                if written {
                    "written".into()
                } else if actual.is_some() {
                    "sysfs".into()
                } else {
                    "unknown".into()
                },
            ),
            ("driver", driver_key(resolve_driver(&cfg.fan_driver)).into()),
            (
                "driver_state",
                if resolve_driver(&cfg.fan_driver) == Driver::Pwm {
                    "pwm-fan".into()
                } else if module_loaded() {
                    "loaded".into()
                } else {
                    "absent".into()
                },
            ),
            ("pwm_path", path.display().to_string()),
            (
                "temp",
                hottest
                    .map(|(mc, _)| format!("{:.1}", mc as f64 / 1000.0))
                    .unwrap_or_else(|| "null".into()),
            ),
            (
                "temp_mc",
                hottest
                    .map(|(mc, _)| mc.to_string())
                    .unwrap_or_else(|| "-1".into()),
            ),
            (
                "temp_source",
                hottest
                    .map(|(_, n)| n.to_string())
                    .unwrap_or_else(|| "none".into()),
            ),
            ("band", decision.band.to_string()),
            ("alarm", alarm.key().into()),
            ("alarm_msg", alarm_msg),
            (
                "guarded",
                if decision.guarded {
                    "1".into()
                } else {
                    "0".into()
                },
            ),
            ("interval", cfg.interval.to_string()),
            ("slow_interval", cfg.slow_interval.to_string()),
            ("min_hold", cfg.min_hold.to_string()),
            ("hysteresis", (cfg.hysteresis / 1000).to_string()),
            ("policy", cfg.policy_text()),
            ("fail_duty", cfg.fail_duty.to_string()),
            ("fail_count", cfg.fail_count.to_string()),
            ("misses", state.misses.to_string()),
            (
                "crit_guard",
                if cfg.crit_guard {
                    "1".into()
                } else {
                    "0".into()
                },
            ),
            ("config_errors", cfg.errors.join(" | ")),
            ("log_level", cfg.log_level.to_string()),
            ("stop_duty", cfg.stop_duty.to_string()),
            ("fanval", encode_mode(mode).to_string()),
            (
                "fanspd",
                read_trim(SPEED_FILE).unwrap_or_else(|| "0".into()),
            ),
        ];
        let mut all: Vec<(&str, String)> = fields;
        for (key, value) in sample_fields(&samples) {
            all.push((key, value));
        }
        if let Err(error) = write_state(&all) {
            log(
                LOG_ERROR,
                cfg.log_level,
                &format!("state write failed: {error}"),
            );
        }

        // Reschedule only for the next loop; the page never drives timing.
        let remaining = cfg.interval.saturating_sub(now_secs().saturating_sub(now));
        thread::sleep(Duration::from_secs(remaining.max(1)));
    }
}

fn mode_key(mode: Mode) -> &'static str {
    match mode {
        Mode::Auto => "auto",
        Mode::Step(_) => "manual",
        Mode::Stepless => "stepless",
    }
}

fn driver_key(driver: Driver) -> &'static str {
    match driver {
        Driver::Pwm => "pwm",
        Driver::SoftPwm => "softpwm",
    }
}

// ---------------------------------------------------------------------------
// Read-only commands (CLI contract kept for existing clients)
// ---------------------------------------------------------------------------

fn cmd_temps() {
    for s in thermal_sensors() {
        println!("{}={}", s.name, s.mc / 1000);
    }
}

fn cmd_legacy_temp(option: &str) {
    if option == "-a" {
        cmd_temps();
        return;
    }
    let sensor = thermal_sensors().into_iter().max_by_key(|sensor| sensor.mc);
    match (option, sensor) {
        ("-c", Some(sensor)) => println!("{}", sensor.mc / 1000),
        ("-s", Some(sensor)) => println!("{} {}", sensor.mc, sensor.name),
        ("-c", None) => println!("0"),
        ("-s", None) => println!("0 none"),
        (_, Some(sensor)) => println!("{}", sensor.mc),
        (_, None) => println!("0"),
    }
}

fn cmd_temp() {
    if let Some(s) = thermal_sensors().into_iter().max_by_key(|s| s.mc) {
        let label = match s.name {
            "wifi" => "WiFi温度",
            "phy" => "网络温度",
            "modem" => "模组温度",
            _ => "CPU温度",
        };
        println!("temp={:.1}", s.mc as f64 / 1000.0);
        println!("source={label}");
    } else {
        println!("temp=null\nsource=CPU温度");
    }
}

fn mode_label(mode: &str) -> &'static str {
    match mode {
        "auto" => "智能",
        "stepless" => "无极",
        _ => "手动",
    }
}

fn cmd_status() {
    let speed = read_trim(SPEED_FILE).unwrap_or_else(|| "0".into());
    let value = read_trim(FANVAL_FILE).unwrap_or_else(|| "na".into());
    // mode is the user's intent and daemon says whether anything enforces it.
    // The legacy build collapsed both into one Chinese string, which left the
    // UI comparing translated text to know what the device was doing.
    let mode = match value.as_str() {
        "999" => "stepless",
        "0" | "1" | "2" | "3" => "manual",
        _ => "auto",
    };
    println!("fanspd={speed}");
    println!("fanval={value}");
    println!("mode={mode}");
    println!("mode_cn={}", mode_label(mode));
    println!(
        "driver={}",
        driver_key(resolve_driver(&Config::load().fan_driver))
    );
    println!("daemon={}", daemon_running() as u8);
}

/// Single snapshot for the web UI: one process, no extra forks when the
/// daemon is alive.
fn cmd_snapshot() {
    let state = read_state();
    let ts = state.get("ts").and_then(|v| v.parse::<u64>().ok());
    // -1 means "no snapshot from the daemon yet", not "very old".
    let age = ts.map(|t| now_secs().saturating_sub(t)).unwrap_or(u64::MAX);
    let age_text = if age == u64::MAX {
        "-1".to_string()
    } else {
        age.to_string()
    };
    let interval = state
        .get("interval")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(8);

    if ts.is_some() && age <= interval * 3 {
        for key in [
            "ts",
            "age",
            "daemon",
            "mode",
            "mode_code",
            "duty",
            "duty_sysfs",
            "duty_source",
            "driver",
            "driver_state",
            "pwm_path",
            "temp",
            "temp_mc",
            "temp_source",
            "band",
            "alarm",
            "alarm_msg",
            "guarded",
            "interval",
            "slow_interval",
            "min_hold",
            "hysteresis",
            "policy",
            "fail_duty",
            "fail_count",
            "misses",
            "crit_guard",
            "config_errors",
            "log_level",
            "stop_duty",
            "fanval",
            "fanspd",
            "cpu_mc",
            "cpu_age",
            "cpu_err",
            "phy_mc",
            "phy_age",
            "phy_err",
            "wifi_mc",
            "wifi_age",
            "wifi_err",
            "modem_mc",
            "modem_age",
            "modem_err",
        ] {
            if key == "age" {
                println!("age={age_text}");
                continue;
            }
            if let Some(value) = state.get(key) {
                println!("{key}={value}");
            }
        }
        println!("snapshot=daemon");
        return;
    }

    // Daemon not running (or the state file is stale): read the cheap
    // interfaces live and reuse whatever the last daemon cycle recorded for
    // the sources that would cost an iwpriv/ubus fork per page refresh.
    let cfg = Config::load();
    let now = now_secs();
    let mut sampler = Sampler::default();
    let mut samples: Vec<Sample> = Vec::new();
    for (index, name) in SOURCES.iter().enumerate() {
        if !cfg.enabled[index] {
            samples.push(Sampler::disabled(index, "已在设置中停用"));
            continue;
        }
        if matches!(*name, "cpu" | "phy") {
            samples.push(sampler.read(index, false, now, cfg.slow_interval));
            continue;
        }
        let (mc_key, _, _) = source_keys(index);
        match state
            .get(mc_key)
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|v| valid_mc(*v))
        {
            Some(mc) => samples.push(Sample {
                name: SOURCES[index],
                mc,
                age: if age == u64::MAX { -1 } else { age as i64 },
                error: Some("沿用上一次守护进程采样".into()),
            }),
            None => samples.push(Sampler::disabled(index, "温控服务未运行，未采集")),
        }
    }
    let hottest = Sampler::hottest(&samples);
    let mode = read_mode();
    let path = duty_target_path(&cfg).ok();
    let readback = path
        .as_ref()
        .and_then(read_number)
        .and_then(|v| u32::try_from(v).ok());
    let fields = vec![
        ("ts", now.to_string()),
        ("age", age_text.clone()),
        ("daemon", "0".into()),
        ("mode", mode_key(mode).into()),
        ("mode_code", encode_mode(mode).to_string()),
        (
            "duty",
            read_trim(SPEED_FILE)
                .or_else(|| readback.map(|v| v.to_string()))
                .unwrap_or_else(|| "0".into()),
        ),
        (
            "duty_sysfs",
            readback
                .map(|v| v.to_string())
                .unwrap_or_else(|| "-1".into()),
        ),
        ("duty_source", "file".into()),
        ("driver", driver_key(resolve_driver(&cfg.fan_driver)).into()),
        (
            "driver_state",
            if resolve_driver(&cfg.fan_driver) == Driver::Pwm {
                "pwm-fan".into()
            } else if module_loaded() {
                "loaded".into()
            } else {
                "absent".into()
            },
        ),
        (
            "pwm_path",
            path.map(|p| p.display().to_string()).unwrap_or_default(),
        ),
        (
            "temp",
            hottest
                .map(|(mc, _)| format!("{:.1}", mc as f64 / 1000.0))
                .unwrap_or_else(|| "null".into()),
        ),
        (
            "temp_mc",
            hottest
                .map(|(mc, _)| mc.to_string())
                .unwrap_or_else(|| "-1".into()),
        ),
        (
            "temp_source",
            hottest
                .map(|(_, n)| n.to_string())
                .unwrap_or_else(|| "none".into()),
        ),
        (
            "band",
            band_initial(hottest.map(|(mc, _)| mc).unwrap_or(0), &cfg).to_string(),
        ),
        (
            "alarm",
            if hottest.is_none() {
                Alarm::Sensor.key()
            } else if !cfg.errors.is_empty() {
                Alarm::Config.key()
            } else {
                Alarm::None.key()
            }
            .into(),
        ),
        (
            "alarm_msg",
            if hottest.is_none() {
                "温控服务未运行，无法确认散热状态".to_string()
            } else {
                String::new()
            },
        ),
        ("guarded", "0".into()),
        ("interval", cfg.interval.to_string()),
        ("slow_interval", cfg.slow_interval.to_string()),
        ("min_hold", cfg.min_hold.to_string()),
        ("hysteresis", (cfg.hysteresis / 1000).to_string()),
        ("policy", cfg.policy_text()),
        ("fail_duty", cfg.fail_duty.to_string()),
        ("fail_count", cfg.fail_count.to_string()),
        ("misses", "0".into()),
        (
            "crit_guard",
            if cfg.crit_guard {
                "1".into()
            } else {
                "0".into()
            },
        ),
        ("config_errors", cfg.errors.join(" | ")),
        ("log_level", cfg.log_level.to_string()),
        ("stop_duty", cfg.stop_duty.to_string()),
        (
            "fanval",
            read_trim(FANVAL_FILE).unwrap_or_else(|| "na".into()),
        ),
        (
            "fanspd",
            read_trim(SPEED_FILE).unwrap_or_else(|| "0".into()),
        ),
    ];
    let mut all = fields;
    for (key, value) in sample_fields(&samples) {
        all.push((key, value));
    }
    for (key, value) in &all {
        println!("{key}={value}");
    }
    println!("snapshot=cli");
}

/// The `pwm-fan` hwmon node, reported separately from the interface actually
/// driving the fan: on the 16GB AP3000M this node exists and stays at 0 while
/// the fan is driven through /sys/kernel/duty_cycle, which is evidence the fan
/// is not wired to that channel.
fn hwmon_pwmfan_path() -> Option<PathBuf> {
    pwm_paths()
        .into_iter()
        .find(|p| p.starts_with("/sys/class/hwmon"))
}

fn cmd_hwdetect() {
    let emmc = emmc_sectors();
    if let Some(s) = emmc {
        println!(
            "emmc_sectors={s}\nemmc_gb={}",
            (s * 512 + 500_000_000) / 1_000_000_000
        );
    } else {
        println!("emmc_sectors=na\nemmc_gb=?");
    }
    println!(
        "hw_pwm={}",
        if emmc.is_some_and(|sectors| sectors > EMMC_THRESHOLD) {
            None
        } else {
            pwm_path()
        }
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "none".into())
    );
    println!(
        "pwmchip={}",
        fs::read_dir("/sys/class/pwm")
            .ok()
            .and_then(|mut e| e.next())
            .and_then(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .unwrap_or_else(|| "none".into())
    );
    let cfg = Config::load();
    let pwmfan = hwmon_pwmfan_path();
    println!(
        "pwmfan_path={}\npwmfan_value={}",
        pwmfan
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "none".into()),
        pwmfan
            .as_ref()
            .and_then(read_trim)
            .unwrap_or_else(|| "na".into())
    );
    println!(
        "softpwm_loaded={}\nduty={}\ndriver={}\nstop_duty={}",
        module_loaded() as u8,
        read_trim(DUTY_PATH).unwrap_or_else(|| "na".into()),
        driver_key(resolve_driver(&cfg.fan_driver)),
        cfg.stop_duty
    );
}

fn cmd_logs(lines: usize) {
    let text = fs::read_to_string(LOG_FILE).unwrap_or_default();
    let entries: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if entries.is_empty() {
        println!("(暂无日志，可在高级设置中提高日志级别)");
        println!("logfile={LOG_FILE}");
        return;
    }
    // Every line is "<epoch> [level] message"; the epoch is rendered as a UTC
    // time of day because a Busybox device has no timezone database here.
    for line in &entries[entries.len().saturating_sub(lines.max(1))..] {
        let (epoch, rest) = line.split_once(' ').unwrap_or(("0", line));
        let clock = epoch
            .parse::<u64>()
            .map(|t| {
                let secs = t % 86_400;
                format!(
                    "{:02}:{:02}:{:02}",
                    secs / 3600,
                    (secs % 3600) / 60,
                    secs % 60
                )
            })
            .unwrap_or_else(|_| "--:--:--".into());
        println!("{clock} {rest}");
    }
    println!("logfile={LOG_FILE}");
}

// ---------------------------------------------------------------------------
// Control commands
// ---------------------------------------------------------------------------

fn start_service_if_dead() -> Result<()> {
    if daemon_running() {
        return Ok(());
    }
    if run_status("/etc/init.d/airpi-fancontrol", &["start"]) {
        return Ok(());
    }
    Err("failed to start airpi-fancontrol".into())
}

/// Writes the fan interface and, unless this is a temporary safety override,
/// mirrors the value into `/usr/bin/fanspeed.conf`.
///
/// The mirror doubles as the user's stepless request, so an override must not
/// overwrite it — otherwise the fan would stay at the override level after the
/// critical condition clears instead of returning to the slider setting.
fn write_duty(cfg: &Config, path: &Path, value: u32, mirror: bool) -> Result<()> {
    write_value(path, value)?;
    if mirror {
        // The historic mirror lives under /usr/bin; a read-only root must not
        // abort a control action that already reached the hardware.
        if let Err(error) = write_value(SPEED_FILE, value) {
            log(
                LOG_ERROR,
                cfg.log_level,
                &format!("fanspeed.conf mirror failed: {error}"),
            );
        }
    }
    Ok(())
}

fn cmd_set(speed: &str, mode: &str) -> Result<()> {
    let speed = parse_range(speed, 0, 255, "speed")?;
    let code = parse_range(mode, 0, 3, "mode")?;
    let cfg = Config::load();
    let path = duty_target_path(&cfg)?;
    write_value(FANVAL_FILE, code)?;
    write_duty(&cfg, &path, speed, true)?;
    if let Err(error) = start_service_if_dead() {
        log(LOG_ERROR, cfg.log_level, &error);
    }
    println!("result=ok\nduty={speed}\nmode=manual");
    Ok(())
}

fn cmd_auto() -> Result<()> {
    write_value(FANVAL_FILE, 9)?;
    // The live loop picks the mode up on its next pass; no service restart,
    // so the fan never loses its drive signal mid-switch.
    start_service_if_dead()?;
    println!("result=ok\nmode=auto");
    Ok(())
}

fn cmd_stepless(speed: &str) -> Result<()> {
    let speed = parse_range(speed, 0, 255, "speed")?;
    let cfg = Config::load();
    let path = duty_target_path(&cfg)?;
    write_value(FANVAL_FILE, 999)?;
    write_duty(&cfg, &path, speed, true)?;
    if let Err(error) = start_service_if_dead() {
        log(LOG_ERROR, cfg.log_level, &error);
    }
    println!("result=ok\nspeed={speed}\nmode=stepless");
    Ok(())
}

fn cmd_reload() -> Result<()> {
    if daemon_running() {
        // The loop re-reads UCI on every pass, so a running daemon needs no
        // restart — that is what keeps the drive signal uninterrupted.
        println!("result=ok\nreloaded=daemon");
        return Ok(());
    }
    // Not running (stopped, or parked in a mode the legacy build exited on):
    // a plain start is enough, and it never touches the fan level first.
    if run_status("/etc/init.d/airpi-fancontrol", &["start"]) {
        println!("result=ok\nreloaded=start");
        return Ok(());
    }
    Err("failed to start airpi-fancontrol".into())
}

fn usage() -> &'static str {
    "usage: airpi-fanctl {daemon|status|snapshot|temp|temps|legacy-temp <-a|-c|-s>|set <speed> <mode>|auto|stepless <speed>|hwdetect|logs [n]|reload}"
}

fn dispatch(args: &[String]) -> Result<()> {
    let command = args.get(1).map(String::as_str).unwrap_or("");
    let arg1 = args.get(2).map(String::as_str).unwrap_or("");
    let arg2 = args.get(3).map(String::as_str).unwrap_or("");
    match command {
        "daemon" => run_daemon(),
        "status" => {
            cmd_status();
            Ok(())
        }
        "snapshot" => {
            cmd_snapshot();
            Ok(())
        }
        "temp" => {
            cmd_temp();
            Ok(())
        }
        "temps" => {
            cmd_temps();
            Ok(())
        }
        "legacy-temp" => {
            cmd_legacy_temp(arg1);
            Ok(())
        }
        "set" => cmd_set(arg1, arg2),
        "auto" => cmd_auto(),
        "stepless" => cmd_stepless(arg1),
        "hwdetect" => {
            cmd_hwdetect();
            Ok(())
        }
        "logs" => {
            cmd_logs(arg1.parse::<usize>().unwrap_or(80));
            Ok(())
        }
        "reload" => cmd_reload(),
        _ => Err(usage().into()),
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    if let Err(error) = dispatch(&args) {
        eprintln!("airpi-fanctl: {error}");
        std::process::exit(1);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn kv(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn parses_uci_show_options_only() {
        let text = "airpi-fan.settings=fan\nairpi-fan.settings.fan_driver='softpwm'\n\
                    airpi-fan.settings.temp_high='88'\nairpi-fan.settings.auto.cur_item='x'\n";
        let map = parse_uci_show(text);
        assert_eq!(map.get("fan_driver").map(String::as_str), Some("softpwm"));
        assert_eq!(map.get("temp_high").map(String::as_str), Some("88"));
        assert_eq!(map.get("cur_item"), None);
        assert!(!map.contains_key("settings"));
    }

    #[test]
    fn defaults_reproduce_legacy_curve() {
        let cfg = Config::from_kv(&kv(&[]));
        assert!(cfg.errors.is_empty(), "{:?}", cfg.errors);
        assert_eq!(cfg.temp_low, 50_000);
        assert_eq!(cfg.temp_mid, 60_000);
        assert_eq!(cfg.temp_high, 85_000);
        assert_eq!(cfg.duties, [64, 128, 192, 255]);
        assert_eq!(cfg.interval, 8);
        assert_eq!(cfg.policy_text(), "85:255 60:192 50:128 *:64");
    }

    #[test]
    fn rejects_out_of_range_and_reports_it() {
        let cfg = Config::from_kv(&kv(&[
            ("duty_high", "300"),
            ("auto_interval", "0"),
            ("fan_driver", "turbo"),
        ]));
        assert_eq!(cfg.duties[3], 255, "invalid duty must not be adopted");
        assert_eq!(cfg.interval, 8);
        assert_eq!(cfg.fan_driver, "auto");
        assert_eq!(cfg.errors.len(), 3, "{:?}", cfg.errors);
    }

    #[test]
    fn non_monotonic_thresholds_fall_back() {
        let cfg = Config::from_kv(&kv(&[
            ("temp_low", "70"),
            ("temp_mid", "40"),
            ("temp_high", "90"),
        ]));
        assert_eq!(cfg.temp_low, 50_000);
        assert!(cfg.errors.iter().any(|e| e.contains("温度阈值需严格递增")));
    }

    #[test]
    fn reversed_duties_are_sorted() {
        let cfg = Config::from_kv(&kv(&[("duty_idle", "200"), ("duty_high", "100")]));
        assert!(cfg.duties[0] <= cfg.duties[3]);
        assert!(cfg
            .errors
            .iter()
            .any(|e| e.contains("占空比需随温度单调不降")));
    }

    #[test]
    fn critical_temperature_is_kept_above_the_curve() {
        let cfg = Config::from_kv(&kv(&[("temp_crit", "60")]));
        assert!(cfg.temp_crit > cfg.temp_high);
        assert!(cfg.errors.iter().any(|e| e.contains("临界温度")));
    }

    #[test]
    fn mode_codec_matches_legacy_fanvall() {
        assert_eq!(decode_mode(0), Mode::Step(0));
        assert_eq!(decode_mode(3), Mode::Step(3));
        assert_eq!(decode_mode(9), Mode::Auto);
        assert_eq!(decode_mode(999), Mode::Stepless);
        assert_eq!(decode_mode(12345), Mode::Auto);
        assert_eq!(encode_mode(Mode::Auto), 9);
        assert_eq!(encode_mode(Mode::Stepless), 999);
        assert_eq!(mode_key(Mode::Step(2)), "manual");
    }

    #[test]
    fn band_uses_hysteresis_on_the_way_down() {
        let cfg = Config::default();
        assert_eq!(band_index(86_000, 0, &cfg), 3);
        assert_eq!(
            band_index(61_000, 3, &cfg),
            2,
            "no hysteresis floor crossed yet"
        );
        // 85 - 2 = 83: dropping below the floor minus hysteresis releases one band.
        assert_eq!(band_index(82_500, 3, &cfg), 2);
        assert_eq!(band_index(58_000, 2, &cfg), 1);
        assert_eq!(band_index(47_000, 1, &cfg), 0);
        assert_eq!(band_initial(60_000, &cfg), 2);
        assert_eq!(band_initial(49_999, &cfg), 0);
    }

    #[test]
    fn auto_loop_follows_the_curve_and_holds_before_dropping() {
        let cfg = Config::default();
        let mut state = LoopState::default();
        let first = decide(
            &cfg,
            Mode::Auto,
            Some((70_000, "cpu")),
            None,
            &mut state,
            100,
        );
        assert_eq!(first.duty, 192);
        assert!(first.changed);

        // Same band, no write.
        let same = decide(
            &cfg,
            Mode::Auto,
            Some((71_000, "cpu")),
            None,
            &mut state,
            104,
        );
        assert!(!same.changed);

        // Cooler, but inside the minimum hold window.
        let held = decide(
            &cfg,
            Mode::Auto,
            Some((45_000, "cpu")),
            None,
            &mut state,
            110,
        );
        assert_eq!(held.duty, 192, "downshift must wait for min_hold");
        assert!(!held.changed);

        // After min_hold the level drops.
        let dropped = decide(
            &cfg,
            Mode::Auto,
            Some((45_000, "cpu")),
            None,
            &mut state,
            131,
        );
        assert_eq!(dropped.duty, 64);
        assert!(dropped.changed);

        // A hot reading wins over the hold timer immediately.
        let up = decide(
            &cfg,
            Mode::Auto,
            Some((90_000, "cpu")),
            None,
            &mut state,
            133,
        );
        assert_eq!(up.duty, 255);
        assert!(up.changed);
    }

    #[test]
    fn manual_mode_is_respected_until_the_guard_trips() {
        let cfg = Config::default();
        let mut state = LoopState::default();
        let manual = decide(
            &cfg,
            Mode::Step(0),
            Some((55_000, "cpu")),
            None,
            &mut state,
            10,
        );
        assert_eq!(manual.duty, 64);
        assert!(!manual.guarded);
        assert_eq!(manual.alarm, Alarm::None);

        let guarded = decide(
            &cfg,
            Mode::Step(0),
            Some((96_000, "cpu")),
            None,
            &mut state,
            20,
        );
        assert_eq!(guarded.duty, 255);
        assert!(guarded.guarded);
        assert_eq!(guarded.alarm, Alarm::Thermal);

        let released = decide(
            &cfg,
            Mode::Step(0),
            Some((55_000, "cpu")),
            None,
            &mut state,
            100,
        );
        assert!(!released.guarded, "guard releases once below critical");
    }

    #[test]
    fn manual_guard_can_be_disabled() {
        let cfg = Config {
            crit_guard: false,
            ..Config::default()
        };
        let mut state = LoopState::default();
        let manual = decide(
            &cfg,
            Mode::Step(0),
            Some((120_000, "cpu")),
            None,
            &mut state,
            10,
        );
        assert_eq!(manual.duty, 64);
    }

    #[test]
    fn stepless_keeps_the_requested_level() {
        let cfg = Config::default();
        let mut state = LoopState::default();
        let step = decide(
            &cfg,
            Mode::Stepless,
            Some((55_000, "cpu")),
            Some(170),
            &mut state,
            10,
        );
        assert_eq!(step.duty, 170);
        assert!(step.changed);
        let again = decide(
            &cfg,
            Mode::Stepless,
            Some((56_000, "cpu")),
            Some(170),
            &mut state,
            18,
        );
        assert!(!again.changed, "an unchanged level must not be rewritten");
    }

    #[test]
    fn sensor_failure_escalates_after_the_configured_misses() {
        let cfg = Config::default();
        let mut state = LoopState::default();
        decide(
            &cfg,
            Mode::Auto,
            Some((70_000, "cpu")),
            None,
            &mut state,
            10,
        );
        for tick in 1..3 {
            let held = decide(&cfg, Mode::Auto, None, None, &mut state, 20 + tick);
            assert_eq!(held.duty, 192, "brief dropouts keep the last level");
            assert_eq!(held.alarm, Alarm::Sensor);
        }
        let failed = decide(&cfg, Mode::Auto, None, None, &mut state, 30);
        assert_eq!(failed.duty, 255, "fail-safe drives full cooling");
        assert_eq!(failed.alarm, Alarm::Sensor);
        assert!(failed.changed, "entering the fail-safe must reach the fan");
        assert_eq!(failed.band, 2, "the curve band is preserved");

        // Steady state: the level is already applied, so it is not rewritten
        // (and not re-logged) on every single cycle.
        let held2 = decide(&cfg, Mode::Auto, None, None, &mut state, 38);
        assert_eq!(held2.duty, 255);
        assert!(
            !held2.changed,
            "an unchanged fail-safe level must not be rewritten"
        );

        // A good reading resets the counter.
        let recovered = decide(
            &cfg,
            Mode::Auto,
            Some((30_000, "cpu")),
            None,
            &mut state,
            40,
        );
        assert_eq!(state.misses, 0, "a valid reading clears the miss streak");
        assert_eq!(recovered.alarm, Alarm::None);
    }

    #[test]
    fn decision_reason_is_never_empty_when_it_matters() {
        let cfg = Config::default();
        let mut state = LoopState::default();
        let failed = decide(&cfg, Mode::Auto, None, None, &mut state, 5);
        assert!(!failed.reason.is_empty());
    }

    #[test]
    fn phy_bucket_takes_the_hottest_chip_not_the_first() {
        // Real AP3000M sample set: switch PHY 42 °C, two mt7915 radios at
        // 66 °C, a cpu_thermal chip reporting a negative value, and a
        // broken cpu thermal zone.
        let chips = [42_000, -11_192, 66_000, 66_000, -12_712];
        assert_eq!(
            valid_max(chips.into_iter()),
            Some(66_000),
            "control must follow the hottest valid source"
        );
        assert_eq!(valid_max([-1_000_i64, -12_712_i64]), None);
    }

    #[test]
    fn sampler_reports_hottest_and_skips_invalid() {
        let samples = vec![
            Sample {
                name: "cpu",
                mc: 51_000,
                age: 0,
                error: None,
            },
            Sample {
                name: "wifi",
                mc: -1,
                age: 0,
                error: Some("offline".into()),
            },
            Sample {
                name: "modem",
                mc: 58_000,
                age: 1,
                error: None,
            },
        ];
        assert_eq!(Sampler::hottest(&samples), Some((58_000, "modem")));
        assert_eq!(
            Sampler::hottest(&[Sample {
                name: "cpu",
                mc: -1,
                age: 0,
                error: None
            }]),
            None
        );
    }

    #[test]
    fn state_file_roundtrips() {
        let fields = vec![
            ("ts", "1".to_string()),
            ("mode", "auto".to_string()),
            ("alarm_msg", "温度 88 ℃".to_string()),
        ];
        let text = render_state(&fields);
        assert!(text.starts_with("ts=1\n"));
        assert!(text.ends_with('\n'));
        assert_eq!(text.lines().count(), 3);
    }

    #[test]
    fn parses_modem_temperature_field() {
        assert_eq!(
            parse_modem_temperature(r#"{"temperature":{"value": 57}}"#),
            Some(57_000)
        );
        assert_eq!(
            parse_modem_temperature(r#"{"temperature": 48500}"#),
            Some(48_500)
        );
        assert_eq!(parse_modem_temperature(r#"{"signal": 75}"#), None);
        assert_eq!(
            parse_modem_temperature(r#"{"temperature":{"name":"5G","value": 61}}"#),
            Some(61_000)
        );
    }

    #[test]
    fn validates_control_ranges() {
        assert_eq!(parse_range("255", 0, 255, "speed"), Ok(255));
        assert!(parse_range("256", 0, 255, "speed").is_err());
        assert!(parse_range("fast", 0, 255, "speed").is_err());
    }

    #[test]
    fn range_guard_rejects_bad_driver_gpio_and_freq() {
        let cfg = Config::from_kv(&kv(&[("fan_gpio", "2000"), ("fan_freq", "50")]));
        assert_eq!(cfg.fan_gpio, 540);
        assert_eq!(cfg.fan_freq, 15_000);
        assert_eq!(cfg.errors.len(), 2, "{:?}", cfg.errors);
    }

    #[test]
    fn pwm_period_floor_matches_the_driver_slice_resolution() {
        // The driver divides the period into 256 slices of at least 1 µs each;
        // a shorter period would mean ~1M hrtimer wakeups per second.
        let too_short = Config::from_kv(&kv(&[("fan_freq", "255")]));
        assert_eq!(too_short.fan_freq, 15_000);
        assert!(too_short
            .errors
            .iter()
            .any(|e| e.contains("fan_freq") && e.contains("256")));

        let boundary = Config::from_kv(&kv(&[("fan_freq", "256")]));
        assert_eq!(boundary.fan_freq, 256);
        assert!(boundary.errors.is_empty(), "{:?}", boundary.errors);
    }

    #[test]
    fn explicit_manual_choice_ignores_the_auto_curve_hold_timer() {
        let cfg = Config::default();
        let mut state = LoopState::default();
        // The curve has just raised the fan to full speed.
        decide(
            &cfg,
            Mode::Auto,
            Some((90_000, "cpu")),
            None,
            &mut state,
            100,
        );
        assert_eq!(state.applied, Some(255));

        // Seconds later the user picks the quiet level; min_hold must not
        // push the old duty back onto the fan.
        let manual = decide(
            &cfg,
            Mode::Step(0),
            Some((90_000, "cpu")),
            None,
            &mut state,
            104,
        );
        assert_eq!(manual.duty, 64, "a manual downshift applies immediately");
        assert!(manual.changed);
    }

    #[test]
    fn stepless_returns_to_the_user_level_after_the_guard_clears() {
        let cfg = Config::default();
        let mut state = LoopState::default();
        let picked = decide(
            &cfg,
            Mode::Stepless,
            Some((55_000, "cpu")),
            Some(120),
            &mut state,
            10,
        );
        assert_eq!(picked.duty, 120);

        decide(
            &cfg,
            Mode::Stepless,
            Some((99_000, "cpu")),
            Some(120),
            &mut state,
            20,
        );
        assert_eq!(state.applied, Some(255), "guard takes over at full duty");

        let back = decide(
            &cfg,
            Mode::Stepless,
            Some((55_000, "cpu")),
            Some(120),
            &mut state,
            30,
        );
        assert_eq!(back.duty, 120, "the requested level is restored");
        assert!(back.changed);
    }
}
