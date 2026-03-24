use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow, WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;

const BACKGROUND_IMAGE_FILE: &str = "background-image.bin";
const BACKGROUND_MIME_FILE: &str = "background-image.mime";
const WINDOW_STATE_FILE: &str = "window-state.json";

#[derive(Debug, Serialize, Deserialize)]
struct WindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
}

#[derive(Debug, Serialize)]
struct UpdateInfo {
    current_version: String,
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                restore_window_state(&window)?;
                attach_window_state_tracking(window);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_updates,
            install_update,
            save_background_image,
            get_background_image,
            clear_background_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn check_updates(app: tauri::AppHandle) -> Result<String, String> {
    let Some(update) = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(serde_json::to_string(&Option::<UpdateInfo>::None).map_err(|error| error.to_string())?);
    };

    let info = UpdateInfo {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
    };

    serde_json::to_string(&Some(info)).map_err(|error| error.to_string())
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let Some(update) = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    app.restart();
}

#[tauri::command]
async fn save_background_image(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    mime_type: String,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("background image is empty".to_string());
    }

    let mime_type = normalize_mime_type(&mime_type);
    let (image_path, mime_path) = background_paths(&app)?;

    fs::write(&image_path, bytes).map_err(|error| error.to_string())?;
    fs::write(&mime_path, mime_type.as_bytes()).map_err(|error| error.to_string())?;

    Ok("background image saved".to_string())
}

#[tauri::command]
async fn get_background_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (image_path, mime_path) = background_paths(&app)?;

    if !image_path.exists() || !mime_path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(&image_path).map_err(|error| error.to_string())?;
    let mime_type = fs::read_to_string(&mime_path).map_err(|error| error.to_string())?;
    let encoded = STANDARD.encode(bytes);

    Ok(Some(format!(
        "data:{};base64,{}",
        normalize_mime_type(mime_type.trim()),
        encoded
    )))
}

#[tauri::command]
async fn clear_background_image(app: tauri::AppHandle) -> Result<String, String> {
    let (image_path, mime_path) = background_paths(&app)?;

    if image_path.exists() {
        fs::remove_file(&image_path).map_err(|error| error.to_string())?;
    }

    if mime_path.exists() {
        fs::remove_file(&mime_path).map_err(|error| error.to_string())?;
    }

    Ok("background image cleared".to_string())
}

fn background_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;

    Ok((
        app_data_dir.join(BACKGROUND_IMAGE_FILE),
        app_data_dir.join(BACKGROUND_MIME_FILE),
    ))
}

fn normalize_mime_type(value: &str) -> String {
    let trimmed = value.trim().to_lowercase();

    if trimmed.starts_with("image/") {
        trimmed
    } else {
        "image/png".to_string()
    }
}

fn attach_window_state_tracking(window: WebviewWindow) {
    window.clone().on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::CloseRequested { .. }
                | WindowEvent::Destroyed
        ) {
            let _ = save_window_state(&window);
        }
    });
}

fn restore_window_state(window: &WebviewWindow) -> Result<(), String> {
    let Some(state) = read_window_state(window)? else {
        return Ok(());
    };

    let bounded_width = state.width.max(980);
    let bounded_height = state.height.max(640);

    window
        .set_size(Size::Physical(PhysicalSize::new(
            bounded_width,
            bounded_height,
        )))
        .map_err(|error| error.to_string())?;

    window
        .set_position(Position::Physical(PhysicalPosition::new(
            state.x, state.y,
        )))
        .map_err(|error| error.to_string())?;

    if state.maximized {
        window.maximize().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn save_window_state(window: &WebviewWindow) -> Result<(), String> {
    let path = window_state_path(window)?;

    let size = window.inner_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let maximized = window.is_maximized().map_err(|error| error.to_string())?;

    let state = WindowState {
        width: size.width.max(980),
        height: size.height.max(640),
        x: position.x,
        y: position.y,
        maximized,
    };

    let json = serde_json::to_vec_pretty(&state).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())?;

    Ok(())
}

fn read_window_state(window: &WebviewWindow) -> Result<Option<WindowState>, String> {
    let path = window_state_path(window)?;

    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let state = serde_json::from_slice::<WindowState>(&bytes).map_err(|error| error.to_string())?;

    Ok(Some(state))
}

fn window_state_path(window: &WebviewWindow) -> Result<PathBuf, String> {
    let app_data_dir = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;

    Ok(app_data_dir.join(WINDOW_STATE_FILE))
}
