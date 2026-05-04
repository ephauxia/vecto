#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::net::SocketAddr;

use axum::{
    extract::{Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use tokio::net::TcpListener;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
extern "system" {
    fn AllowSetForegroundWindow(dwProcessId: u32) -> i32;
}

// ── CORS proxy state ──────────────────────────────────────────────────────────

/// Shared application state: the port the axum server is currently bound to,
/// and a shutdown sender. Both are None when the proxy is not running.
struct ProxyState {
    port:     Option<u16>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

type SharedProxyState = Arc<Mutex<ProxyState>>;

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        unsafe { AllowSetForegroundWindow(0xFFFFFFFF); }
        let win_path = path.replace('/', "\\");
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", win_path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let _ = std::process::Command::new("nautilus")
            .arg(&path)
            .spawn()
            .or_else(|_| std::process::Command::new("xdg-open").arg(&parent).spawn());
    }
    Ok(())
}

/// Start the CORS proxy on a random port.
/// Returns the port number so the frontend can construct proxy URLs.
/// No-ops and returns the existing port if the proxy is already running.
#[tauri::command]
async fn cors_proxy_start(
    proxy: tauri::State<'_, SharedProxyState>,
) -> Result<u16, String> {
    // If already running return the existing port immediately.
    {
        let guard = proxy.lock().unwrap();
        if let Some(port) = guard.port {
            return Ok(port);
        }
    }

    // Bind to a random port assigned by the OS.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy: {e}"))?;

    let addr: SocketAddr = listener.local_addr()
        .map_err(|e| format!("Failed to get local addr: {e}"))?;
    let port = addr.port();

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    // Build the axum router. The reqwest Client is shared across requests.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let app = Router::new()
        .route("/proxy", get(proxy_handler))
        .with_state(client);

    // Spawn the server. It shuts down when shutdown_rx fires.
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    // Store state.
    {
        let mut guard = proxy.lock().unwrap();
        guard.port     = Some(port);
        guard.shutdown = Some(shutdown_tx);
    }

    Ok(port)
}

/// Stop the CORS proxy. No-op if it was not running.
#[tauri::command]
async fn cors_proxy_stop(
    proxy: tauri::State<'_, SharedProxyState>,
) -> Result<(), String> {
    let mut guard = proxy.lock().unwrap();
    if let Some(tx) = guard.shutdown.take() {
        let _ = tx.send(());
    }
    guard.port = None;
    Ok(())
}

// ── Proxy handler ─────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct ProxyQuery {
    url: String,
}

/// Forward a GET request to the real URL and return the response with CORS
/// headers injected. The `Range` header from the browser is forwarded so
/// video seeking works correctly.
///
/// Route: GET /proxy?url=<percent-encoded-original-url>
async fn proxy_handler(
    Query(params): Query<ProxyQuery>,
    State(client): State<reqwest::Client>,
    headers: HeaderMap,
) -> Response {
    // Forward Range header if present (required for video seeking).
    let mut req_builder = client.get(&params.url);
    if let Some(range) = headers.get("range") {
        if let Ok(v) = range.to_str() {
            req_builder = req_builder.header("Range", v);
        }
    }

    let upstream = match req_builder.send().await {
        Ok(r)  => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Proxy fetch failed: {e}"),
            ).into_response();
        }
    };

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();

    // Stream the body bytes.
    let body_bytes = match upstream.bytes().await {
        Ok(b)  => b,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("Proxy read failed: {e}"),
            ).into_response();
        }
    };

    // Build response headers: forward relevant upstream headers, then add CORS.
    let mut resp_headers = HeaderMap::new();

    let passthrough = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
    ];
    for name in &passthrough {
        if let Some(val) = upstream_headers.get(*name) {
            if let Ok(hn) = HeaderName::from_bytes(name.as_bytes()) {
                resp_headers.insert(hn, val.clone());
            }
        }
    }

    resp_headers.insert(
        HeaderName::from_static("access-control-allow-origin"),
        HeaderValue::from_static("*"),
    );
    resp_headers.insert(
        HeaderName::from_static("access-control-allow-methods"),
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    resp_headers.insert(
        HeaderName::from_static("access-control-allow-headers"),
        HeaderValue::from_static("Range, Content-Type"),
    );
    resp_headers.insert(
        HeaderName::from_static("access-control-expose-headers"),
        HeaderValue::from_static("Content-Range, Accept-Ranges, Content-Length"),
    );

    (status, resp_headers, body_bytes).into_response()
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    let proxy_state: SharedProxyState = Arc::new(Mutex::new(ProxyState {
        port:     None,
        shutdown: None,
    }));

    tauri::Builder::default()
        .manage(proxy_state)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            file_exists,
            reveal_in_explorer,
            cors_proxy_start,
            cors_proxy_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
