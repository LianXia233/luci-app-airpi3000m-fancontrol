//! 控制层：PWM 写入与硬件 PWM 路径探测。
//!
//! 兼容接口：
//!   - 软件 PWM：/sys/kernel/duty_cycle（airpi-gpio-fan 内核模块导出）
//!   - 硬件 PWM：hwmon pwm-fan 的 pwm1，或 MT7981 pwmchip 的 duty_cycle
//!   - 档位速记：/usr/bin/fanspeed.conf（与旧版保持一致）

use std::fs;
use std::path::{Path, PathBuf};

use crate::config::{configured_driver, uci_get};
use crate::driver::Driver;

/// 软件 PWM 占空比接口（airpi-gpio-fan 内核模块导出）。
pub const DUTY_PATH: &str = "/sys/kernel/duty_cycle";
/// 档位速记文件（旧版遗留接口，保持兼容）。
pub const SPEED_FILE: &str = "/usr/bin/fanspeed.conf";

/// 读取文件内容并去除首尾空白。
pub fn read_trim(path: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

/// 读取数值文件。
pub fn read_number(path: impl AsRef<Path>) -> Option<i64> {
    read_trim(path)?.parse().ok()
}

/// 向文件写入值。
pub fn write_value(path: impl AsRef<Path>, value: impl ToString) -> Result<(), String> {
    fs::write(path.as_ref(), value.to_string())
        .map_err(|e| format!("{}: {}", path.as_ref().display(), e))
}

/// 探测所有可用的硬件 PWM 写入路径。
///
/// 顺序与旧版保持一致：
///   1. /sys/class/hwmon 下 name 为 pwmfan / pwm-fan 的 pwm1
///   2. /sys/class/pwm 下所有 pwmchipN 的 duty_cycle（AP3000M 专用 0..255 接口）
pub fn pwm_paths() -> Vec<PathBuf> {
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

/// 返回第一个可写的硬件 PWM 路径（用于写入时的实际落点）。
pub fn pwm_path() -> Option<PathBuf> {
    pwm_paths()
        .into_iter()
        .find(|p| fs::OpenOptions::new().write(true).open(p).is_ok())
}

/// 向当前生效的驱动写入占空比，并同步档位速记文件。
///
/// 失败时给出驱动相关错误信息，供 daemon 做退避重试。
pub fn write_pwm(value: u32) -> Result<(), String> {
    let driver = configured_driver()?;
    let path = match driver {
        Driver::Pwm => pwm_path().ok_or_else(|| "hardware PWM path not found".to_string())?,
        Driver::SoftPwm => PathBuf::from(DUTY_PATH),
    };
    write_value(&path, value)?;
    write_value(SPEED_FILE, value)
}

/// 读取 UCI 中的软 PWM GPIO 与频率参数（供驱动加载使用）。
pub fn softpwm_params() -> Result<(u32, u32), String> {
    let gpio = crate::config::parse_range(&uci_get("fan_gpio", "540"), 0, 1023, "fan_gpio")?;
    let freq =
        crate::config::parse_range(&uci_get("fan_freq", "15000"), 100, 1_000_000, "fan_freq")?;
    Ok((gpio, freq))
}
