//! airpi-fanctl - AirPi AP3000M 风扇控制守护进程与命令行工具
//!
//! 模块划分（后端解耦）：
//!   main.rs    入口与命令分发（CLI 层）
//!   config.rs  UCI 配置读取与参数校验（配置层）
//!   driver.rs  驱动检测 / 加载 / 卸载（硬件层）
//!   sensor.rs  多源温度采集（传感器层）
//!   pwm.rs     PWM 写入与硬件路径探测（控制层）
//!   daemon.rs  守护循环 / 进程与服务生命周期（服务层）
//!   cli.rs     各子命令实现（命令层）

mod cli;
mod config;
mod daemon;
mod driver;
mod pwm;
mod sensor;

use std::env;
use std::io;

use cli::dispatch;

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    if let Err(error) = dispatch(&args) {
        eprintln!("airpi-fanctl: {error}");
        std::process::exit(1);
    }
    Ok(())
}
