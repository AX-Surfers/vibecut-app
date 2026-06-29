#!/usr/bin/env python3
"""
aside export_bridge — SegmentCompiler 초단위 keep-span을 받아
  1. 프레임 스냅 + 드롭 판정 (Python = 스냅/드롭 권위)
  2. capcut_editor.py 호출로 draft_info.json 생성
  3. 자막 텍스트를 draft_info.json 텍스트 트랙에 추가
  4. {snappedRanges, droppedRanges} 반환 (stdout JSON)

입력 (stdin JSON):
  {
    "spans":        [[startSec, endSec], ...],
    "capcut_path":  "/path/to/capcut/project",
    "video_file":   "/path/to/video.mp4",
    "subtitles":    ["자막1", "자막2", ...]   // optional, spans 인덱스 기준
  }
"""

import copy
import json
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

FPS = 30
MIN_FRAMES = 13


def resolve_capcut_editor(script_dir: Path) -> list[str]:
    frozen_dir = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else script_dir
    binary_name = "capcut_editor"
    binary_path = frozen_dir / binary_name
    if binary_path.exists():
        return [str(binary_path)]

    script_path = script_dir / "capcut_editor.py"
    return [sys.executable, str(script_path)]


def new_id() -> str:
    return str(uuid.uuid4()).upper()


def frame_to_us(frame: int) -> int:
    numerator = frame * 1_000_000
    result = numerator // FPS
    if numerator % FPS * 2 >= FPS:
        result += 1
    return result


def snap_span(start_sec: float, end_sec: float):
    start_frame = round(start_sec * FPS)
    end_frame = round(end_sec * FPS)
    return start_frame, end_frame


_DEFAULT_TEXT_CONTENT = {
    "styles": [{"fill": {"content": {"solid": {"color": [1, 1, 1]}, "render_type": "solid"}},
                "range": [0, 1],
                "shadows": [{"angle": -45.0, "distance": 5.0,
                             "content": {"solid": {"color": [0, 0, 0]}, "render_type": "solid"},
                             "diffuse": 0.05, "thickness_projection_enable": False,
                             "thickness_projection_angle": -45,
                             "thickness_projection_distance": 0}],
                "size": 6}],
    "text": "",
}

DEFAULT_TEXT_MATERIAL: dict = {
    "recognize_task_id": "", "id": "", "name": "", "recognize_text": "",
    "recognize_model": "", "punc_model": "", "type": "text",
    "content": json.dumps(_DEFAULT_TEXT_CONTENT, ensure_ascii=False),
    "base_content": "",
    "words": {"start_time": [], "end_time": [], "text": []},
    "current_words": {"start_time": [], "end_time": [], "text": []},
    "global_alpha": 1.0, "combo_info": {"text_templates": []},
    "caption_template_info": {"resource_id": "", "third_resource_id": "",
                              "resource_name": "", "category_id": "", "category_name": "",
                              "effect_id": "", "request_id": "", "path": "",
                              "is_new": False, "source_platform": 0},
    "layer_weight": 0, "letter_spacing": 0.0, "line_spacing": 0.02,
    "has_shadow": True, "shadow_color": "#000000", "shadow_alpha": 1.0,
    "shadow_smoothing": 0.9, "shadow_distance": 5.0,
    "shadow_point": {"x": 0.636, "y": -0.636},
    "shadow_angle": -45.0, "shadow_thickness_projection_enable": False,
    "shadow_thickness_projection_angle": 0.0, "shadow_thickness_projection_distance": 0.0,
    "border_alpha": 1.0, "border_color": "#000000", "border_width": 0.15, "border_mode": 0,
    "style_name": "", "text_color": "", "text_alpha": 1.0,
    "font_name": "", "font_title": "", "font_size": 6.0,
    "font_path": "", "font_id": "", "font_resource_id": "",
    "initial_scale": 0.0, "font_url": "", "typesetting": 0, "alignment": 1, "line_feed": 1,
    "use_effect_default_color": True, "is_rich_text": False,
    "shape_clip_x": False, "shape_clip_y": False, "ktv_color": "",
    "text_to_audio_ids": [], "bold_width": 0.0, "italic_degree": 0,
    "underline": False, "underline_width": 0.05, "underline_offset": 0.22,
    "sub_type": 0, "check_flag": 39, "text_size": 30,
    "font_category_name": "", "font_source_platform": 1,
    "font_third_resource_id": "", "font_category_id": "",
    "fonts": [], "text_curve": None, "text_loop_on_path": False,
    "offset_on_path": 0.0, "enable_path_typesetting": False,
    "text_exceeds_path_process_type": 0, "text_typesetting_paths": None,
    "text_typesetting_paths_file": "", "text_typesetting_path_index": 0,
}

DEFAULT_TEXT_SEGMENT: dict = {
    "id": "", "source_timerange": None,
    "target_timerange": {"start": 0, "duration": 1000000},
    "render_timerange": {"start": 0, "duration": 0},
    "desc": "", "state": 0, "speed": 1.0, "is_loop": False, "is_tone_modify": False,
    "reverse": False, "intensifies_audio": False, "cartoon": False,
    "volume": 1.0, "last_nonzero_volume": 1.0,
    "clip": {
        "scale": {"x": 1.0, "y": 1.0}, "rotation": 0.0,
        "transform": {"x": 0.0, "y": -0.7407407407407407},
        "flip": {"vertical": False, "horizontal": False}, "alpha": 1.0,
    },
    "uniform_scale": {"on": True, "value": 1.0},
    "material_id": "", "extra_material_refs": [], "render_index": 14000,
    "keyframe_refs": [], "enable_lut": False, "enable_adjust": False,
    "enable_hsl": False, "visible": True, "group_id": "",
    "enable_color_curves": True, "enable_hsl_curves": True, "track_render_index": 1,
    "hdr_settings": None, "enable_color_wheels": True, "track_attribute": 0,
    "is_placeholder": False, "template_id": "", "enable_smart_color_adjust": False,
    "template_scene": "default", "common_keyframes": [], "caption_info": None,
    "responsive_layout": {
        "enable": False, "target_follow": "", "size_layout": 0,
        "horizontal_pos_layout": 0, "vertical_pos_layout": 0,
    },
    "enable_color_match_adjust": False, "enable_color_correct_adjust": False,
    "enable_adjust_mask": False, "raw_segment_id": "", "lyric_keyframes": None,
    "enable_video_mask": True, "digital_human_template_group_id": "",
    "color_correct_alg_result": "", "source": "segmentsourcenormal",
    "enable_mask_stroke": False, "enable_mask_shadow": False,
    "enable_color_adjust_pro": False,
}


def add_text_track(draft: dict, subtitle_texts: list[str], snapped: list[dict]) -> None:
    """스냅된 각 구간에 자막 텍스트 트랙을 추가/교체한다."""
    if not subtitle_texts or not snapped:
        return

    _texts = draft.get("materials", {}).get("texts", [])
    orig_text = _texts[0] if _texts else copy.deepcopy(DEFAULT_TEXT_MATERIAL)

    _tracks = draft.get("tracks", [])
    _text_track = next((t for t in _tracks if t.get("type") == "text"), None)
    _tseg_list = _text_track.get("segments", []) if _text_track else []
    orig_tseg = _tseg_list[0] if _tseg_list else copy.deepcopy(DEFAULT_TEXT_SEGMENT)

    text_materials = []
    text_segments = []

    for render_idx, s in enumerate(snapped):
        input_idx = s["inputIndex"]
        text = subtitle_texts[input_idx] if input_idx < len(subtitle_texts) else ""
        if not text.strip():
            continue

        mat_id = new_id()
        start_us = s["frameStartUs"]
        dur_us = s["frameEndUs"] - s["frameStartUs"]

        new_text = copy.deepcopy(orig_text)
        new_text["id"] = mat_id
        try:
            content_obj = json.loads(orig_text.get("content", "{}"))
        except (json.JSONDecodeError, TypeError):
            content_obj = copy.deepcopy(_DEFAULT_TEXT_CONTENT)
        content_obj["text"] = text
        for style in content_obj.get("styles", []):
            style["range"] = [0, len(text)]
        new_text["content"] = json.dumps(content_obj, ensure_ascii=False)
        text_materials.append(new_text)

        new_tseg = copy.deepcopy(orig_tseg)
        new_tseg["id"] = new_id()
        new_tseg["material_id"] = mat_id
        new_tseg["extra_material_refs"] = []
        new_tseg["source_timerange"] = None
        new_tseg["target_timerange"] = {"start": start_us, "duration": dur_us}
        new_tseg["render_index"] = 14000 + render_idx
        new_tseg.setdefault("clip", {}).setdefault("transform", {})
        new_tseg["clip"]["transform"]["y"] = -0.7407407407407407
        text_segments.append(new_tseg)

    if not text_materials:
        return

    draft.setdefault("materials", {})["texts"] = text_materials

    tracks = draft.get("tracks", [])
    text_track_idx = next((i for i, t in enumerate(tracks) if t.get("type") == "text"), None)
    new_track = {
        "id": new_id(), "attribute": 0, "flag": 0,
        "is_default_name": True, "name": "", "type": "text",
        "segments": text_segments,
    }
    if text_track_idx is not None:
        tracks[text_track_idx] = new_track
    else:
        tracks.append(new_track)
    draft["tracks"] = tracks


def main():
    data = json.load(sys.stdin)
    spans = data["spans"]
    capcut_path = data.get("capcut_path", "")
    template_path = data.get("template_path", "")
    output_path = data.get("output_path", "")
    subtitle_texts: list[str] = data.get("subtitles", [])

    snapped = []
    dropped = []

    for i, (s, e) in enumerate(spans):
        sf, ef = snap_span(s, e)
        dur = ef - sf

        if dur <= 0:
            dropped.append({"inputIndex": i, "origStartSec": s, "origEndSec": e,
                            "reason": "zero_frame"})
        elif dur < MIN_FRAMES:
            dropped.append({"inputIndex": i, "origStartSec": s, "origEndSec": e,
                            "reason": "below_min_clip"})
        else:
            snapped.append({"inputIndex": i,
                            "frameStartUs": frame_to_us(sf),
                            "frameEndUs": frame_to_us(ef)})

    segments_for_editor = [
        [s["frameStartUs"] / 1_000_000, s["frameEndUs"] / 1_000_000]
        for s in snapped
    ]

    subtitle_warning = None
    if segments_for_editor and (template_path or capcut_path):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(segments_for_editor, f)
            tmp_path = f.name

        try:
            script_dir = Path(__file__).parent
            if template_path:
                # 독립 모드: CapCut 실행 여부 확인 없이 템플릿에서 직접 생성
                cmd = resolve_capcut_editor(script_dir) + [
                       tmp_path,
                       "--template", template_path,
                       "--output", output_path,
                       "--no-check"]
            else:
                # 프로젝트 모드: CapCut 실행 여부 확인
                pgrep = subprocess.run(["pgrep", "-i", "capcut"], capture_output=True)
                if pgrep.returncode == 0:
                    print(json.dumps({
                        "error": "CapCut이 실행 중입니다. 종료 후 다시 시도하세요.",
                        "snappedRanges": snapped,
                        "droppedRanges": dropped
                    }))
                    sys.exit(1)
                cmd = resolve_capcut_editor(script_dir) + [tmp_path, "--project", capcut_path]

            result = subprocess.run(
                cmd,
                capture_output=True, text=True, cwd=str(script_dir)
            )
            if result.returncode != 0:
                print(json.dumps({
                    "error": result.stderr or result.stdout,
                    "snappedRanges": snapped,
                    "droppedRanges": dropped
                }))
                sys.exit(1)
        finally:
            os.unlink(tmp_path)

        # 자막 텍스트를 draft_info.json에 추가 (실패해도 영상 편집은 완료됨)
        if subtitle_texts:
            if template_path and output_path:
                draft_path = Path(output_path)
            elif capcut_path:
                draft_path = Path(capcut_path) / "draft_info.json"
            else:
                draft_path = None

            if draft_path and draft_path.exists():
                try:
                    draft = json.loads(draft_path.read_text(encoding="utf-8"))
                    add_text_track(draft, subtitle_texts, snapped)
                    draft_path.write_text(
                        json.dumps(draft, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8"
                    )
                except Exception as e:
                    subtitle_warning = f"자막 트랙 추가 실패: {e}"

    result: dict = {"snappedRanges": snapped, "droppedRanges": dropped}
    if subtitle_warning:
        result["warning"] = subtitle_warning
    print(json.dumps(result))


if __name__ == "__main__":
    main()
