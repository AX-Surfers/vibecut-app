use std::collections::HashMap;
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
    force: Option<bool>,
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

    if force.unwrap_or(false) {
        for cache_path in [
            &words_json_path,
            &video.with_extension("srt"),
            &parent.join(format!("{stem}_verified.srt")),
            &parent.join(format!("{stem}_audio.wav")),
        ] {
            let _ = fs::remove_file(cache_path);
        }
    }

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
        .arg(model.unwrap_or_else(|| "medium".to_string()))
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

    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(&root).map_err(|e| format!("CapCut 프로젝트 탐색 실패: {e}"))? {
        let entry = entry.map_err(|e| format!("CapCut 프로젝트 항목 읽기 실패: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let draft_info = path.join("draft_info.json");
        let Ok(metadata) = draft_info.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let is_newer = match &newest {
            Some((newest_modified, _)) => modified > *newest_modified,
            None => true,
        };
        if is_newer {
            newest = Some((modified, draft_info));
        }
    }

    newest
        .map(|(_, path)| path.to_string_lossy().into_owned())
        .ok_or_else(|| "사용 가능한 CapCut draft_info.json 템플릿을 찾지 못했습니다.".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CapcutCutImportResult {
    video_path: String,
    template_path: String,
    keep_spans: Vec<[f64; 2]>,
}

fn find_capcut_draft_path(project_dir: &Path) -> Result<PathBuf, String> {
    let timelines_dir = project_dir.join("Timelines");
    if timelines_dir.is_dir() {
        for entry in fs::read_dir(&timelines_dir)
            .map_err(|e| format!("Timelines 탐색 실패: {e}"))?
            .flatten()
        {
            let path = entry.path();
            if path.is_dir() {
                let draft = path.join("draft_info.json");
                if draft.exists() {
                    return Ok(draft);
                }
            }
        }
    }

    let root_draft = project_dir.join("draft_info.json");
    if root_draft.exists() {
        return Ok(root_draft);
    }

    Err(format!(
        "draft_info.json을 찾을 수 없습니다: {}",
        project_dir.display()
    ))
}

/// 컷 편집만 된 기존 CapCut 프로젝트를 읽어 원본 영상 경로 + 유지 구간(초) 목록을 반환한다.
/// 자막 트랙은 다루지 않는다 — Whisper 재전사 후 프론트에서 유지 구간 밖 단어를 삭제 처리한다.
#[command]
pub fn read_capcut_cut_project(project_path: String) -> Result<String, String> {
    let selected = PathBuf::from(&project_path);
    if !selected.exists() {
        return Err(format!("경로를 찾을 수 없습니다: {}", selected.display()));
    }

    // draft_info.json 파일을 직접 선택했으면 그대로, 프로젝트 폴더를 선택했으면 안에서 탐색
    let draft_path = if selected.is_file() {
        selected
    } else {
        find_capcut_draft_path(&selected)?
    };
    let raw = fs::read_to_string(&draft_path).map_err(|e| format!("draft_info.json 읽기 실패: {e}"))?;
    let draft: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("draft_info.json 파싱 실패: {e}"))?;

    let videos = draft["materials"]["videos"]
        .as_array()
        .ok_or_else(|| "materials.videos를 찾을 수 없습니다.".to_string())?;

    let mut path_by_material_id: HashMap<&str, &str> = HashMap::new();
    for video in videos {
        if let (Some(id), Some(path)) = (video["id"].as_str(), video["path"].as_str()) {
            if !id.is_empty() && !path.is_empty() {
                path_by_material_id.insert(id, path);
            }
        }
    }

    let tracks = draft["tracks"]
        .as_array()
        .ok_or_else(|| "tracks를 찾을 수 없습니다.".to_string())?;
    let video_track = tracks
        .iter()
        .find(|t| t["type"].as_str() == Some("video"))
        .ok_or_else(|| "비디오 트랙을 찾을 수 없습니다.".to_string())?;
    let segments = video_track["segments"]
        .as_array()
        .ok_or_else(|| "세그먼트를 찾을 수 없습니다.".to_string())?;

    if segments.is_empty() {
        return Err("컷 편집 구간이 없습니다.".to_string());
    }

    let mut video_path: Option<String> = None;
    let mut keep_spans: Vec<[f64; 2]> = Vec::new();

    for segment in segments {
        let Some(material_id) = segment["material_id"].as_str() else { continue };
        let Some(&path) = path_by_material_id.get(material_id) else { continue };

        match &video_path {
            None => video_path = Some(path.to_string()),
            Some(existing) if existing != path => continue, // 다른 원본을 참조하는 세그먼트는 건너뜀
            _ => {}
        }

        let start_us = segment["source_timerange"]["start"].as_f64().unwrap_or(0.0);
        let duration_us = segment["source_timerange"]["duration"].as_f64().unwrap_or(0.0);
        if duration_us <= 0.0 {
            continue;
        }
        keep_spans.push([start_us / 1_000_000.0, (start_us + duration_us) / 1_000_000.0]);
    }

    let video_path = video_path.ok_or_else(|| "원본 영상 경로를 찾을 수 없습니다.".to_string())?;
    if keep_spans.is_empty() {
        return Err("유효한 컷 구간을 찾지 못했습니다.".to_string());
    }
    keep_spans.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap());

    let result = CapcutCutImportResult {
        video_path,
        template_path: draft_path.to_string_lossy().into_owned(),
        keep_spans,
    };
    serde_json::to_string(&result).map_err(|e| format!("결과 직렬화 실패: {e}"))
}

const WAVEFORM_SAMPLE_RATE: u32 = 8000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WaveformResult {
    peaks: Vec<[f32; 2]>,
    sample_rate: u32,
    duration_sec: f64,
}

/// 영상의 [startSec, endSec] 구간 오디오를 ffmpeg로 잘라 모노 PCM으로 추출한 뒤
/// 화면에 그릴 만큼 min/max 피크로 다운샘플링해서 반환한다.
#[command]
pub fn extract_waveform(
    video_path: String,
    start_sec: f64,
    end_sec: f64,
    columns: Option<u32>,
) -> Result<String, String> {
    let clamped_start = start_sec.max(0.0);
    let duration = (end_sec - clamped_start).max(0.01);

    let output = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-ss",
            &format!("{clamped_start:.3}"),
            "-t",
            &format!("{duration:.3}"),
            "-i",
            &video_path,
            "-ac",
            "1",
            "-ar",
            &WAVEFORM_SAMPLE_RATE.to_string(),
            "-f",
            "f32le",
            "-",
        ])
        .output()
        .map_err(|e| format!("ffmpeg 실행 실패: {e} (ffmpeg가 설치되어 있는지 확인하세요)"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("파형 추출 실패: {}", stderr.trim()));
    }

    let bytes = output.stdout;
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect();

    let columns = columns.unwrap_or(300).max(1) as usize;
    let mut peaks: Vec<[f32; 2]> = Vec::with_capacity(columns);

    if samples.is_empty() {
        peaks.resize(columns, [0.0, 0.0]);
    } else {
        let bucket_size = (samples.len() as f64 / columns as f64).max(1.0);
        for col in 0..columns {
            let start_idx = ((col as f64) * bucket_size) as usize;
            let end_idx = (((col + 1) as f64) * bucket_size).round() as usize;
            let end_idx = end_idx.clamp(start_idx + 1, samples.len());
            if start_idx >= samples.len() {
                peaks.push([0.0, 0.0]);
                continue;
            }
            let slice = &samples[start_idx..end_idx];
            let mut min = f32::MAX;
            let mut max = f32::MIN;
            for &s in slice {
                if s < min {
                    min = s;
                }
                if s > max {
                    max = s;
                }
            }
            peaks.push([min, max]);
        }
    }

    let result = WaveformResult {
        peaks,
        sample_rate: WAVEFORM_SAMPLE_RATE,
        duration_sec: duration,
    };
    serde_json::to_string(&result).map_err(|e| format!("결과 직렬화 실패: {e}"))
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
