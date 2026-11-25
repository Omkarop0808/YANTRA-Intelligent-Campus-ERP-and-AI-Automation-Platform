"""Local word-level transcription using faster-whisper inside demo-video/.venv."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from faster_whisper import WhisperModel


def main() -> None:
    audio_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("audio/yantra_voiceover_normalized.m4a")
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("out/voiceover_transcript.json")
    model_name = sys.argv[3] if len(sys.argv) > 3 else "small.en"

    if not audio_path.exists():
        print(f"ERROR: Audio file not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments_iter, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
    )

    segments = []
    for idx, seg in enumerate(segments_iter):
        words = [
            {
                "word": w.word,
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
                "probability": round(float(w.probability), 3),
            }
            for w in (seg.words or [])
        ]
        segments.append(
            {
                "id": idx,
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": seg.text.strip(),
                "words": words,
            }
        )

    payload = {
        "audio_file": str(audio_path),
        "model": model_name,
        "language": info.language,
        "duration_s": round(float(info.duration), 3),
        "segment_count": len(segments),
        "segments": segments,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"TRANSCRIBED: {len(segments)} segments, {payload['duration_s']}s -> {out_path}")


if __name__ == "__main__":
    main()
