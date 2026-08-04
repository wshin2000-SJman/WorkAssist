mod api;
mod dispatcher;
mod models;
mod modules;
mod storage;

use api::Api;
use axum::{
    extract::State,
    routing::post,
    Json, Router,
};
use dispatcher::{dispatch_command, InvokePayload, InvokeResponse};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    println!("Starting WorkAssist v4 (Local Web Server Engine)...");

    // 1. Determine App Data Directory & Database Path
    let app_data_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sjworkassist_v2");

    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");
    }

    let db_path = app_data_dir.join("sjworkassist_v2.db");
    println!("Database Location: {:?}", db_path);

    // 2. Initialize Core Storage & API
    let storage = Arc::new(storage::Storage::new(db_path).expect("Failed to initialize storage"));
    let api = Api::new(storage);

    // 3. Build Axum Router
    let app = Router::new()
        .route("/api/invoke", post(handle_invoke))
        .nest_service("/", ServeDir::new("ui"))
        .layer(CorsLayer::permissive())
        .with_state(api);

    // 4. Bind to local socket
    let addr = SocketAddr::from(([127, 0, 0, 1], 18800));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(_) => {
            // Fallback to random port if 18800 is occupied
            let fallback_addr = SocketAddr::from(([127, 0, 0, 1], 0));
            tokio::net::TcpListener::bind(fallback_addr).await.expect("Failed to bind to any port")
        }
    };

    let actual_addr = listener.local_addr().expect("Failed to get local addr");
    let url = format!("http://{}", actual_addr);
    println!("--------------------------------------------------");
    println!("🚀 WorkAssist v4 Server is running at: {}", url);
    println!("--------------------------------------------------");

    // 5. Automatically open default web browser
    let url_clone = url.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        println!("Opening browser: {}", url_clone);
        if let Err(e) = open::that(&url_clone) {
            println!("Could not open browser automatically: {}", e);
        }
    });

    // 6. Run Axum Server
    axum::serve(listener, app).await.expect("Axum server error");
}

async fn handle_invoke(
    State(api): State<Api>,
    Json(payload): Json<InvokePayload>,
) -> Json<InvokeResponse> {
    let response = dispatch_command(&api, payload);
    Json(response)
}
