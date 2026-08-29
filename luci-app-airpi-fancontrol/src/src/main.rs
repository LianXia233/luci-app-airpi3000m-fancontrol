use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

const DUTY_PATH: &str = "/sys/kernel/duty_cycle";
const SPEED_FILE: &str = "/usr/bin/fanspeed.conf";
const FANVAL_FILE: &str = "/etc/fanvall";
const PID_FILE: &str = "/var/run/airpi-fancontrol.pid";
const EMMC_FILE: &str = "/sys/block/mmcblk0/size";
const EMMC_THRESHOLD: u64 = 25_000_000;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Driver {
    Pwm,
    SoftPwm,
}

#[derive(Clone, Debug)]
struct Sensor {
    name: &'static str,
    mc: i64,
}

fn read_trim(path: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
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

fn uci_get(option: &str, default: &str) -> String {
    command_output(
        "uci",
        &["-q", "get", &format!("airpi-fan.settings.{}", option)],
    )
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| default.to_string())
}

fn emmc_sectors() -> Option<u64> {
    read_trim(EMMC_FILE)?.parse().ok().filter(|n: &u64| *n > 0)
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

fn selected_driver() -> Driver {
    match uci_get("fan_driver", "auto").as_str() {
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

fn configured_driver() -> Result<Driver> {
    match uci_get("fan_driver", "auto").as_str() {
        "auto" => Ok(selected_driver()),
        "pwm" => Ok(Driver::Pwm),
        "softpwm" => Ok(Driver::SoftPwm),
        value => Err(format!("invalid fan_driver: {value}")),
    }
}

fn module_loaded() -> bool {
    read_trim("/proc/modules")
        .map(|s| {
            s.lines()
                .any(|l| l.split_whitespace().next() == Some("airpi_gpio_fan"))
        })
        .unwrap_or(false)
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

fn ensure_driver(driver: Driver) -> Result<()> {
    match driver {
        Driver::Pwm => {
            let _ = run_status("rmmod", &["airpi_gpio_fan"]);
            Ok(())
        }
        Driver::SoftPwm if module_loaded() => Ok(()),
        Driver::SoftPwm => {
            let gpio = parse_range(&uci_get("fan_gpio", "540"), 0, 1023, "fan_gpio")?;
            let freq = parse_range(&uci_get("fan_freq", "15000"), 100, 1_000_000, "fan_freq")?;
            let gpio_s = gpio.to_string();
            let freq_s = freq.to_string();
            if run_status(
                "insmod",
                &[
                    "airpi-gpio-fan",
                    &format!("fangpio={gpio_s}"),
                    "cycle=255",
                    &format!("period={freq_s}"),
                    "fanen=1",
                ],
            ) || run_status(
                "modprobe",
                &[
                    "airpi_gpio_fan",
                    &format!("fangpio={gpio_s}"),
                    "cycle=255",
                    &format!("period={freq_s}"),
                    "fanen=1",
                ],
            ) {
                Ok(())
            } else {
                Err("failed to load airpi-gpio-fan".into())
            }
        }
    }
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

fn write_pwm(value: u32) -> Result<()> {
    let driver = configured_driver()?;
    let path = match driver {
        Driver::Pwm => pwm_path().ok_or("hardware PWM path not found".to_string())?,
        Driver::SoftPwm => PathBuf::from(DUTY_PATH),
    };
    write_value(&path, value)?;
    write_value(SPEED_FILE, value)
}

fn valid_mc(value: i64) -> bool {
    (1_000..=150_000).contains(&value)
}

fn thermal_sensors() -> Vec<Sensor> {
    let mut out = Vec::new();
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
            if let Some(v) = read_number(dir.join("temp")).filter(|v| valid_mc(*v)) {
                add_sensor(&mut out, "cpu", v);
            }
        }
    }
    if let Ok(entries) = fs::read_dir("/sys/class/hwmon") {
        for entry in entries.flatten() {
            let dir = entry.path();
            let name = read_trim(dir.join("name")).unwrap_or_default();
            if matches!(name.as_str(), "pwmfan" | "pwm-fan" | "fan") {
                continue;
            }
            if let Some(v) = read_number(dir.join("temp1_input")).filter(|v| valid_mc(*v)) {
                add_sensor(&mut out, "phy", v);
            }
        }
    }
    for dev in ["ra0", "rax0", "rai0"] {
        if Path::new(&format!("/sys/class/net/{dev}")).exists() {
            if let Some(text) = command_output("iwpriv", &[dev, "stat"]) {
                if let Some(v) = text
                    .lines()
                    .find(|l| l.to_ascii_lowercase().contains("currenttemperature"))
                    .and_then(|l| {
                        l.split(|c: char| !c.is_ascii_digit())
                            .find(|s| !s.is_empty())
                    })
                    .and_then(|s| s.parse::<i64>().ok())
                    .map(|n| n * 1000)
                    .filter(|v| valid_mc(*v))
                {
                    add_sensor(&mut out, "wifi", v);
                }
            }
            break;
        }
    }
    if let Some(v) = command_output("ubus", &["call", "modem_ctrl", "info"])
        .and_then(|text| parse_modem_temperature(&text))
    {
        add_sensor(&mut out, "modem", v);
    }
    out
}

fn add_sensor(sensors: &mut Vec<Sensor>, name: &'static str, mc: i64) {
    if let Some(sensor) = sensors.iter_mut().find(|sensor| sensor.name == name) {
        sensor.mc = sensor.mc.max(mc);
    } else {
        sensors.push(Sensor { name, mc });
    }
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

fn cmd_temps(all: bool) {
    let sensors = thermal_sensors();
    if all {
        for s in sensors {
            println!("{}={}", s.name, s.mc / 1000);
        }
        return;
    }
    if let Some(s) = sensors.into_iter().max_by_key(|s| s.mc) {
        println!("{}", s.mc);
    } else {
        println!("0");
    }
}

fn cmd_legacy_temp(option: &str) {
    if option == "-a" {
        cmd_temps(true);
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

fn daemon_running() -> bool {
    let Some(pid) = read_trim(PID_FILE).and_then(|s| s.parse::<u32>().ok()) else {
        return false;
    };
    read_trim(format!("/proc/{pid}/cmdline"))
        .map(|cmdline| cmdline.contains("airpi-fanctl") && cmdline.contains("daemon"))
        .unwrap_or(false)
}

fn run_daemon() -> Result<()> {
    if daemon_running() {
        return Err("airpi-fancontrol already running".into());
    }
    write_value(PID_FILE, std::process::id())?;
    let _cleanup = PidCleanup;
    let driver = configured_driver()?;
    ensure_driver(driver)?;
    loop {
        if let Some(mode) = read_trim(FANVAL_FILE).and_then(|s| s.parse::<u32>().ok()) {
            if mode <= 3 {
                write_pwm([64, 128, 192, 255][mode as usize])?;
                return Ok(());
            }
        }
        let temp = thermal_sensors()
            .into_iter()
            .map(|s| s.mc)
            .max()
            .unwrap_or(0);
        let duty = if temp > 85_000 {
            255
        } else if temp > 60_000 {
            192
        } else if temp > 50_000 {
            128
        } else {
            64
        };
        write_pwm(duty)?;
        thread::sleep(Duration::from_secs(8));
    }
}

struct PidCleanup;
impl Drop for PidCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_file(PID_FILE);
    }
}

fn cmd_status() {
    let speed = read_trim(SPEED_FILE).unwrap_or_else(|| "0".into());
    let value = read_trim(FANVAL_FILE).unwrap_or_else(|| "na".into());
    let mode = match value.as_str() {
        "999" => "无极",
        "9" if daemon_running() => "智能",
        _ if daemon_running() => "智能",
        _ => "手动",
    };
    println!(
        "fanspd={speed}\nfanval={value}\nmode={mode}\ndriver={}\ndaemon={}",
        if selected_driver() == Driver::Pwm {
            "pwm"
        } else {
            "softpwm"
        },
        daemon_running() as u8
    );
}

fn stop_service() -> Result<()> {
    run_status("/etc/init.d/airpi-fancontrol", &["stop"])
        .then_some(())
        .ok_or("failed to stop service".into())
}
fn restart_service() -> Result<()> {
    run_status("/etc/init.d/airpi-fancontrol", &["restart"])
        .then_some(())
        .ok_or("failed to restart service".into())
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
    println!(
        "softpwm_loaded={}\nduty={}\ndriver={}",
        module_loaded() as u8,
        read_trim(DUTY_PATH).unwrap_or_else(|| "na".into()),
        if selected_driver() == Driver::Pwm {
            "pwm"
        } else {
            "softpwm"
        }
    );
}

fn dispatch(args: &[String]) -> Result<()> {
    let command = args.get(1).map(String::as_str).unwrap_or("");
    match command {
        "daemon" => run_daemon(),
        "status" => { cmd_status(); Ok(()) }, "temp" => { cmd_temp(); Ok(()) },
        "temps" => { cmd_temps(true); Ok(()) }, "legacy-temp" => { cmd_legacy_temp(args.get(2).map(String::as_str).unwrap_or("")); Ok(()) }, "set" => { let speed = parse_range(args.get(2).map(String::as_str).unwrap_or(""), 0, 255, "speed")?; let code = parse_range(args.get(3).map(String::as_str).unwrap_or(""), 0, 3, "mode")?; stop_service()?; write_value(FANVAL_FILE, code)?; write_pwm(speed)?; println!("result=ok"); Ok(()) },
        "auto" => { write_value(FANVAL_FILE, 9)?; restart_service()?; println!("result=ok"); Ok(()) }, "stepless" => { let speed = parse_range(args.get(2).map(String::as_str).unwrap_or(""), 0, 255, "speed")?; stop_service()?; write_value(FANVAL_FILE, 999)?; write_pwm(speed)?; println!("result=ok\nspeed={speed}"); Ok(()) },
        "hwdetect" => { cmd_hwdetect(); Ok(()) }, "reload" => { restart_service()?; println!("result=ok"); Ok(()) },
        _ => Err("usage: airpi-fanctl {daemon|status|temp|temps|legacy-temp <-a|-c|-s>|set <speed> <mode>|auto|stepless <speed>|hwdetect|reload}".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    if let Err(error) = dispatch(&args) {
        eprintln!("airpi-fanctl: {error}");
        std::process::exit(1);
    }
    Ok(())
}
