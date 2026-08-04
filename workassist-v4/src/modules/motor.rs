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

    pub fn calculate_torque(&self, inertia: f64, acceleration: f64) -> Result<TorqueResult, String> {
        let torque_nm = inertia * acceleration;
        let torque_ncm = torque_nm * 100.0;
        let torque_kgfcm = torque_nm * 10.197162;
        
        Ok(TorqueResult {
            torque_nm,
            torque_ncm,
            torque_kgfcm,
        })
    }

    pub fn calculate_inertia(&self, shape_type: &str, mass: f64, radius: f64, length: f64) -> Result<f64, String> {
        match shape_type {
            "point_mass" | "ring" => Ok(mass * radius * radius),
            "disc" => Ok(0.5 * mass * radius * radius),
            "cylinder_center" => Ok(0.25 * mass * radius * radius + (1.0 / 12.0) * mass * length * length),
            "cylinder_end" => Ok(0.25 * mass * radius * radius + (1.0 / 3.0) * mass * length * length),
            _ => Err("지원하지 않는 형상 타입입니다.".to_string()),
        }
    }

    pub fn convert_speed(&self, value: f64, from_unit: &str, to_unit: &str) -> Result<f64, String> {
        let rad_s = match from_unit {
            "rpm" => value * 2.0 * PI / 60.0,
            "degs" => value * PI / 180.0,
            "rads" => value,
            _ => return Err("알 수 없는 원본 단위입니다.".to_string()),
        };
        
        let converted = match to_unit {
            "rpm" => rad_s * 60.0 / (2.0 * PI),
            "degs" => rad_s * 180.0 / PI,
            "rads" => rad_s,
            _ => return Err("알 수 없는 대상 단위입니다.".to_string()),
        };
        
        Ok(converted)
    }

    pub fn calculate_angular_acceleration(&self, initial_speed: f64, final_speed: f64, time: f64, unit: &str) -> Result<f64, String> {
        if time <= 0.0 {
            return Err("시간은 0보다 커야 합니다.".to_string());
        }
        
        let w0 = match unit {
            "rpm" => initial_speed * 2.0 * PI / 60.0,
            "degs" => initial_speed * PI / 180.0,
            "rads" => initial_speed,
            _ => return Err("알 수 없는 단위입니다.".to_string()),
        };
        
        let wt = match unit {
            "rpm" => final_speed * 2.0 * PI / 60.0,
            "degs" => final_speed * PI / 180.0,
            "rads" => final_speed,
            _ => return Err("알 수 없는 단위입니다.".to_string()),
        };
        
        Ok((wt - w0) / time)
    }

    pub fn calculate_combined_torque(&self, mass: f64, arm_length: f64, angle_deg: f64, acceleration: f64) -> Result<CombinedTorqueResult, String> {
        let g = 9.8;
        let inertia = mass * arm_length * arm_length;
        let torque_acceleration = inertia * acceleration;
        
        let angle_rad = angle_deg * PI / 180.0;
        let torque_gravity = mass * g * arm_length * angle_rad.cos();
        
        let torque_total = torque_acceleration + torque_gravity;
        
        Ok(CombinedTorqueResult {
            torque_acceleration,
            torque_gravity,
            torque_total,
        })
    }

    pub fn calculate_motor_specs(&self, voltage_in: f64, kb_v_krpm: f64, torque_required: f64) -> Result<MotorSpecsResult, String> {
        if kb_v_krpm <= 0.0 {
            return Err("역기전력 상수는 0보다 커야 합니다.".to_string());
        }
        
        let kt_nm_a = (kb_v_krpm / 1000.0) * 9.55;
        let max_speed_rpm = (voltage_in / kb_v_krpm) * 1000.0;
        let safe_speed_rpm = max_speed_rpm * 0.7;
        
        let required_current_a = if kt_nm_a > 0.0 {
            torque_required / kt_nm_a
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

    pub fn calculate_rms_cycle(&self, stages: Vec<CycleStage>) -> Result<RmsResult, String> {
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
        let avg_speed_rad_s = average_speed_rpm * 2.0 * PI / 60.0;
        let continuous_power_w = rms_torque * avg_speed_rad_s;
        
        Ok(RmsResult {
            rms_torque,
            total_time,
            average_speed_rpm,
            continuous_power_w,
        })
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
