use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;

/// Asks the user where to save and writes the PNG there.
///
/// The frontend sends the PNG as a raw binary IPC body (`invoke('save_png', bytes)`),
/// which avoids a base64 round-trip. Returns `false` if the user cancels the dialog.
#[tauri::command]
async fn save_png(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("save_png expects raw PNG bytes".into());
    };

    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .add_filter("PNG Image", &["png"])
        .set_file_name("latex_render.png")
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    match rx.await.map_err(|e| e.to_string())? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|e| e.to_string())?;
            tokio::fs::write(path, bytes).await.map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false), // user cancelled
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_png])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
