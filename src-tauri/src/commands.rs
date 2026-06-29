use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::command;
use tauri::Emitter;
use tauri::Manager;
use serde::Serialize;

#[command]
pub fn read_words_json(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("파일 읽기 실패: {e}"))
}

#[command]
pub fn save_project(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("저장 실패: {e}"))
}

#[command]
pub fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("프로젝트 로드 실패: {e}"))
}

/// python3 설치 여부 확인
#[command]
pub fn check_python(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(tool) = find_runtime_tool(&app, "add_subtitles") {
        return Ok(format!("bundled:{}", tool.display()));
    }

    Command::new("python3")
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .map_err(|_| "번들된 전사 런타임과 python3를 모두 찾을 수 없습니다.".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareTranscriptResult {
    words_json_path: String,
    subtitle_input_path: String,
    used_cache: bool,
    stdout: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptProgressPayload {
    stage: &'static str,
    progress: u8,
    message: String,
    detail: Option<String>,
}

#[command]
pub fn prepare_video_transcript(
    app: tauri::AppHandle,
    video_path: String,
    model: Option<String>,
) -> Result<String, String> {
    let runtime = find_runtime_tool(&app, "add_subtitles")
        .ok_or_else(|| "전사 런타임을 찾을 수 없습니다. 앱을 다시 빌드하세요.".to_string())?;
    let video = PathBuf::from(&video_path);
    let stem = video
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "유효하지 않은 영상 파일 이름입니다.".to_string())?;
    let parent = video
        .parent()
        .ok_or_else(|| "영상 파일 경로를 해석할 수 없습니다.".to_string())?;
    let words_json_path = parent.join(format!("{stem}_words.json"));
    let used_cache = words_json_path.exists();

    emit_transcript_progress(
        &app,
        "starting",
        5,
        "전사 준비 중…",
        Some(video.file_name().and_then(|name| name.to_str()).unwrap_or("영상").to_string()),
    );

    let mut child = Command::new(&runtime)
        .arg(&video_path)
        .arg("--model")
        .arg(model.unwrap_or_else(|| "small".to_string()))
        .arg("--no-verify")
        .arg("--dump-only")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "전사 준비 실행 실패: {e}. 번들 런타임 파일을 확인하세요."
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "전사 출력 스트림을 열지 못했습니다.".to_string())?;
    let mut stdout_reader = BufReader::new(stdout);
    let mut stdout = String::new();
    let mut line = String::new();

    loop {
        line.clear();
        let read = stdout_reader
            .read_line(&mut line)
            .map_err(|e| format!("전사 진행 로그 읽기 실패: {e}"))?;
        if read == 0 {
            break;
        }

        let trimmed = line.trim();
        stdout.push_str(&line);
        if trimmed.is_empty() {
            continue;
        }

        if let Some((stage, progress, message)) = classify_transcript_progress(trimmed) {
            emit_transcript_progress(&app, stage, progress, message, Some(trimmed.to_string()));
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("전사 프로세스 대기 실패: {e}"))?;
    let mut stderr = String::new();
    if let Some(mut stderr_reader) = child.stderr.take() {
        stderr_reader
            .read_to_string(&mut stderr)
            .map_err(|e| format!("전사 오류 로그 읽기 실패: {e}"))?;
    }

    if !status.success() {
        emit_transcript_progress(&app, "error", 100, "전사 준비 실패", Some(stderr.trim().to_string()));
        let details = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        return Err(format!("전사 준비 실패: {details}"));
    }

    if !words_json_path.exists() {
        emit_transcript_progress(&app, "error", 100, "전사 결과 파일이 없습니다.", None);
        return Err(format!(
            "전사는 완료됐지만 결과 파일이 없습니다: {}",
            words_json_path.display()
        ));
    }

    emit_transcript_progress(&app, "done", 100, "전사 완료", Some(words_json_path.display().to_string()));

    let result = PrepareTranscriptResult {
        words_json_path: words_json_path.to_string_lossy().into_owned(),
        subtitle_input_path: "/tmp/subtitle_input.json".to_string(),
        used_cache,
        stdout,
    };

    serde_json::to_string(&result).map_err(|e| format!("결과 직렬화 실패: {e}"))
}

fn emit_transcript_progress(
    app: &tauri::AppHandle,
    stage: &'static str,
    progress: u8,
    message: impl Into<String>,
    detail: Option<String>,
) {
    let payload = TranscriptProgressPayload {
        stage,
        progress,
        message: message.into(),
        detail,
    };
    let _ = app.emit("transcript-progress", payload);
}

fn classify_transcript_progress(line: &str) -> Option<(&'static str, u8, String)> {
    if line.contains("[0/3]") {
        return Some(("audio", 12, "편집 구간 오디오를 추출하는 중…".to_string()));
    }
    if line.contains("오디오 추출 중") {
        return Some(("audio", 18, "Whisper용 오디오를 준비하는 중…".to_string()));
    }
    if line.contains("오디오 캐시 사용") {
        return Some(("audio", 22, "캐시된 오디오를 불러오는 중…".to_string()));
    }
    if line.contains("[1/3]") {
        return Some(("transcribe", 30, "Whisper 전사를 시작합니다…".to_string()));
    }
    if line.contains("단어 타임스탬프 캐시 발견") || line.contains("캐시된 SRT + 단어 타임스탬프 발견") {
        return Some(("transcribe", 55, "캐시된 전사 결과를 불러오는 중…".to_string()));
    }
    if line.contains("전사 대상") || line.contains("모델:") {
        return Some(("transcribe", 42, "Whisper 모델을 로드하는 중…".to_string()));
    }
    if line.contains("인식 완료") {
        return Some(("transcribe", 72, "단어 타임스탬프를 정리하는 중…".to_string()));
    }
    if line.contains("단어 타임스탬프 저장") || line.contains("단어 타임스탬프 로드") {
        return Some(("dump", 82, "전사 결과를 저장하는 중…".to_string()));
    }
    if line.contains("subtitle_input.json") || line.contains("--dump-only") {
        return Some(("dump", 92, "편집용 자막 데이터를 정리하는 중…".to_string()));
    }

    None
}

#[command]
pub fn find_default_template_path() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| format!("HOME 경로 확인 실패: {e}"))?;
    let root = PathBuf::from(home).join("Movies/CapCut/User Data/Projects/com.lveditor.draft");

    if !root.exists() {
        return Err(format!("CapCut 프로젝트 루트를 찾을 수 없습니다: {}", root.display()));
    }

    for entry in fs::read_dir(&root).map_err(|e| format!("CapCut 프로젝트 탐색 실패: {e}"))? {
        let entry = entry.map_err(|e| format!("CapCut 프로젝트 항목 읽기 실패: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let draft_info = path.join("draft_info.json");
        if draft_info.exists() {
            return Ok(draft_info.to_string_lossy().into_owned());
        }
    }

    Err("사용 가능한 CapCut draft_info.json 템플릿을 찾지 못했습니다.".to_string())
}

#[command]
pub fn analyze_auto_edit(app: tauri::AppHandle, scenes_json: String) -> Result<String, String> {
    let runtime = find_runtime_tool(&app, "analyze_auto_edit")
        .ok_or_else(|| "auto-edit 분석 런타임을 찾을 수 없습니다.".to_string())?;

    let mut child = Command::new(&runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("auto-edit 분석 실행 실패: {e}"))?;

    if let Some(stdin) = child.stdin.take() {
        let mut stdin = stdin;
        stdin
            .write_all(scenes_json.as_bytes())
            .map_err(|e| format!("auto-edit 분석 stdin 쓰기 실패: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("auto-edit 분석 대기 실패: {e}"))?;

    let stdout = String::from_utf8(output.stdout).map_err(|e| format!("auto-edit 출력 파싱 실패: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("auto-edit 분석 실패: {}", stderr.trim()));
    }

    Ok(stdout)
}

/// CapCut 내보내기 — Python export_bridge.py 호출
/// input_json: { spans, capcut_path, video_file, subtitles? }
/// 반환: { snappedRanges, droppedRanges } JSON 문자열
#[command]
pub fn export_capcut(app: tauri::AppHandle, input_json: String) -> Result<String, String> {
    let bridge = find_runtime_tool(&app, "export_bridge")
        .ok_or_else(|| "CapCut 내보내기 런타임을 찾을 수 없습니다.".to_string())?;

    let mut child = Command::new(&bridge)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("내보내기 런타임 실행 실패: {e}"))?;

    if let Some(stdin) = child.stdin.take() {
        let mut stdin = stdin;
        stdin
            .write_all(input_json.as_bytes())
            .map_err(|e| format!("stdin 쓰기 실패: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("python 프로세스 대기 실패: {e}"))?;

    let stdout_str =
        String::from_utf8(output.stdout).map_err(|e| format!("출력 파싱 실패: {e}"))?;

    if !output.status.success() {
        // export_bridge.py는 에러도 stdout에 JSON으로 출력 (TypeScript가 result.error 처리)
        if !stdout_str.trim().is_empty() {
            return Ok(stdout_str);
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("export_bridge 오류: {stderr}"));
    }

    Ok(stdout_str)
}

fn find_runtime_tool(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("runtime").join(name).join(name));
        candidates.push(resource_dir.join("runtime").join(name));
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("runtime")
            .join(name)
            .join(name),
    );
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("runtime")
            .join(name),
    );
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("src-tauri")
            .join("resources")
            .join("runtime")
            .join(name)
            .join(name),
    );
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("src-tauri")
            .join("resources")
            .join("runtime")
            .join(name),
    );

    candidates.into_iter().find(|path| path.exists() && is_executable(path))
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(path) {
            return metadata.permissions().mode() & 0o111 != 0;
        }
    }
    false
}
