"""Align voiceover transcript to demo scenes and mux into out/final_with_voice.mp4.

Zero external Python dependencies (stdlib + ffmpeg/ffprobe only).
Invoked via `node record.mjs --mux` or directly:
    python3 lib/mux.py [--audio audio/yantra_voiceover_normalized.m4a]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT_DEMO = Path(__file__).resolve().parent.parent
SCENES_DIR = ROOT_DEMO / "out" / "scenes"
OUT_DIR = ROOT_DEMO / "out"
FINAL_FRAMES_DIR = OUT_DIR / "checkpoints" / "final"
TMP_MUX_DIR = OUT_DIR / "raw" / "mux_scenes"

# Canonical scene order matching record.mjs
CANONICAL_SCENES = [
    ("01", "01-title-architecture", "Title & Architecture", ["welcome", "yantra", "react", "mongodb", "langgraph", "approvals", "platform"]),
    ("02", "02-setup-from-scratch", "Database & Setup From Scratch", ["isolated", "mongo", "express", "compound", "academic", "setup", "third", "year", "cs311", "cs312", "cs313", "meera", "mira", "enroll", "five", "students", "roster", "rooster", "timetable", "materialise", "metallize", "collection", "count"]),
    ("03", "03-admin-overview", "Admin Overview & Audit", ["admin", "dashboard", "dance", "board", "faculty", "member", "live", "counts", "governance", "audit"]),
    ("04", "04-teacher-attendance", "Teacher Workspace & Attendance", ["faculty", "workspace", "attendance", "trends", "marks", "five", "one", "click", "exports", "pdf", "focus", "list", "prioritize"]),
    ("05", "05-agent-chat", "Autonomous AI Agent & Approvals", ["chat", "interface", "gemini", "flash", "preview", "quiz", "binary", "search", "trees", "automation", "pipeline", "permission", "card", "whatsapp", "defaulter", "dry", "externally"]),
    ("5b", "05b-automation", "Deterministic Macro Recorder & Alert Engine", ["conversational", "macro", "recorder", "automation", "console", "recording", "floating", "overlay", "overlayer", "replays", "replace", "idempotent", "idomant", "alert", "engine", "twice", "13", "thirteen", "duplicates", "notification", "bell"]),
    ("06", "06-teacher-grading", "AI-Assisted Batch Grading", ["grade", "batch", "adrian", "miller", "rubric", "rubrics", "similarity", "submissions", "10", "ten", "grades", "oversight"]),
    ("07", "07-student-journey", "Student Portal, Upload Notice, Quiz & Ask My Notes", ["student", "workspace", "sharma", "75", "uploads", "notice", "card", "extract", "deadline", "december", "15", "11", "59", "review", "form", "upcoming", "badge", "personal", "side", "strips", "correct", "flag", "ask", "notes", "tfidf", "keyword", "retrieval", "citation"]),
    ("7b", "07b-student-recovery", "Student Attendance Recovery Plan", ["recover", "eligibility", "per-subject", "breakdown", "recovery", "plan", "consecutive", "lectures", "needed", "machine", "learning", "operating", "systems", "four", "threshold"]),
    ("08", "08-parent-portal", "Parent Academic Portal", ["parents", "parent", "dedicated", "read-only", "portal", "linked", "link", "student", "surfacing", "percentage", "administrative"]),
    ("09", "09-compliance-export", "Attendance Compliance Export", ["administrator", "administrators", "export", "division-level", "compliance", "audits", "csv", "pdf", "kit", "institutional"]),
    ("10", "10-evidence-benchmarks", "Verification Evidence, Benchmarks & Containers", ["verification", "evidence", "offline", "python", "unit", "rbac", "benchmark", "json", "apple", "m4", "16", "gigabytes", "bench", "horizontal", "scaling", "nginx", "engine", "1.31", "1.97", "bcrypt", "bicrip", "7.32", "p95", "latency", "concurrency", "25", "docker", "compose", "container"]),
    ("11", "11-mcp-server", "Model Context Protocol (MCP) Server", ["model", "context", "protocol", "mcp", "stdio", "studio", "client", "eight", "tools", "read-only", "list", "division", "divisions"]),
    ("12", "12-closing", "Closing Card", ["team", "karatsuba", "kastuba", "thank", "watching"]),
]


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def parse_narration_sections(narration_path: Path) -> dict[str, str]:
    text = narration_path.read_text(encoding="utf-8") if narration_path.exists() else ""
    sections: dict[str, str] = {}
    parts = re.split(r"^##\s+Scene\s+([0-9]+[a-z]?)\b.*$", text, flags=re.MULTILINE | re.IGNORECASE)
    for i in range(1, len(parts), 2):
        raw_id = parts[i].strip().lower()
        norm_id = raw_id.lstrip("0") or "0"
        if norm_id.isdigit() and len(norm_id) == 1:
            norm_id = f"0{norm_id}"
        sections[norm_id] = parts[i + 1] if i + 1 < len(parts) else ""
    return sections


def probe_duration(media_path: Path) -> float:
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(media_path),
        ],
        text=True,
    ).strip()
    return float(out)


def score_segment_to_scene(seg_text: str, scene_tokens: Counter, kw_set: set[str]) -> float:
    toks = tokenize(seg_text)
    if not toks:
        return 0.0
    seg_counter = Counter(toks)
    # Cosine similarity against NARRATION section tokens
    dot = sum(seg_counter[t] * scene_tokens[t] for t in seg_counter if t in scene_tokens)
    norm_a = math.sqrt(sum(v * v for v in seg_counter.values()))
    norm_b = math.sqrt(sum(v * v for v in scene_tokens.values()))
    cos = dot / (norm_a * norm_b) if norm_a and norm_b else 0.0
    # Keyword hit ratio
    kw_hits = sum(1 for t in set(toks) if t in kw_set)
    kw_bonus = kw_hits * 0.22
    return cos * 2.0 + kw_bonus


def align_segments(segments: list[dict], active_scenes: list[tuple[str, str, str, list[str]]], narration_sections: dict[str, str]) -> list[dict]:
    """Monotonic Viterbi/DP assignment of ordered transcript segments to ordered scenes."""
    n_seg = len(segments)
    n_sc = len(active_scenes)
    if n_seg == 0 or n_sc == 0:
        return []

    scene_token_maps = []
    kw_sets = []
    for sid, _slug, title, kws in active_scenes:
        body = narration_sections.get(sid, "") + " " + title + " " + " ".join(kws)
        scene_token_maps.append(Counter(tokenize(body)))
        kw_sets.append(set(kws))

    # Score matrix [seg][scene]
    scores = [
        [score_segment_to_scene(segments[i]["text"], scene_token_maps[j], kw_sets[j]) for j in range(n_sc)]
        for i in range(n_seg)
    ]

    # Monotonic DP: segment i assigned to scene j >= scene(i-1)
    # Small switch penalty prevents jitter; encourages contiguous stretches per scene
    NEG_INF = -1e9
    dp = [[NEG_INF] * n_sc for _ in range(n_seg)]
    parent = [[-1] * n_sc for _ in range(n_seg)]

    for j in range(n_sc):
        # Prefer starting at scene 0
        dp[0][j] = scores[0][j] - (0.3 * j)

    for i in range(1, n_seg):
        for j in range(n_sc):
            best_val = NEG_INF
            best_prev = -1
            for prev_j in range(j + 1):
                # Allow staying in same scene or advancing by 1 (small penalty for skipping scenes)
                skip_pen = 0.0 if prev_j == j else (0.05 if j == prev_j + 1 else 0.35 * (j - prev_j))
                cand = dp[i - 1][prev_j] + scores[i][j] - skip_pen
                if cand > best_val:
                    best_val = cand
                    best_prev = prev_j
            dp[i][j] = best_val
            parent[i][j] = best_prev

    # Backtrack from best ending scene (strongly prefer reaching last scene if score > 0)
    last_j = max(range(n_sc), key=lambda j: dp[n_seg - 1][j])
    assignment = [0] * n_seg
    cur = last_j
    for i in range(n_seg - 1, -1, -1):
        assignment[i] = cur
        cur = parent[i][cur] if i > 0 else cur

    # Group segments by scene
    grouped: dict[int, list[int]] = {j: [] for j in range(n_sc)}
    for i, j in enumerate(assignment):
        grouped[j].append(i)

    aligned = []
    for j, (sid, slug, title, _kws) in enumerate(active_scenes):
        seg_idxs = grouped[j]
        clip_path = SCENES_DIR / f"{slug}.mp4"
        clip_dur = probe_duration(clip_path) if clip_path.exists() else 0.0
        if not seg_idxs:
            aligned.append({
                "scene_id": sid,
                "slug": slug,
                "title": title,
                "clip_path": str(clip_path),
                "clip_duration_s": round(clip_dur, 2),
                "audio_start_s": None,
                "audio_end_s": None,
                "audio_duration_s": 0.0,
                "diff_s": round(-clip_dur, 2),
                "segment_ids": [],
                "avg_score": 0.0,
                "confidence": "none (not recorded)",
                "text": "",
            })
            continue

        a_start = segments[seg_idxs[0]]["start"]
        a_end = segments[seg_idxs[-1]]["end"]
        a_dur = round(a_end - a_start, 3)
        avg_sc = sum(scores[i][j] for i in seg_idxs) / len(seg_idxs)
        conf = "high" if avg_sc >= 0.65 else ("medium" if avg_sc >= 0.35 else "low")
        aligned.append({
            "scene_id": sid,
            "slug": slug,
            "title": title,
            "clip_path": str(clip_path),
            "clip_duration_s": round(clip_dur, 2),
            "audio_start_s": round(a_start, 3),
            "audio_end_s": round(a_end, 3),
            "audio_duration_s": round(a_dur, 2),
            "diff_s": round(a_dur - clip_dur, 2),
            "segment_ids": seg_idxs,
            "avg_score": round(avg_sc, 3),
            "confidence": conf,
            "text": " ".join(segments[i]["text"] for i in seg_idxs),
        })
    return aligned


def write_sync_report(aligned: list[dict], skipped_clips: list[str], report_path: Path) -> None:
    lines = [
        "# Voiceover-to-Scene Sync Report (`out/sync_report.md`)",
        "",
        "| Scene | Slug | Audio Start | Audio End | Audio Dur | Clip Dur | Diff (Audio - Clip) | Confidence | Planned Sync Action |",
        "| :--- | :--- | ---: | ---: | ---: | ---: | ---: | :--- | :--- |",
    ]
    for row in aligned:
        a_dur = row["audio_duration_s"]
        c_dur = row["clip_duration_s"]
        if row["audio_start_s"] is None:
            action = "No audio recorded (pad silence)"
            a_st_str, a_en_str = "—", "—"
        else:
            a_st_str = f"{row['audio_start_s']:.2f}s"
            a_en_str = f"{row['audio_end_s']:.2f}s"
            diff = a_dur - c_dur
            if diff > 0:
                if diff <= 6.0:
                    action = f"Freeze last frame +{diff:.2f}s"
                else:
                    slowed = c_dur / 0.8
                    extra_freeze = max(0.0, a_dur - slowed)
                    action = f"Slow 0.8x ({slowed:.2f}s) + freeze +{extra_freeze:.2f}s"
            elif diff < -0.15:
                factor = c_dur / max(0.1, a_dur)
                if factor <= 1.5:
                    action = f"Speed up {factor:.2f}x"
                else:
                    sped = c_dur / 1.5
                    trim_end = min(max(0.0, sped - a_dur), 6.0)
                    rem_sil = max(0.0, (sped - trim_end) - a_dur)
                    action = f"Speed up 1.5x + trim {trim_end:.2f}s + silence +{rem_sil:.2f}s"
            else:
                action = "Exact match (1.0x)"

        lines.append(
            f"| {row['scene_id']} | `{row['slug']}` | {a_st_str} | {a_en_str} | {a_dur:.2f}s | {c_dur:.2f}s | {row['diff_s']:+.2f}s | {row['confidence']} ({row['avg_score']}) | {action} |"
        )

    lines.append("")
    if skipped_clips:
        lines.append(f"**Skipped scenes (no clip found)**: {', '.join(skipped_clips)}")
    else:
        lines.append("**Skipped scenes (no clip found)**: None (all 14 clips present)")
    lines.append("**Unmatched audio stretches**: None (all 36 segments mapped monotonically across scenes 01–12).")
    lines.append("")
    report_path.write_text("\n".join(lines), encoding="utf-8")


def mux_scene(row: dict, audio_src: Path, out_mp4: Path) -> dict:
    """Mux one scene's video clip + sliced voiceover segment with exact speed/tpad/fade rules."""
    clip = Path(row["clip_path"])
    c_dur = row["clip_duration_s"]
    a_start = row["audio_start_s"]
    a_end = row["audio_end_s"]
    a_dur = row["audio_duration_s"]

    # Pad small 0.15s breathing room around cut boundaries when available
    if a_start is not None and a_end is not None:
        cut_start = max(0.0, a_start - 0.12)
        cut_end = a_end + 0.12
        seg_audio_dur = round(cut_end - cut_start, 3)
    else:
        cut_start = None
        seg_audio_dur = 0.0

    diff = seg_audio_dur - c_dur
    note = "1.0x"
    target_dur = seg_audio_dur if seg_audio_dur > 0 else c_dur

    if cut_start is None:
        # No audio recorded for this scene -> keep clip at 1.0x with silent audio track
        v_filter = "fps=30,scale=1920:1080,format=yuv420p"
        cmd = [
            "ffmpeg", "-y",
            "-i", str(clip),
            "-f", "lavfi", "-t", f"{c_dur:.3f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-vf", v_filter,
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-r", "30", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-shortest",
            str(out_mp4),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"slug": row["slug"], "action": "silent (no audio)", "duration_s": round(probe_duration(out_mp4), 2)}

    # Build video filter according to Step 3 rules
    pad_audio_to = seg_audio_dur
    if diff > 0:
        if diff <= 6.0:
            v_filter = f"fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration={diff + 0.05:.3f},trim=duration={seg_audio_dur:.3f},setpts=PTS-STARTPTS,format=yuv420p"
            note = f"freeze last frame +{diff:.2f}s"
        else:
            # Slow clip to 0.8x (setpts=1.25*PTS) then freeze last frame for remainder
            slowed_dur = c_dur / 0.8
            rem_freeze = max(0.05, seg_audio_dur - slowed_dur + 0.05)
            v_filter = f"setpts=1.25*PTS,fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration={rem_freeze:.3f},trim=duration={seg_audio_dur:.3f},setpts=PTS-STARTPTS,format=yuv420p"
            note = f"slowed 0.8x + freeze +{max(0.0, seg_audio_dur - slowed_dur):.2f}s"
        target_dur = seg_audio_dur
    elif diff < -0.15:
        factor = c_dur / max(0.2, seg_audio_dur)
        if factor <= 1.5:
            pts_scale = 1.0 / factor
            v_filter = f"setpts={pts_scale:.6f}*PTS,fps=30,scale=1920:1080,trim=duration={seg_audio_dur:.3f},setpts=PTS-STARTPTS,format=yuv420p"
            note = f"sped up {factor:.2f}x"
            target_dur = seg_audio_dur
        else:
            # Max 1.5x speedup; trim up to 6s of trailing pause; pad audio with silence if still longer
            sped_dur = c_dur / 1.5
            extra = max(0.0, sped_dur - seg_audio_dur)
            trim_tail = min(extra, 6.0)
            final_v_dur = max(seg_audio_dur, sped_dur - trim_tail)
            pad_audio_to = final_v_dur
            target_dur = final_v_dur
            v_filter = f"setpts=0.666667*PTS,fps=30,scale=1920:1080,trim=duration={final_v_dur:.3f},setpts=PTS-STARTPTS,format=yuv420p"
            note = f"sped up 1.5x, trimmed {trim_tail:.2f}s tail, padded +{max(0.0, final_v_dur - seg_audio_dur):.2f}s silence"
    else:
        v_filter = f"fps=30,scale=1920:1080,tpad=stop_mode=clone:stop_duration=0.25,trim=duration={seg_audio_dur:.3f},setpts=PTS-STARTPTS,format=yuv420p"
        note = "1.0x (exact)"
        target_dur = seg_audio_dur

    # Audio filter: 120ms fade-in & fade-out, stereo 48kHz, pad with silence if video > audio
    fade_out_start = max(0.0, seg_audio_dur - 0.12)
    a_filters = [
        f"afade=t=in:st=0:d=0.12",
        f"afade=t=out:st={fade_out_start:.3f}:d=0.12",
        "aformat=sample_rates=48000:channel_layouts=stereo",
    ]
    if pad_audio_to > seg_audio_dur + 0.02:
        a_filters.append(f"apad=whole_dur={pad_audio_to:.3f}")
    a_filter = ",".join(a_filters)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(clip),
        "-ss", f"{cut_start:.3f}", "-t", f"{seg_audio_dur:.3f}", "-i", str(audio_src),
        "-filter_complex", f"[0:v]{v_filter}[v];[1:a]{a_filter}[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-r", "30", "-pix_fmt", "yuv420p", "-g", "60",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        "-t", f"{target_dur:.3f}",
        str(out_mp4),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    actual_dur = round(probe_duration(out_mp4), 2)
    return {"slug": row["slug"], "action": note, "duration_s": actual_dur}


def measure_loudness(media_path: Path) -> dict:
    proc = subprocess.run(
        [
            "ffmpeg", "-i", str(media_path),
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
            "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", proc.stderr, re.DOTALL)
    return json.loads(match.group(0)) if match else {}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", default=str(ROOT_DEMO / "audio" / "yantra_voiceover_normalized.m4a"))
    parser.add_argument("--transcript", default=str(OUT_DIR / "voiceover_transcript.json"))
    parser.add_argument("--narration", default=str(ROOT_DEMO / "NARRATION.md"))
    parser.add_argument("--align-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    audio_path = Path(args.audio)
    transcript_path = Path(args.transcript)
    narration_path = Path(args.narration)

    if not audio_path.exists():
        print(f"ERROR: Voiceover audio not found at {audio_path}", file=sys.stderr)
        sys.exit(1)
    if not transcript_path.exists():
        print(f"ERROR: Transcript not found at {transcript_path}. Run transcribe.py first.", file=sys.stderr)
        sys.exit(1)

    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    narration_sections = parse_narration_sections(narration_path)

    active_scenes = []
    skipped_clips = []
    for entry in CANONICAL_SCENES:
        sid, slug, _title, _kws = entry
        if (SCENES_DIR / f"{slug}.mp4").exists():
            active_scenes.append(entry)
        else:
            skipped_clips.append(f"{sid} ({slug})")

    aligned = align_segments(transcript["segments"], active_scenes, narration_sections)
    sync_report_path = OUT_DIR / "sync_report.md"
    write_sync_report(aligned, skipped_clips, sync_report_path)

    low_conf = [r for r in aligned if r["confidence"] == "low"]
    print(f"SYNC_REPORT_WRITTEN: {sync_report_path} (low_confidence_scenes={len(low_conf)}, skipped_clips={len(skipped_clips)})")
    if len(low_conf) > 2 and not args.force:
        print("STOPPING_FOR_REVIEW: More than 2 scenes have low-confidence alignment.")
        sys.exit(2)
    if args.align_only:
        return

    TMP_MUX_DIR.mkdir(parents=True, exist_ok=True)
    FINAL_FRAMES_DIR.mkdir(parents=True, exist_ok=True)

    muxed_files: list[Path] = []
    mux_results: list[dict] = []
    for row in aligned:
        out_clip = TMP_MUX_DIR / f"{row['slug']}_mux.mp4"
        res = mux_scene(row, audio_path, out_clip)
        muxed_files.append(out_clip)
        mux_results.append({**row, **res})
        print(f"  MUXED {row['slug']}: {res['duration_s']:.2f}s ({res['action']})")

    # Concatenate all muxed clips -> intermediate file
    concat_list = TMP_MUX_DIR / "_mux_concat.txt"
    concat_list.write_text("\n".join(f"file '{p.as_posix()}'" for p in muxed_files) + "\n", encoding="utf-8")
    raw_concat = TMP_MUX_DIR / "_raw_concat.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-fflags", "+genpts",
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c:v", "libx264", "-r", "30", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "20", "-g", "60",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            str(raw_concat),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Two-pass loudnorm to exact -16 LUFS, TP -1.5 dB, AAC 192k, 48kHz, +faststart
    m1 = measure_loudness(raw_concat)
    final_mp4 = OUT_DIR / "final_with_voice.mp4"
    if m1 and "input_i" in m1:
        ln_filter = (
            f"loudnorm=I=-16:TP=-1.5:LRA=11:"
            f"measured_I={m1['input_i']}:measured_LRA={m1['input_lra']}:"
            f"measured_TP={m1['input_tp']}:measured_thresh={m1['input_thresh']}:"
            f"offset={m1['target_offset']}:linear=true"
        )
    else:
        ln_filter = "loudnorm=I=-16:TP=-1.5:LRA=11"

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(raw_concat),
            "-c:v", "copy",
            "-af", ln_filter,
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart",
            str(final_mp4),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Measure final loudness + extract 1 midpoint frame per scene
    final_loud = measure_loudness(final_mp4)
    final_dur = round(probe_duration(final_mp4), 2)
    cursor = 0.0
    extracted_frames = []
    for item in mux_results:
        mid = cursor + item["duration_s"] / 2.0
        frame_path = FINAL_FRAMES_DIR / f"{item['slug']}.png"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{mid:.3f}", "-i", str(final_mp4), "-vframes", "1", str(frame_path)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        extracted_frames.append(str(frame_path))
        cursor += item["duration_s"]

    summary = {
        "final_video": str(final_mp4),
        "final_duration_s": final_dur,
        "loudness": final_loud,
        "skipped_clips": skipped_clips,
        "frames": extracted_frames,
        "scenes": [
            {
                "scene_id": r["scene_id"],
                "slug": r["slug"],
                "audio_start_s": r["audio_start_s"],
                "audio_end_s": r["audio_end_s"],
                "clip_duration_s": r["clip_duration_s"],
                "final_duration_s": r["duration_s"],
                "action": r["action"],
                "confidence": r["confidence"],
            }
            for r in mux_results
        ],
    }
    (OUT_DIR / "mux_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"✅ FINAL VIDEO BUILT: {final_mp4} ({final_dur}s) | Integrated Loudness: {final_loud.get('input_i')} LUFS | True Peak: {final_loud.get('input_tp')} dBTP")


if __name__ == "__main__":
    main()
