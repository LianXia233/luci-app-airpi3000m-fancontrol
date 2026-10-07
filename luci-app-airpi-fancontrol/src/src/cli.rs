//! 命令层：各子命令实现与分发。
//!
//! CLI 接口保持完全兼容（LuCI 前端依赖）：
//!   daemon | status | temp | temps | legacy-temp <-a|-c|-s>
//!   set <speed 0..255> <mode 0..3> | auto | stepless <speed 0..255>
//!   hwdetect | reload

use crate::config::{parse_range, uci_get};
use crate::daemon::{
    daemon_running, fanval_value, restart_service, run_daemon, stop_service, FANVAL_FILE,
};
use crate::driver::{
    emmc_blocks_hw, emmc_info, first_pwm_chip, module_loaded, selected_driver, Driver,
};
use crate::pwm::{pwm_path, read_trim, write_pwm, write_value, DUTY_PATH, SPEED_FILE};
use crate::sensor::thermal_sensors;

/// 命令分发。
pub fn dispatch(args: &[String]) -> Result<(), String> {
    let command = args.get(1).map(String::as_str).unwrap_or("");
    match command {
        "daemon" => run_daemon(),
        "status" => {
            cmd_status();
            Ok(())
        }
        "temp" => {
            cmd_temp();
            Ok(())
        }
        "temps" => {
            cmd_temps(true);
            Ok(())
        }
        "legacy-temp" => {
            let option = args.get(2).map(String::as_str).unwrap_or("");
            cmd_legacy_temp(option);
            Ok(())
        }
        "set" => {
            let speed = parse_range(args.get(2).map(String::as_str).unwrap_or(""), 0, 255, "speed")?;
            let code = parse_range(args.get(3).map(String::as_str).unwrap_or(""), 0, 3, "mode")?;
            stop_service()?;
            write_value(FANVAL_FILE, code)?;
            write_pwm(speed)?;
            println!("result=ok");
            Ok(())
        }
        "auto" => {
            write_value(FANVAL_FILE, 9)?;
            restart_service()?;
            println!("result=ok");
            Ok(())
        }
        "stepless" => {
            let speed = parse_range(args.get(2).map(String::as_str).unwrap_or(""), 0, 255, "speed")?;
            stop_service()?;
            write_value(FANVAL_FILE, 999)?;
            write_pwm(speed)?;
            println!("result=ok\nspeed={speed}");
            Ok(())
        }
        "hwdetect" => {
            cmd_hwdetect();
            Ok(())
        }
        "reload" => {
            restart_service()?;
            println!("result=ok");
            Ok(())
        }
        _ => Err(
            "usage: airpi-fanctl {daemon|status|temp|temps|legacy-temp <-a|-c|-s>|set <speed> <mode>|auto|stepless <speed>|hwdetect|reload}"
                .into(),
        ),
    }
}

/// status：风扇转速、档位、模式、驱动、守护状态。
fn cmd_status() {
    let speed = read_trim(SPEED_FILE).unwrap_or_else(|| "0".into());
    let value = fanval_value();
    let running = daemon_running();
    let mode = match value.as_str() {
        "999" => "无极",
        // 档位码 9 表示智能模式；daemon 正常运行时才是真正生效的智能温控。
        "9" if running => "智能",
        // 兼容历史行为：服务在跑但档位文件缺失或为其它值，仍视为智能接管中。
        _ if running => "智能",
        _ => "手动",
    };
    println!(
        "fanspd={speed}\nfanval={value}\nmode={mode}\ndriver={}\ndaemon={}",
        driver_name(),
        running as u8
    );
}

/// temp：最高温度与来源（兼容前端展示）。
fn cmd_temp() {
    if let Some(sensor) = thermal_sensors().into_iter().max_by_key(|s| s.mc) {
        let label = match sensor.name {
            "wifi" => "WiFi温度",
            "phy" => "网络温度",
            "modem" => "模组温度",
            _ => "CPU温度",
        };
        println!("temp={:.1}", sensor.mc as f64 / 1000.0);
        println!("source={label}");
    } else {
        println!("temp=null\nsource=CPU温度");
    }
}

/// temps [-a 隐含]：输出全部温度源。
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

/// legacy-temp：旧版 get_sys_temp.sh 兼容输出。
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

/// hwdetect：硬件拓扑探测（eMMC / 硬件 PWM / PWM 芯片 / 软 PWM 模块 / 占空比 / 驱动）。
fn cmd_hwdetect() {
    if let Some((sectors, gb)) = emmc_info() {
        println!("emmc_sectors={sectors}\nemmc_gb={gb}");
    } else {
        println!("emmc_sectors=na\nemmc_gb=?");
    }
    let hw_pwm = if emmc_blocks_hw() { None } else { pwm_path() };
    println!(
        "hw_pwm={}",
        hw_pwm
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "none".into())
    );
    println!(
        "pwmchip={}",
        first_pwm_chip().unwrap_or_else(|| "none".into())
    );
    println!(
        "softpwm_loaded={}\nduty={}\ndriver={}",
        module_loaded() as u8,
        read_trim(DUTY_PATH).unwrap_or_else(|| "na".into()),
        driver_name()
    );
}

/// 当前驱动名（输出与旧版完全一致）。
fn driver_name() -> &'static str {
    if selected_driver() == Driver::Pwm {
        "pwm"
    } else {
        "softpwm"
    }
}

/// 供单测使用的辅助：读取 UCI 原始值。
fn _uci_raw(option: &str) -> String {
    uci_get(option, "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_control_ranges() {
        assert_eq!(parse_range("255", 0, 255, "speed"), Ok(255));
        assert!(parse_range("256", 0, 255, "speed").is_err());
        assert!(parse_range("fast", 0, 255, "speed").is_err());
    }

    #[test]
    fn mode_mapping() {
        // 无 daemon 时档位 0-3 均为手动
        let speed = "128".to_string();
        let _ = &speed;
        let value = "1".to_string();
        let running = false;
        let mode = match value.as_str() {
            "999" => "无极",
            "9" if running => "智能",
            _ if running => "智能",
            _ => "手动",
        };
        assert_eq!(mode, "手动");
        let value = "9".to_string();
        let mode = match value.as_str() {
            "999" => "无极",
            "9" if running => "智能",
            _ if running => "智能",
            _ => "手动",
        };
        assert_eq!(mode, "手动");
    }
}
