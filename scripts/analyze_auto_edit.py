#!/usr/bin/env python3
"""
씬/단어 JSON을 받아 자동 컷 후보를 분석한다.

핵심 정책:
- 같은 씬 안에서 인접 반복 구절은 앞쪽 반복만 부분 삭제
- 연속된 중복 시도는 마지막 시도만 남기고 앞쪽 씬 삭제
- "다시/잠깐/아니" 같은 신호어 씬은 삭제
- 매우 짧은 도입 발화가 다음 씬에 포함되면 앞쪽 씬 삭제
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from typing import Any

RETRY_CUES = {"다시", "잠깐", "잠시만", "아니", "죄송", "정정", "말씀드리면"}
TOKEN_RE = re.compile(r"[^\w가-힣]+", re.UNICODE)


def normalize_word(text: str) -> str:
    return TOKEN_RE.sub("", text or "").strip()


def scene_id(scene: dict[str, Any], index: int) -> str:
    raw = scene.get("id")
    if isinstance(raw, str) and raw.strip():
        return raw
    return f"scene-{index}"


def word_id(word: dict[str, Any], scene_fallback_id: str, index: int) -> str:
    raw = word.get("id")
    if isinstance(raw, str) and raw.strip():
        return raw
    return f"{scene_fallback_id}-word-{index}"


def kept_words(scene: dict[str, Any], scene_fallback_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for index, word in enumerate(scene.get("words", [])):
        if word.get("deleted"):
            continue
        token = normalize_word(word.get("text", ""))
        if token:
            out.append(
                {
                    "id": word_id(word, scene_fallback_id, index),
                    "token": token,
                    "start": word.get("start"),
                    "end": word.get("end"),
                }
            )
    return out


def kept_tokens(scene: dict[str, Any]) -> list[str]:
    return [word["token"] for word in kept_words(scene)]


def jaccard(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.0
    sa = set(a)
    sb = set(b)
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def add_suggestion(
    suggestions: dict[str, dict[str, Any]],
    scene_id: str,
    reason: str,
    score: float,
    word_ids: list[str],
) -> None:
    if not word_ids:
        return
    prev = suggestions.get(scene_id)
    if prev is None:
        suggestions[scene_id] = {
            "sceneId": scene_id,
            "reason": reason,
            "score": score,
            "wordIds": list(dict.fromkeys(word_ids)),
        }
        return

    prev["wordIds"] = list(dict.fromkeys(prev["wordIds"] + word_ids))
    if score > prev["score"]:
        prev["score"] = score
        prev["reason"] = reason


def longest_adjacent_repeat(words: list[dict[str, Any]]) -> tuple[int, int, int] | None:
    tokens = [word["token"] for word in words]
    n = len(tokens)
    best: tuple[int, int, int] | None = None

    for size in range(min(5, n // 2), 0, -1):
        for start in range(0, n - (size * 2) + 1):
            left = tokens[start : start + size]
            right = tokens[start + size : start + (size * 2)]
            if left == right:
                candidate = (start, start + size, size)
                if best is None or candidate[2] > best[2]:
                    best = candidate
        if best is not None:
            return best
    return None


def scene_duration(scene: dict[str, Any]) -> float:
    return float(scene.get("end", 0.0)) - float(scene.get("start", 0.0))


def build_duplicate_clusters(scene_words: list[list[dict[str, Any]]]) -> list[list[int]]:
    clusters: list[list[int]] = []
    current = [0] if scene_words else []

    for idx in range(1, len(scene_words)):
        prev_tokens = [word["token"] for word in scene_words[idx - 1]]
        tokens = [word["token"] for word in scene_words[idx]]
        prev_text = " ".join(prev_tokens)
        text = " ".join(tokens)
        similarity = jaccard(prev_tokens, tokens)
        contained = bool(prev_text and text and (prev_text in text or text in prev_text))

        if similarity >= 0.72 or contained:
            current.append(idx)
            continue

        if len(current) > 1:
            clusters.append(current)
        current = [idx]

    if len(current) > 1:
        clusters.append(current)

    return clusters


def analyze_scenes(scenes: list[dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(scenes, list):
        return {"suggestions": [], "wordIds": [], "reasonCounts": {}}

    normalized_scene_ids = [scene_id(scene, idx) for idx, scene in enumerate(scenes)]
    suggestions: dict[str, dict[str, Any]] = {}
    scene_words = [
        kept_words(scene, normalized_scene_ids[idx]) for idx, scene in enumerate(scenes)
    ]

    # 1) 씬 내부 인접 반복: 앞 구절만 부분 삭제
    for idx, words in enumerate(scene_words):
        repeat = longest_adjacent_repeat(words)
        if repeat is None:
            continue
        start, end, size = repeat
        delete_word_ids = [word["id"] for word in words[start:end]]
        add_suggestion(
            suggestions,
            normalized_scene_ids[idx],
            "self_repeat",
            min(0.99, 0.80 + (size * 0.04)),
            delete_word_ids,
        )

    # 2) 연속 중복 클러스터: 마지막 시도만 남기고 앞쪽 삭제
    for cluster in build_duplicate_clusters(scene_words):
        for cluster_idx in cluster[:-1]:
            delete_word_ids = [word["id"] for word in scene_words[cluster_idx]]
            score = 0.86 + min(0.08, (len(cluster) - 2) * 0.03)
            add_suggestion(
                suggestions,
                normalized_scene_ids[cluster_idx],
                "adjacent_duplicate",
                score,
                delete_word_ids,
            )

    # 3) 신호어/짧은 재시작
    for idx, words in enumerate(scene_words):
        tokens = [word["token"] for word in words]
        text = " ".join(tokens)
        duration = scene_duration(scenes[idx])

        cue_word_ids = [word["id"] for word in words if word["token"] in RETRY_CUES]
        if cue_word_ids:
            score = 0.95 if len(words) <= 4 else 0.82
            target_word_ids = cue_word_ids if len(words) > 4 else [word["id"] for word in words]
            add_suggestion(
                suggestions,
                normalized_scene_ids[idx],
                "explicit_retry",
                score,
                target_word_ids,
            )

        if idx >= len(scene_words) - 1:
            continue

        next_tokens = [word["token"] for word in scene_words[idx + 1]]
        next_text = " ".join(next_tokens)
        similarity = jaccard(tokens, next_tokens)
        current_is_short = duration <= 1.6 and len(tokens) <= 6
        contained = len(text) >= 2 and len(next_text) >= len(text) and text in next_text
        if current_is_short and (similarity >= 0.45 or contained):
            delete_word_ids = [word["id"] for word in words]
            add_suggestion(
                suggestions,
                normalized_scene_ids[idx],
                "short_restart",
                0.78 if contained else similarity,
                delete_word_ids,
            )

    suggestion_list = sorted(suggestions.values(), key=lambda item: item["score"], reverse=True)

    word_ids: list[str] = []
    reason_counts: dict[str, int] = defaultdict(int)
    for item in suggestion_list:
        word_ids.extend(item["wordIds"])
        reason_counts[item["reason"]] += 1

    unique_word_ids = list(dict.fromkeys(word_ids))
    return {
        "suggestions": suggestion_list,
        "wordIds": unique_word_ids,
        "reasonCounts": dict(reason_counts),
    }


def main() -> int:
    payload = json.load(sys.stdin)
    scenes = payload.get("scenes", [])
    result = analyze_scenes(scenes)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
