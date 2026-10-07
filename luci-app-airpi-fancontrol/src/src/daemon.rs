//! 服务层：守护循环、PID 管理、procd 服务生命周期。
//!
//! 兼容行为：
//!   - /var/run/airpi-fancontrol.pid 记录守护进程 PID（daemon_running 判断依据）
//!   - /etc/fanvall 档位码：0-3 手动档、9 智能、999 无极
//!   - daemon 在手动档/无极档时写一次 PWM 即退出（由 set/stepless 先停 procd 服务）
//!   - 智能模式常驻循环，温度曲线：>85 → 255 / >60 → 192 / >50 → 128 / 其余 64

use std::fs;
use std::process::Command;
use std::thread;
use std::time::Duration;

use crate::config::configured_driver;
use crate::driver::ensure_driver;
use crate::pwm::{read_trim, write_pwm, write_value};
use crate::sensor::max_temperature_mc;

/// 档位码文件（兼容旧版）。
pub const FANVAL_FILE: &str = "/etc/fanvall";
/// 守护进程 PID 文件。
pub const PID_FILE: &str = "/var/run/airpi-fancontrol.pid";

/// 智能温控采样间隔。
const POLL_INTERVAL: Duration = Duration::from_secs(8);
/// 写入失败后的退避间隔，避免异常时高频重试刷屏。
const ERROR_BACKOFF: Duration = Duration::from_secs(30);
/// 连续失败达到该次数后打印一次汇总告警（防止日志风暴）。
const ERROR_LOG_EVERY: u32 = 10;

/// 温控曲线：输入毫摄氏度，输出占空比。
fn temperature_curve(mc: i64) -> u32 {
    if mc > 85_000 {
        255
    } else if mc > 60_000 {
        192
    } else if mc > 50_000 {
        128
    } else {
        64
    }
}

/// 守护进程是否在运行（基于 PID 文件 + cmdline 双重校验）。
pub fn daemon_running() -> bool {
    let Some(pid) = read_trim(PID_FILE).and_then(|s| s.parse::<u32>().ok()) else {
        return false;
    };
    read_trim(format!("/proc/{pid}/cmdline"))
        .map(|cmdline| cmdline.contains("airpi-fanctl") && cmdline.contains("daemon"))
        .unwrap_or(false)
}

/// 启动守护循环。
///
/// 异常恢复策略：PWM 写入失败时不直接退出（避免 procd respawn 风暴），
/// 记录错误并退避后继续；连续失败时降频打印。
pub fn run_daemon() -> Result<(), String> {
    if daemon_running() {
        return Err("airpi-fancontrol already running".into());
    }
    write_value(PID_FILE, std::process::id())?;
    let _cleanup = PidCleanup;

    let driver = configured_driver()?;
    ensure_driver(driver)?;

    // 手动档（0-3）或无极档（999）：写一次 PWM 后退出，
    // 正常流程中 set/stepless 已先停止 procd 服务，不会触发 respawn。
    if let Some(mode) = read_trim(FANVAL_FILE).and_then(|s| s.parse::<u32>().ok()) {
        if mode <= 3 {
            write_pwm([64, 128, 192, 255][mode as usize])?;
            return Ok(());
        }
        if mode == 999 {
            return Ok(());
        }
    }

    let mut errors: u32 = 0;
    loop {
        match write_pwm(temperature_curve(max_temperature_mc())) {
            Ok(()) => errors = 0,
            Err(error) => {
                errors += 1;
                if errors % ERROR_LOG_EVERY == 1 {
                    eprintln!("airpi-fanctl: daemon write failed: {error}");
                }
                thread::sleep(ERROR_BACKOFF);
                continue;
            }
        }
        thread::sleep(POLL_INTERVAL);
    }
}

/// 退出时清理 PID 文件。
struct PidCleanup;
impl Drop for PidCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_file(PID_FILE);
    }
}

/// 以无输出方式执行命令并返回是否成功。
fn run_status(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 停止 procd 托管服务。
pub fn stop_service() -> Result<(), String> {
    run_status("/etc/init.d/airpi-fancontrol", &["stop"])
        .then_some(())
        .ok_or_else(|| "failed to stop service".to_string())
}

/// 重启 procd 托管服务。
pub fn restart_service() -> Result<(), String> {
    run_status("/etc/init.d/airpi-fancontrol", &["restart"])
        .then_some(())
        .ok_or_else(|| "failed to restart service".to_string())
}

/// 读取档位码（无文件时为 "na"）。
pub fn fanval_value() -> String {
    read_trim(FANVAL_FILE).unwrap_or_else(|| "na".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temperature_curve_boundaries() {
        assert_eq!(temperature_curve(85_001), 255);
        assert_eq!(temperature_curve(85_000), 192);
        assert_eq!(temperature_curve(60_001), 192);
        assert_eq!(temperature_curve(60_000), 128);
        assert_eq!(temperature_curve(50_001), 128);
        assert_eq!(temperature_curve(50_000), 64);
        assert_eq!(temperature_curve(0), 64);
    }
}
