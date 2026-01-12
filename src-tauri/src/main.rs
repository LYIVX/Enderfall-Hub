// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use msi_extract::MsiExtractor;
use reqwest::blocking::Client;
use tauri::Manager;

#[cfg(target_os = "windows")]
fn create_shortcut(shortcut_path: &Path, target_path: &Path, working_dir: &Path) -> Result<(), String> {
  if let Some(parent) = shortcut_path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let script = format!(
    "$W = New-Object -ComObject WScript.Shell; $S = $W.CreateShortcut('{}'); $S.TargetPath = '{}'; $S.WorkingDirectory = '{}'; $S.Save();",
    shortcut_path.display(),
    target_path.display(),
    working_dir.display()
  );
  std::process::Command::new("powershell")
    .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
    .status()
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
  Path::new(&path).exists()
}

#[tauri::command]
fn copy_installer(
  window: tauri::Window,
  app_id: String,
  source_path: String,
  destination_dir: String,
) -> Result<String, String> {
  let source = PathBuf::from(&source_path);
  if !source.exists() {
    return Err("Installer not found.".to_string());
  }

  let file_name = source
    .file_name()
    .ok_or_else(|| "Installer filename missing.".to_string())?;
  let destination = PathBuf::from(&destination_dir).join(file_name);

  let mut input = File::open(&source).map_err(|e| e.to_string())?;
  let total = input.metadata().map_err(|e| e.to_string())?.len();
  let mut output = File::create(&destination).map_err(|e| e.to_string())?;
  let mut buffer = vec![0u8; 1024 * 1024];
  let mut copied: u64 = 0;

  loop {
    let read = input.read(&mut buffer).map_err(|e| e.to_string())?;
    if read == 0 {
      break;
    }
    output.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
    copied += read as u64;
    let progress = if total == 0 { 1.0 } else { copied as f64 / total as f64 };
    let _ = window.emit(
      "installer-progress",
      serde_json::json!({
        "appId": app_id,
        "progress": progress,
      }),
    );
  }

  output.flush().map_err(|e| e.to_string())?;

  Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
fn launch_path(path: String) -> Result<(), String> {
  let target = PathBuf::from(&path);
  if !target.exists() {
    return Err("File not found.".to_string());
  }
  std::process::Command::new(target)
    .spawn()
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn run_installer(path: String, args: Vec<String>) -> Result<(), String> {
  let target = PathBuf::from(&path);
  if !target.exists() {
    return Err("Installer not found.".to_string());
  }
  let status = std::process::Command::new(target)
    .args(&args)
    .status()
    .map_err(|e| e.to_string())?;
  if status.success() {
    Ok(())
  } else {
    Err(format!(
      "Installer exited with code {:?}.",
      status.code()
    ))
  }
}

#[tauri::command]
fn run_dev_app(cwd: String, command: Vec<String>) -> Result<(), String> {
  if command.is_empty() {
    return Err("Missing dev command.".to_string());
  }
  #[cfg(target_os = "windows")]
  let mut cmd = {
    let mut cmd = std::process::Command::new("cmd");
    cmd.arg("/c");
    cmd.args(&command);
    cmd
  };
  #[cfg(not(target_os = "windows"))]
  let mut cmd = {
    let mut cmd = std::process::Command::new(&command[0]);
    if command.len() > 1 {
      cmd.args(&command[1..]);
    }
    cmd
  };
  cmd.current_dir(cwd);
  cmd.spawn().map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn uninstall_app(install_dir: String, app_name: String) -> Result<(), String> {
  let install_path = PathBuf::from(&install_dir);
  if install_path.exists() {
    std::fs::remove_dir_all(&install_path).map_err(|e| e.to_string())?;
  }

  if let Some(desktop) = tauri::api::path::desktop_dir() {
    let shortcut = desktop.join(format!("{}.lnk", app_name));
    if shortcut.exists() {
      let _ = std::fs::remove_file(shortcut);
    }
  }

  if let Ok(appdata) = std::env::var("APPDATA") {
    let start_menu = PathBuf::from(appdata)
      .join("Microsoft")
      .join("Windows")
      .join("Start Menu")
      .join("Programs")
      .join("Enderfall")
      .join(format!("{}.lnk", app_name));
    if start_menu.exists() {
      let _ = std::fs::remove_file(start_menu);
    }
  }

  Ok(())
}

#[tauri::command]
fn install_msi_payload(
  window: tauri::Window,
  app_id: String,
  installer_path: String,
  install_dir: String,
  exe_name: String,
  app_name: String,
  create_desktop_shortcut: bool,
  create_start_menu_shortcut: bool,
) -> Result<(), String> {
  let installer = PathBuf::from(&installer_path);
  if !installer.exists() {
    return Err("Installer not found.".to_string());
  }
  let install_path = PathBuf::from(&install_dir);
  std::fs::create_dir_all(&install_path).map_err(|e| e.to_string())?;

  let _ = window.emit(
    "installer-progress",
    serde_json::json!({ "appId": app_id, "progress": 0.1 }),
  );

  let mut extractor = MsiExtractor::from_path(&installer).map_err(|e| e.to_string())?;
  extractor.to(&install_path);

  let _ = window.emit(
    "installer-progress",
    serde_json::json!({ "appId": app_id, "progress": 0.85 }),
  );

  let exe_path = install_path.join(&exe_name);
  if create_desktop_shortcut {
    if let Some(desktop) = tauri::api::path::desktop_dir() {
      let shortcut = desktop.join(format!("{}.lnk", app_name));
      create_shortcut(&shortcut, &exe_path, &install_path)?;
    }
  }
  if create_start_menu_shortcut {
    if let Ok(appdata) = std::env::var("APPDATA") {
      let start_menu = PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Enderfall");
      let shortcut = start_menu.join(format!("{}.lnk", app_name));
      create_shortcut(&shortcut, &exe_path, &install_path)?;
    }
  }

  let _ = window.emit(
    "installer-progress",
    serde_json::json!({ "appId": app_id, "progress": 1.0 }),
  );

  Ok(())
}

#[tauri::command]
fn download_installer(
  window: tauri::Window,
  app_id: String,
  url: String,
  destination_dir: String,
) -> Result<String, String> {
  let dest_dir = PathBuf::from(&destination_dir);
  std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

  let file_name = url
    .split('/')
    .last()
    .filter(|name| !name.is_empty())
    .unwrap_or("installer.bin");
  let destination = dest_dir.join(file_name);

  let client = Client::new();
  let mut response = client.get(&url).send().map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("Failed to download installer: {}", response.status()));
  }
  let total = response.content_length().unwrap_or(0);
  let mut output = File::create(&destination).map_err(|e| e.to_string())?;
  let mut copied: u64 = 0;
  let mut buffer = [0u8; 1024 * 256];

  loop {
    let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
    if read == 0 {
      break;
    }
    output.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
    copied += read as u64;
    if total > 0 {
      let progress = (copied as f64 / total as f64).min(1.0);
      let _ = window.emit(
        "installer-progress",
        serde_json::json!({
          "appId": app_id,
          "progress": progress,
        }),
      );
    }
  }

  output.flush().map_err(|e| e.to_string())?;

  Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
fn get_current_exe_path() -> Result<String, String> {
  std::env::current_exe()
    .map_err(|e| e.to_string())
    .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_program_files_dir() -> Result<String, String> {
  std::env::var("ProgramFiles").map_err(|e| e.to_string())
}

fn main() {
  let builder = tauri::Builder::default();
  let builder = if cfg!(debug_assertions) {
    builder
  } else {
    builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
  };
  builder
    .invoke_handler(tauri::generate_handler![
      path_exists,
      copy_installer,
      launch_path,
      run_installer,
      run_dev_app,
      uninstall_app,
      install_msi_payload,
      download_installer,
      get_current_exe_path,
      get_program_files_dir
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
