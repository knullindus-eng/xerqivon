use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{fs, path::PathBuf};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

const BACKGROUND_IMAGE_FILE: &str = "background-image.bin";
const BACKGROUND_MIME_FILE: &str = "background-image.mime";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_updates,
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
        return Ok("already up to date".to_string());
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
