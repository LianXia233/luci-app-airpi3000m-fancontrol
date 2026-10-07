//! 传感器层：CPU / WiFi / PHY / 模组四路温度采集，多源取最大值。
//!
//! 兼容行为：
//!   - 有效温度区间 1-150 °C（内部以毫摄氏度计 1000..=150000）
//!   - 同名来源（多个 thermal zone / 多个 hwmon）取最高值
//!   - WiFi 仅取 ra0 / rax0 / rai0 中首个存在的接口
//!   - 模组温度通过 ubus modem_ctrl info 提取

use std::fs;
use std::path::Path;
use std::process::Command;

use crate::pwm::{read_number, read_trim};

/// 有效毫摄氏度区间（1-150 °C）。
const MC_MIN: i64 = 1_000;
const MC_MAX: i64 = 150_000;

/// 温度传感器读数。
#[derive(Clone, Debug)]
pub struct Sensor {
    pub name: &'static str,
    pub mc: i64,
}

/// 温度是否有效。
fn valid_mc(value: i64) -> bool {
    (MC_MIN..=MC_MAX).contains(&value)
}

/// 收集全部可用温度源（每轮动态扫描，保证热插拔与模块加载后可见）。
pub fn thermal_sensors() -> Vec<Sensor> {
    let mut out = Vec::new();

    // CPU：全部 thermal_zone（type 任意，读数有效即可）
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

    // PHY / 网络芯片：hwmon 设备，排除风扇自身
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

    // WiFi：iwpriv stat 中的 CurrentTemperature 字段
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

    // 模组：ubus modem_ctrl info
    if let Some(v) = command_output("ubus", &["call", "modem_ctrl", "info"])
        .and_then(|text| parse_modem_temperature(&text))
    {
        add_sensor(&mut out, "modem", v);
    }

    out
}

/// 合并同名传感器，保留最大值。
fn add_sensor(sensors: &mut Vec<Sensor>, name: &'static str, mc: i64) {
    if let Some(sensor) = sensors.iter_mut().find(|sensor| sensor.name == name) {
        sensor.mc = sensor.mc.max(mc);
    } else {
        sensors.push(Sensor { name, mc });
    }
}

/// 执行外部命令并返回 stdout（仅成功时）。
fn command_output(program: &str, args: &[&str]) -> Option<String> {
    Command::new(program)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
}

/// 从 ubus modem_ctrl info 输出中解析模组温度（兼容多种 JSON 形态）。
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

/// 取全部温度源中的最高温（毫摄氏度），无有效源时为 0。
pub fn max_temperature_mc() -> i64 {
    thermal_sensors()
        .into_iter()
        .map(|s| s.mc)
        .max()
        .unwrap_or(0)
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
    fn rejects_invalid_temperature() {
        assert_eq!(parse_modem_temperature(r#"{"temperature":-999}"#), None);
        assert_eq!(parse_modem_temperature(r#"{"temperature":999999}"#), None);
    }
}
