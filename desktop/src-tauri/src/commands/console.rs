use std::process::Command;

use nostr::ToBech32;
use serde::Serialize;
use tauri::State;

use crate::{app_state::AppState, relay::relay_ws_url_with_override};

#[derive(Serialize)]
pub struct SproutCliOutput {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

fn resolve_sprout_binary() -> Result<String, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("sprout");
            if bundled.exists() {
                return Ok(bundled.display().to_string());
            }
        }
    }

    Ok("sprout".to_string())
}

fn strip_global_args(args: &[String]) -> &[String] {
    if args.len() >= 2 && args[0] == "--format" {
        return &args[2..];
    }

    args
}

fn is_allowed_cli_command(args: &[String]) -> bool {
    let args = strip_global_args(args);
    if args.len() < 2 {
        return false;
    }

    matches!(
        (args[0].as_str(), args[1].as_str()),
        ("channels", "list")
            | ("channels", "get")
            | ("channels", "members")
            | ("messages", "get")
            | ("messages", "thread")
            | ("messages", "search")
            | ("reactions", "get")
            | ("users", "get")
            | ("users", "presence")
            | ("dms", "list")
            | ("feed", "get")
            | ("workflows", "list")
            | ("workflows", "get")
            | ("workflows", "runs")
            | ("canvas", "get")
            | ("social", "event")
            | ("social", "notes")
            | ("social", "contacts")
            | ("repos", "get")
            | ("repos", "list")
    )
}

#[tauri::command]
pub async fn run_sprout_cli(
    args: Vec<String>,
    state: State<'_, AppState>,
) -> Result<SproutCliOutput, String> {
    if args.first().is_some_and(|arg| arg == "sprout") {
        return Err("omit the leading `sprout`; the desktop app runs it for you".to_string());
    }

    if !is_allowed_cli_command(&args) {
        return Err("only read-only sprout commands are enabled in this prototype".to_string());
    }

    let relay_url = relay_ws_url_with_override(&state);
    let private_key = {
        let keys = state.keys.lock().map_err(|error| error.to_string())?;
        keys.secret_key()
            .to_bech32()
            .map_err(|error| format!("encode nsec: {error}"))?
    };
    let sprout_binary = resolve_sprout_binary()?;

    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new(sprout_binary)
            .args(args)
            .env("SPROUT_RELAY_URL", relay_url)
            .env("SPROUT_PRIVATE_KEY", private_key)
            .output()
    })
    .await
    .map_err(|error| format!("join sprout CLI task: {error}"))?
    .map_err(|error| format!("run sprout CLI: {error}"))?;

    Ok(SproutCliOutput {
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}
