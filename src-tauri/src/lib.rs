mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_words_json,
            commands::save_project,
            commands::load_project,
            commands::export_capcut,
            commands::check_python,
            commands::prepare_video_transcript,
            commands::find_default_template_path,
            commands::read_capcut_cut_project,
            commands::extract_waveform,
            commands::analyze_auto_edit,
        ])
        .setup(|_app| {
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
