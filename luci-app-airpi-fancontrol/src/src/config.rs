//! 配置层：UCI 读取与参数范围校验。
//!
//! 兼容接口：/etc/config/airpi-fan 的 `fan` 类型 `settings` 段，
//! 现有 option 保持原样：fan_driver / fan_gpio / fan_freq。

use std::process::Command;

use crate::driver::{selected_driver, Driver};

/// 读取 UCI 配置项，取不到或为空时回退到默认值。
pub fn uci_get(option: &str, default: &str) -> String {
    Command::new("uci")
        .args(["-q", "get", &format!("airpi-fan.settings.{option}")])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_string())
}

/// 解析用户配置的驱动类型：auto 时按 eMMC 容量 / 硬件路径自动选择。
pub fn configured_driver() -> Result<Driver, String> {
    match uci_get("fan_driver", "auto").as_str() {
        "auto" => Ok(selected_driver()),
        "pwm" => Ok(Driver::Pwm),
        "softpwm" => Ok(Driver::SoftPwm),
        value => Err(format!("invalid fan_driver: {value}")),
    }
}

/// 解析闭区间 [min, max] 内的整数，失败或越界时给出带名称的错误信息。
pub fn parse_range(value: &str, min: u32, max: u32, name: &str) -> Result<u32, String> {
    let n = value
        .parse::<u32>()
        .map_err(|_| format!("invalid {name}"))?;
    (min..=max)
        .contains(&n)
        .then_some(n)
        .ok_or_else(|| format!("{name} out of range"))
}
