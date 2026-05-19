use std::sync::Arc;
use crate::storage::Storage;

pub mod auth;
pub mod gateway;
#[cfg(feature = "kanban")]
pub mod kanban;
#[cfg(feature = "minutes")]
pub mod minutes;
#[cfg(feature = "pm")]
pub mod pm;
#[cfg(feature = "rag")]
pub mod rag;
