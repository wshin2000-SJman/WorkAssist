use crate::storage::Storage;
use crate::modules::kanban::KanbanModule;
use crate::modules::minutes::MinutesModule;
use crate::modules::pm::PmModule;
use crate::modules::auth::AuthModule;
use std::sync::Arc;

#[derive(Clone)]
pub struct Api {
    pub storage: Arc<Storage>,
}

impl Api {
    pub fn new(storage: Arc<Storage>) -> Self {
        Self { storage }
    }

    pub fn auth(&self) -> AuthModule {
        AuthModule::new(self.storage.clone())
    }

    pub fn kanban(&self) -> KanbanModule {
        KanbanModule::new(self.storage.clone())
    }

    pub fn minutes(&self) -> MinutesModule {
        MinutesModule::new(self.storage.clone())
    }

    pub fn pm(&self) -> PmModule {
        PmModule::new(self.storage.clone())
    }

    pub fn backup(&self) -> std::io::Result<()> {
        self.storage.perform_backup()
    }

    pub fn manual_backup(&self, path: String) -> std::io::Result<()> {
        self.storage.manual_backup(std::path::PathBuf::from(path))
    }

    pub fn import_db(&self, path: String) -> std::io::Result<()> {
        self.storage.import_database(std::path::PathBuf::from(path))
    }

    pub fn get_backup_path(&self) -> String {
        self.storage.get_backup_dir().to_string_lossy().to_string()
    }

    pub fn initialize_data(&self, user_id: i64) -> Result<(), String> {
        self.storage.initialize_user_data(user_id).map_err(|e| e.to_string())
    }
}
