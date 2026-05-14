use std::sync::Arc;
use crate::storage::Storage;

pub mod auth;
pub mod kanban;
pub mod minutes;
pub mod pm;

pub struct Api {
    auth: Arc<auth::AuthModule>,
    kanban: Arc<kanban::KanbanModule>,
    minutes: Arc<minutes::MinutesModule>,
    pm: Arc<pm::PmModule>,
}

impl Api {
    pub fn new(storage: Arc<Storage>) -> Self {
        let auth = Arc::new(auth::AuthModule::new(storage.clone()));
        let kanban = Arc::new(kanban::KanbanModule::new(storage.clone()));
        let minutes = Arc::new(minutes::MinutesModule::new(storage.clone()));
        let pm = Arc::new(pm::PmModule::new(storage.clone()));

        Self {
            auth,
            kanban,
            minutes,
            pm,
        }
    }

    pub fn auth(&self) -> &auth::AuthModule {
        &self.auth
    }

    pub fn kanban(&self) -> &kanban::KanbanModule {
        &self.kanban
    }

    pub fn minutes(&self) -> &minutes::MinutesModule {
        &self.minutes
    }

    pub fn pm(&self) -> &pm::PmModule {
        &self.pm
    }
}
