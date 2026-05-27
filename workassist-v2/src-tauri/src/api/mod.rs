use crate::storage::Storage;
#[cfg(feature = "kanban")]
use crate::modules::kanban::KanbanModule;
#[cfg(feature = "minutes")]
use crate::modules::minutes::MinutesModule;
#[cfg(feature = "pm")]
use crate::modules::pm::PmModule;
#[cfg(feature = "orders")]
use crate::modules::orders::OrdersModule;
use crate::modules::auth::AuthModule;
use crate::modules::gateway::GatewayModule;
use crate::modules::motor::MotorModule;
use std::sync::Arc;

#[derive(Clone)]
pub struct Api {
    pub storage: Arc<Storage>,
}

impl Api {
    pub fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub fn gateway(&self) -> GatewayModule {
        GatewayModule::new(self.storage.clone())
    }

    pub fn auth(&self) -> AuthModule {
        AuthModule::new(self.storage.clone())
    }

    pub fn motor(&self) -> MotorModule {
        MotorModule::new(self.storage.clone())
    }

    #[cfg(feature = "kanban")]
    pub fn kanban(&self) -> KanbanModule {
        KanbanModule::new(self.storage.clone())
    }

    #[cfg(feature = "minutes")]
    pub fn minutes(&self) -> MinutesModule {
        MinutesModule::new(self.storage.clone())
    }

    #[cfg(feature = "pm")]
    pub fn pm(&self) -> PmModule {
        PmModule::new(self.storage.clone())
    }

    #[cfg(feature = "orders")]
    pub fn orders(&self) -> OrdersModule {
        OrdersModule::new(self.storage.clone())
    }

    pub fn backup(&self) -> Result<(), String> {
        self.storage.perform_backup()
    }

    pub fn manual_backup(&self, path: String) -> Result<(), String> {
        self.storage.manual_backup(std::path::PathBuf::from(path))
    }

    pub fn import_db(&self, path: String, user: Option<crate::models::User>) -> Result<(), String> {
        self.storage.import_database(std::path::PathBuf::from(path), user)
    }

    pub fn get_backup_path(&self) -> String {
        self.storage.get_backup_dir().to_string_lossy().to_string()
    }

    pub fn initialize_data(&self, user_id: i64) -> Result<(), String> {
        self.storage.initialize_user_data(user_id).map_err(|e| e.to_string())
    }
}
