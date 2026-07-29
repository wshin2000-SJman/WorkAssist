use crate::storage::Storage;
use std::sync::Arc;
use serde::{Serialize, Deserialize};
use std::f64::consts::PI;

pub struct MotorModule {
    _storage: Arc<Storage>,
}

impl MotorModule {
    pub fn new(storage: Arc<Storage>) -> Self {
        Self { _storage: storage }
    }
}

// --- Data Models ---

#[derive(Debug, Serialize, Deserialize)]
pub struct TorqueResult {
    pub torque_nm: f64,
    pub torque_ncm: f64,
    pub torque_kgfcm: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CombinedTorqueResult {
    pub torque_acceleration: f64,
    pub torque_gravity: f64,
    pub torque_total: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MotorSpecsResult {
    pub kt_nm_a: f64,
    pub max_speed_rpm: f64,
    pub safe_speed_rpm: f64,
    pub required_current_a: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleStage {
    pub duration: f64,
    pub torque: f64,
    pub speed_rpm: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RmsResult {
    pub rms_torque: f64,
    pub total_time: f64,
    pub average_speed_rpm: f64,
    pub continuous_power_w: f64,
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn calculate_torque(
    _api: tauri::State<'_, crate::api::Api>,
    inertia: f64,
    acceleration: f64,
) -> Result<TorqueResult, String> {
    let torque_nm = inertia * acceleration;
    let torque_ncm = torque_nm * 100.0;
    let torque_kgfcm = torque_nm * 10.197162;
    
    Ok(TorqueResult {
        torque_nm,
        torque_ncm,
        torque_kgfcm,
    })
}

#[tauri::command]
pub async fn calculate_inertia(
    _api: tauri::State<'_, crate::api::Api>,
    shape_type: String,
    mass: f64,
    radius: f64,
    length: f64,
) -> Result<f64, String> {
    match shape_type.as_str() {
        "point_mass" | "ring" => {
            // J = m * r^2
            Ok(mass * radius * radius)
        }
        "disc" => {
            // J = 0.5 * m * r^2
            Ok(0.5 * mass * radius * radius)
        }
        "cylinder_center" => {
            // J = 0.25 * m * r^2 + 1/12 * m * l^2
            Ok(0.25 * mass * radius * radius + (1.0 / 12.0) * mass * length * length)
        }
        "cylinder_end" => {
            // J = 0.25 * m * r^2 + 1/3 * m * l^2
            Ok(0.25 * mass * radius * radius + (1.0 / 3.0) * mass * length * length)
        }
        _ => Err("지원하지 않는 형상 타입입니다.".to_string()),
    }
}

#[tauri::command]
pub async fn convert_speed(
    _api: tauri::State<'_, crate::api::Api>,
    value: f64,
    from_unit: String,
    to_unit: String,
) -> Result<f64, String> {
    // 1. Convert to rad/sec
    let rad_s = match from_unit.as_str() {
        "rpm" => value * 2.0 * PI / 60.0,
        "degs" => value * PI / 180.0,
        "rads" => value,
        _ => return Err("알 수 없는 원본 단위입니다.".to_string()),
    };
    
    // 2. Convert to target unit
    let converted = match to_unit.as_str() {
        "rpm" => rad_s * 60.0 / (2.0 * PI),
        "degs" => rad_s * 180.0 / PI,
        "rads" => rad_s,
        _ => return Err("알 수 없는 대상 단위입니다.".to_string()),
    };
    
    Ok(converted)
}

#[tauri::command]
pub async fn calculate_angular_acceleration(
    _api: tauri::State<'_, crate::api::Api>,
    initial_speed: f64,
    final_speed: f64,
    time: f64,
    unit: String,
) -> Result<f64, String> {
    if time <= 0.0 {
        return Err("시간은 0보다 커야 합니다.".to_string());
    }
    
    // Convert velocities to rad/s
    let w0 = match unit.as_str() {
        "rpm" => initial_speed * 2.0 * PI / 60.0,
        "degs" => initial_speed * PI / 180.0,
        "rads" => initial_speed,
        _ => return Err("알 수 없는 단위입니다.".to_string()),
    };
    
    let wt = match unit.as_str() {
        "rpm" => final_speed * 2.0 * PI / 60.0,
        "degs" => final_speed * PI / 180.0,
        "rads" => final_speed,
        _ => return Err("알 수 없는 단위입니다.".to_string()),
    };
    
    let acceleration = (wt - w0) / time;
    Ok(acceleration)
}

#[tauri::command]
pub async fn calculate_combined_torque(
    _api: tauri::State<'_, crate::api::Api>,
    mass: f64,
    arm_length: f64,
    angle_deg: f64,
    acceleration: f64,
) -> Result<CombinedTorqueResult, String> {
    let g = 9.8;
    // J = m * d^2
    let inertia = mass * arm_length * arm_length;
    let torque_acceleration = inertia * acceleration;
    
    // T_g = m * g * d * cos(theta)
    let angle_rad = angle_deg * PI / 180.0;
    let torque_gravity = mass * g * arm_length * angle_rad.cos();
    
    let torque_total = torque_acceleration + torque_gravity;
    
    Ok(CombinedTorqueResult {
        torque_acceleration,
        torque_gravity,
        torque_total,
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn calculate_motor_specs(
    _api: tauri::State<'_, crate::api::Api>,
    voltageIn: f64,
    kbVKrpm: f64,
    torqueRequired: f64,
) -> Result<MotorSpecsResult, String> {
    if kbVKrpm <= 0.0 {
        return Err("역기전력 상수는 0보다 커야 합니다.".to_string());
    }
    
    // K_t = K_b / 1000 * 9.55 (Using 9.5492965855 for exact physics or 9.55 for PDF compliance)
    // We will use 9.55 as explicitly written in the PDF (0.0132 = 1.38/1000*9.55) to avoid unit match mismatch.
    let kt_nm_a = (kbVKrpm / 1000.0) * 9.55;
    
    // Max Speed = Vin / K_b * 1000
    let max_speed_rpm = (voltageIn / kbVKrpm) * 1000.0;
    let safe_speed_rpm = max_speed_rpm * 0.7;
    
    // Required Current = torqueRequired / K_t
    let required_current_a = if kt_nm_a > 0.0 {
        torqueRequired / kt_nm_a
    } else {
        0.0
    };
    
    Ok(MotorSpecsResult {
        kt_nm_a,
        max_speed_rpm,
        safe_speed_rpm,
        required_current_a,
    })
}

#[tauri::command]
pub async fn calculate_rms_cycle(
    _api: tauri::State<'_, crate::api::Api>,
    stages: Vec<CycleStage>,
) -> Result<RmsResult, String> {
    let mut total_time = 0.0;
    let mut weighted_torque_sq = 0.0;
    let mut weighted_speed = 0.0;
    
    for stage in &stages {
        total_time += stage.duration;
        weighted_torque_sq += stage.duration * stage.torque * stage.torque;
        weighted_speed += stage.duration * stage.speed_rpm.abs();
    }
    
    if total_time <= 0.0 {
        return Err("총 구동 시간이 0보다 커야 합니다.".to_string());
    }
    
    let rms_torque = (weighted_torque_sq / total_time).sqrt();
    let average_speed_rpm = weighted_speed / total_time;
    
    // Convert RPM to rad/sec for power calculations
    let avg_speed_rad_s = average_speed_rpm * 2.0 * PI / 60.0;
    let continuous_power_w = rms_torque * avg_speed_rad_s;
    
    Ok(RmsResult {
        rms_torque,
        total_time,
        average_speed_rpm,
        continuous_power_w,
    })
}

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("motor")
        .invoke_handler(tauri::generate_handler![
            calculate_torque,
            calculate_inertia,
            convert_speed,
            calculate_angular_acceleration,
            calculate_combined_torque,
            calculate_motor_specs,
            calculate_rms_cycle
        ])
        .build()
}
