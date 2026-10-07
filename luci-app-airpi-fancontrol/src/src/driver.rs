//! 硬件层：风扇驱动选择、eMMC 容量检测、内核模块加载。
//!
//! 兼容行为：
//!   - fan_driver=auto 时按 eMMC 容量自动选择（>25M 扇区 → 软件 PWM，否则硬件 PWM）
//!   - eMMC 容量不可读时回退到硬件 PWM 路径探测
//!   - 软件 PWM 由 airpi-gpio-fan 内核模块提供（insmod / modprobe 双通道）

use std::fs;
use std::process::{Command, Stdio};

use crate::config::uci_get;
use crate::pwm::{pwm_path, read_trim, softpwm_params};

/// eMMC 容量阈值（扇区）：超过即视为大容量设备，软 PWM 更可靠。
const EMMC_THRESHOLD: u64 = 25_000_000;

/// 可用驱动类型。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Driver {
    /// 硬件 PWM（hwmon pwm-fan 或 MT7981 pwmchip）。
    Pwm,
    /// 软件 PWM（airpi-gpio-fan 内核模块位操作）。
    SoftPwm,
}

/// 读取 eMMC 扇区数。
fn emmc_sectors() -> Option<u64> {
    read_trim("/sys/block/mmcblk0/size")?
        .parse()
        .ok()
        .filter(|n: &u64| *n > 0)
}

/// 按 UCI 配置与硬件状态选择实际驱动。
pub fn selected_driver() -> Driver {
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

/// airpi-gpio-fan 内核模块是否已加载。
pub fn module_loaded() -> bool {
    read_trim("/proc/modules")
        .map(|s| {
            s.lines()
                .any(|l| l.split_whitespace().next() == Some("airpi_gpio_fan"))
        })
        .unwrap_or(false)
}

/// 以无输出方式执行命令并返回是否成功。
fn run_status(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 确保目标驱动可用：硬件 PWM 时卸载软 PWM 模块，软 PWM 时加载之。
pub fn ensure_driver(driver: Driver) -> Result<(), String> {
    match driver {
        Driver::Pwm => {
            // 硬件 PWM 模式：卸载软 PWM 模块，避免两条控制链同时驱动 GPIO。
            let _ = run_status("rmmod", &["airpi_gpio_fan"]);
            Ok(())
        }
        Driver::SoftPwm if module_loaded() => Ok(()),
        Driver::SoftPwm => {
            let (gpio, freq) = softpwm_params()?;
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

/// eMMC 容量状态，供 hwdetect 输出使用。
pub fn emmc_info() -> Option<(u64, u64)> {
    emmc_sectors().map(|sectors| {
        let gb = (sectors * 512 + 500_000_000) / 1_000_000_000;
        (sectors, gb)
    })
}

/// 是否因 eMMC 容量过大而强制禁用硬件 PWM（供 hwdetect 判断）。
pub fn emmc_blocks_hw() -> bool {
    emmc_sectors().is_some_and(|sectors| sectors > EMMC_THRESHOLD)
}

/// 第一个 PWM 芯片名称（供 hwdetect 展示）。
pub fn first_pwm_chip() -> Option<String> {
    fs::read_dir("/sys/class/pwm")
        .ok()
        .and_then(|mut e| e.next())
        .and_then(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
}
