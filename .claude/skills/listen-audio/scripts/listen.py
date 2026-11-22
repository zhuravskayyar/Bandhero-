#!/usr/bin/env python
"""listen.py - lets Claude "hear" an audio/video file.

Produces:
  * transcript of speech (faster-whisper, auto language, timestamps)
  * acoustic analysis (loudness, silence, pitch, tempo, key, timbre, timeline)
  * optional sound-event tags (AudioSet classifier: "Dog", "Siren", "Music"...)
  * a picture (waveform + loudness + mel spectrogram) Claude can look at with Read

Everything is written to --out (report.md, report.json, transcript.txt, spectrogram.png)
and report.md is also printed to stdout.

Usage:
  python listen.py FILE [--mode all|transcribe|analyze] [--tags]
                        [--model small] [--language tr] [--out DIR]
                        [--start SEC] [--end SEC]
"""
import argparse
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

ANALYSIS_SR = 22050
WHISPER_SR = 16000
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def log(msg):
    print(f"[listen] {msg}", file=sys.stderr, flush=True)


def fmt_t(sec):
    sec = max(0.0, float(sec))
    m, s = divmod(sec, 60)
    h, m = divmod(int(m), 60)
    return f"{h}:{m:02d}:{s:05.2f}" if h else f"{m:02d}:{s:05.2f}"


# --------------------------------------------------------------------------- decoding
def load_audio(path, sr, start=None, end=None):
    """Decode any audio/video container to mono float32 at `sr`.

    PyAV (bundled with faster-whisper) ships its own FFmpeg, so no system
    ffmpeg is needed. Falls back to librosa if faster-whisper is missing.
    """
    import numpy as np

    y = None
    try:
        from faster_whisper.audio import decode_audio

        y = decode_audio(str(path), sampling_rate=sr)
    except Exception as e:  # missing, or PyAV API drift between versions
        log(f"faster_whisper decode unavailable ({type(e).__name__}); using PyAV directly")
    if y is None:
        try:
            y = _decode_pyav(path, sr)
        except Exception as e:
            log(f"PyAV decode failed ({type(e).__name__}: {e}); falling back to librosa")
            import librosa

            y, _ = librosa.load(str(path), sr=sr, mono=True)
    y = np.asarray(y, dtype=np.float32)
    a = int((start or 0) * sr)
    b = int(end * sr) if end else len(y)
    return y[a:b]


def _decode_pyav(path, sr):
    import av
    import numpy as np

    chunks = []
    with av.open(str(path), mode="r") as container:
        stream = next(s for s in container.streams if s.type == "audio")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=sr)
        for frame in container.decode(stream):
            for f in resampler.resample(frame) or []:
                chunks.append(f.to_ndarray().reshape(-1))
        for f in resampler.resample(None) or []:
            chunks.append(f.to_ndarray().reshape(-1))
    if not chunks:
        return np.zeros(0, np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


# --------------------------------------------------------------------------- speech
def pick_device(requested):
    if requested != "auto":
        return requested
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        return "cpu"


def _run_whisper(audio16k, model_size, language, device):
    from faster_whisper import WhisperModel

    compute = "float16" if device == "cuda" else "int8"
    model = WhisperModel(model_size, device=device, compute_type=compute)
    seg_iter, info = model.transcribe(
        audio16k,
        language=language,
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,
    )
    segments = []
    for s in seg_iter:  # generator: decoding really happens here
        segments.append(
            {
                "start": round(s.start, 2),
                "end": round(s.end, 2),
                "text": s.text.strip(),
                "avg_logprob": round(s.avg_logprob, 3),
                "no_speech_prob": round(s.no_speech_prob, 3),
            }
        )
    return segments, info


def transcribe(audio16k, model_size, language, device, offset):
    device = pick_device(device)
    t0 = time.time()
    try:
        log(f"whisper '{model_size}' on {device} ...")
        segments, info = _run_whisper(audio16k, model_size, language, device)
    except Exception as e:  # typically missing cuDNN/cuBLAS DLLs on Windows
        if device == "cpu":
            raise
        log(f"GPU failed ({type(e).__name__}: {e}); retrying on CPU")
        device = "cpu"
        segments, info = _run_whisper(audio16k, model_size, language, device)
    for s in segments:
        s["start"] = round(s["start"] + offset, 2)
        s["end"] = round(s["end"] + offset, 2)
    speech_sec = sum(s["end"] - s["start"] for s in segments)
    return {
        "model": model_size,
        "device": device,
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "speech_seconds": round(speech_sec, 1),
        "segments": segments,
        "low_confidence_segments": sum(1 for s in segments if s["avg_logprob"] < -1.0),
        "elapsed_sec": round(time.time() - t0, 1),
    }


# --------------------------------------------------------------------------- acoustics
def hz_to_note(f):
    if not f or f <= 0 or math.isnan(f):
        return None
    midi = 69 + 12 * math.log2(f / 440.0)
    n = int(round(midi))
    cents = int(round((midi - n) * 100))
    return f"{NOTE_NAMES[n % 12]}{n // 12 - 1}" + (f"{cents:+d}c" if abs(cents) >= 15 else "")


def estimate_key(chroma_mean):
    import numpy as np

    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    best = (-2, None)
    for i in range(12):
        for prof, name in ((major, "major"), (minor, "minor")):
            r = np.corrcoef(chroma_mean, np.roll(prof, i))[0, 1]
            if r > best[0]:
                best = (r, f"{NOTE_NAMES[i]} {name}")
    return best[1], round(float(best[0]), 2)


def db(x):
    import numpy as np

    return float(20 * np.log10(max(float(x), 1e-6)))  # floor at -120 dBFS (digital silence)


def analyze(y, sr, offset, timeline_windows):
    import numpy as np
    import librosa

    dur = len(y) / sr
    out = {"duration_sec": round(dur, 2), "sample_rate_analyzed": sr}
    if dur < 0.05:
        out["note"] = "audio too short to analyze"
        return out, {}

    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    peak = float(np.max(np.abs(y)))
    out["loudness"] = {
        "peak_dbfs": round(db(peak), 1),
        "rms_dbfs": round(db(np.sqrt(np.mean(y**2))), 1),
        "loudest_moment": fmt_t(offset + float(np.argmax(rms)) * hop / sr),
        # loud vs quiet parts of the *sounding* material; pure silence would make this meaningless
        "dynamic_range_db": round(db(np.percentile(rms, 95)) - db(np.percentile(rms[rms > 1e-4], 10)), 1)
        if np.any(rms > 1e-4) else 0.0,
        "clipping_ratio": round(float(np.mean(np.abs(y) >= 0.999)), 5),
    }

    intervals = librosa.effects.split(y, top_db=40, hop_length=hop)
    sound_sec = float(sum(b - a for a, b in intervals)) / sr
    gaps = []
    prev = 0
    for a, b in intervals:
        if (a - prev) / sr >= 1.0:
            gaps.append([fmt_t(offset + prev / sr), fmt_t(offset + a / sr)])
        prev = b
    if (len(y) - prev) / sr >= 1.0:
        gaps.append([fmt_t(offset + prev / sr), fmt_t(offset + len(y) / sr)])
    out["silence"] = {
        "silence_ratio": round(1 - sound_sec / dur, 3),
        "sound_events": int(len(intervals)),
        "gaps_over_1s": gaps[:30],
    }

    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
    flat = librosa.feature.spectral_flatness(S=S)[0]
    rolloff = librosa.feature.spectral_rolloff(S=S, sr=sr)[0]
    zcr = librosa.feature.zero_crossing_rate(y, hop_length=hop)[0]
    bands = {"sub_bass <60Hz": (0, 60), "bass 60-250": (60, 250), "low_mid 250-2k": (250, 2000),
             "high_mid 2k-6k": (2000, 6000), "high >6k": (6000, sr / 2)}
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    power = (S**2).sum(axis=1)
    total = power.sum() + 1e-12
    out["timbre"] = {
        "spectral_centroid_hz": int(np.median(centroid)),
        "rolloff85_hz": int(np.median(rolloff)),
        "spectral_flatness": round(float(np.median(flat)), 4),
        "zero_crossing_rate": round(float(np.median(zcr)), 4),
        "energy_by_band_pct": {k: round(100 * float(power[(freqs >= lo) & (freqs < hi)].sum() / total), 1)
                               for k, (lo, hi) in bands.items()},
        "hint": ("noise-like" if np.median(flat) > 0.3 else "tonal/harmonic" if np.median(flat) < 0.02 else "mixed"),
    }

    # pitch (pyin is slow -> cap at 90 s, analyze at lower rate)
    cap = min(len(y), 90 * sr)
    y_p = librosa.resample(y[:cap], orig_sr=sr, target_sr=11025)
    f0, voiced, _ = librosa.pyin(y_p, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"),
                                 sr=11025, frame_length=1024, hop_length=256)
    vf = f0[voiced & ~np.isnan(f0)] if f0 is not None else np.array([])
    pitch = {"voiced_ratio": round(float(np.mean(voiced)), 3) if voiced is not None else 0.0,
             "analyzed_sec": round(cap / sr, 1)}
    if len(vf) > 5:
        med = float(np.median(vf))
        pitch.update({"median_hz": round(med, 1), "median_note": hz_to_note(med),
                      "range_hz": [round(float(np.percentile(vf, 5)), 1), round(float(np.percentile(vf, 95)), 1)],
                      "range_notes": [hz_to_note(np.percentile(vf, 5)), hz_to_note(np.percentile(vf, 95))]})
        if 80 <= med <= 300:
            pitch["voice_hint"] = "typical adult male range" if med < 165 else "typical adult female/child range"
    out["pitch"] = pitch

    # rhythm / tonality (meaningful for music)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=hop)
    tempo = float(np.atleast_1d(tempo)[0])
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop)
    chroma = librosa.feature.chroma_stft(S=S**2, sr=sr)
    key, key_conf = estimate_key(chroma.mean(axis=1))
    out["rhythm_tonality"] = {
        "tempo_bpm": round(tempo, 1),
        "beats_detected": int(len(beats)),
        "onsets_per_sec": round(len(onsets) / dur, 2),
        "estimated_key": key,
        "key_confidence": key_conf,
        "dominant_pitch_classes": [NOTE_NAMES[i] for i in np.argsort(chroma.mean(axis=1))[::-1][:3]],
    }

    # timeline: how the sound evolves
    n = max(1, min(timeline_windows, int(dur // 1) or 1))
    edges = np.linspace(0, len(y), n + 1).astype(int)
    tl = []
    for i in range(n):
        a, b = edges[i], edges[i + 1]
        seg = y[a:b]
        fa, fb = a // hop, max(a // hop + 1, b // hop)
        ch = chroma[:, fa:fb].mean(axis=1)
        tl.append({
            "from": fmt_t(offset + a / sr), "to": fmt_t(offset + b / sr),
            "rms_dbfs": round(db(np.sqrt(np.mean(seg**2)) if len(seg) else 0), 1),
            "centroid_hz": int(np.median(centroid[fa:fb])) if fb > fa else 0,
            "flatness": round(float(np.median(flat[fa:fb])), 3) if fb > fa else 0,
            "onsets": int(np.sum((onsets >= fa) & (onsets < fb))),
            "top_pitch_class": NOTE_NAMES[int(np.argmax(ch))],
        })
    out["timeline"] = tl
    return out, {"rms": rms, "hop": hop}


def plot(y, sr, offset, extras, path, title):
    import numpy as np
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import librosa
    import librosa.display

    fig, axes = plt.subplots(3, 1, figsize=(14, 9), sharex=True,
                             gridspec_kw={"height_ratios": [1, 0.7, 2.2]})
    t = offset + np.arange(len(y)) / sr
    step = max(1, len(y) // 20000)
    axes[0].plot(t[::step], y[::step], lw=0.5, color="#2a6f97")
    axes[0].set_ylabel("waveform")
    axes[0].set_ylim(-1, 1)
    rms = extras.get("rms")
    if rms is not None:
        tr = offset + np.arange(len(rms)) * extras["hop"] / sr
        axes[1].plot(tr, 20 * np.log10(np.maximum(rms, 1e-6)), color="#c1121f", lw=0.8)
    axes[1].set_ylabel("RMS dBFS")
    axes[1].set_ylim(-80, 0)
    n_mels = 128
    M = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=n_mels, hop_length=512)
    dur = len(y) / sr
    img = axes[2].imshow(librosa.power_to_db(M, ref=np.max), origin="lower", aspect="auto", cmap="magma",
                         extent=[offset, offset + dur, 0, n_mels], vmin=-80, vmax=0)
    mel_f = librosa.mel_frequencies(n_mels=n_mels, fmax=sr / 2)
    ticks = [hz for hz in (100, 250, 500, 1000, 2000, 4000, 8000) if hz < sr / 2]
    axes[2].set_yticks([int(np.argmin(np.abs(mel_f - hz))) for hz in ticks])
    axes[2].set_yticklabels([f"{hz // 1000}k" if hz >= 1000 else str(hz) for hz in ticks])
    axes[2].set_xlim(offset, offset + dur)
    axes[2].set_ylabel("mel freq (Hz)")
    axes[2].set_xlabel("time (s)")
    fig.colorbar(img, ax=axes, format="%+2.0f dB", fraction=0.02, pad=0.01)
    fig.suptitle(title)
    fig.savefig(path, dpi=90, bbox_inches="tight")
    plt.close(fig)


# --------------------------------------------------------------------------- sound tags
def tag_sounds(audio16k, offset, chunk_sec=10.0, model_id="MIT/ast-finetuned-audioset-10-10-0.4593"):
    import numpy as np
    from transformers import pipeline

    try:
        import torch

        dev = 0 if torch.cuda.is_available() else -1
    except Exception:
        dev = -1
    log(f"sound tagging with {model_id} ...")
    clf = pipeline("audio-classification", model=model_id, device=dev)
    n = int(chunk_sec * WHISPER_SR)
    chunks, agg = [], {}
    for i in range(0, max(1, len(audio16k)), n):
        seg = audio16k[i:i + n]
        if len(seg) < WHISPER_SR * 0.5:
            continue
        if np.sqrt(np.mean(seg**2)) < 1e-4:
            chunks.append({"from": fmt_t(offset + i / WHISPER_SR), "labels": [["Silence", 1.0]]})
            continue
        preds = clf({"raw": seg, "sampling_rate": WHISPER_SR}, top_k=5)
        labels = [[p["label"], round(p["score"], 3)] for p in preds if p["score"] >= 0.05][:4]
        for lab, sc in labels:
            agg[lab] = agg.get(lab, 0) + sc
        chunks.append({"from": fmt_t(offset + i / WHISPER_SR), "to": fmt_t(offset + (i + len(seg)) / WHISPER_SR),
                       "labels": labels})
    overall = sorted(agg.items(), key=lambda kv: -kv[1])[:10]
    k = max(1, len(chunks))
    return {"model": model_id, "chunk_sec": chunk_sec,
            "overall": [[lab, round(s / k, 3)] for lab, s in overall], "chunks": chunks}


# --------------------------------------------------------------------------- report
def render_md(r):
    L = [f"# Listening report: {r['file']}", ""]
    a = r.get("analysis") or {}
    L.append(f"- Duration analysed: {r['segment']}  ({a.get('duration_sec', '?')} s)")
    if r.get("spectrogram"):
        L.append(f"- Picture (waveform / loudness / mel spectrogram): `{r['spectrogram']}`  <- open with Read to *see* the sound")
    L.append("")
    t = r.get("transcript")
    if t:
        L += ["## Speech", f"language **{t['language']}** (p={t['language_probability']}), "
              f"{t['speech_seconds']} s of speech, {len(t['segments'])} segments, "
              f"{t['low_confidence_segments']} low-confidence, model {t['model']} on {t['device']}", ""]
        if not t["segments"]:
            L.append("_(no speech detected)_")
        for s in t["segments"]:
            flag = "  ⚠low-conf" if s["avg_logprob"] < -1.0 else ""
            L.append(f"[{fmt_t(s['start'])} → {fmt_t(s['end'])}] {s['text']}{flag}")
        L.append("")
    elif r.get("transcript_error"):
        L += ["## Speech", f"transcription failed: {r['transcript_error']}", ""]
    tags = r.get("tags")
    if tags:
        L += ["## Sound events (AudioSet tags)", "overall: " + ", ".join(f"{l} {s:.2f}" for l, s in tags["overall"]), ""]
        for c in tags["chunks"]:
            L.append(f"- {c['from']}: " + ", ".join(f"{l} ({s:.2f})" for l, s in c["labels"]))
        L.append("")
    elif r.get("tags_error"):
        L += ["## Sound events", f"tagging unavailable: {r['tags_error']}", ""]
    if a and "loudness" in a:
        lo, si, ti, pi, rt = a["loudness"], a["silence"], a["timbre"], a["pitch"], a["rhythm_tonality"]
        L += ["## Acoustics",
              f"- Loudness: peak {lo['peak_dbfs']} dBFS, RMS {lo['rms_dbfs']} dBFS, dynamic range {lo['dynamic_range_db']} dB, "
              f"loudest at {lo['loudest_moment']}, clipping {lo['clipping_ratio'] * 100:.3f}%",
              f"- Silence: {si['silence_ratio'] * 100:.0f}% of the time, {si['sound_events']} sound regions; "
              f"gaps ≥1s: {', '.join(f'{x}–{y}' for x, y in si['gaps_over_1s']) or 'none'}",
              f"- Timbre: {ti['hint']}; centroid {ti['spectral_centroid_hz']} Hz, rolloff {ti['rolloff85_hz']} Hz, "
              f"flatness {ti['spectral_flatness']}, ZCR {ti['zero_crossing_rate']}",
              f"- Energy by band %: " + ", ".join(f"{k} {v}" for k, v in ti["energy_by_band_pct"].items()),
              f"- Pitch: voiced {pi['voiced_ratio'] * 100:.0f}%"
              + (f", median {pi['median_hz']} Hz ({pi['median_note']}), range {pi['range_notes'][0]}–{pi['range_notes'][1]}"
                 if "median_hz" in pi else "")
              + (f" — {pi['voice_hint']}" if "voice_hint" in pi else "")
              + f" (first {pi['analyzed_sec']} s)",
              f"- Rhythm/tonality: ~{rt['tempo_bpm']} BPM ({rt['beats_detected']} beats), {rt['onsets_per_sec']} onsets/s, "
              f"key ≈ {rt['estimated_key']} (conf {rt['key_confidence']}), dominant classes {', '.join(rt['dominant_pitch_classes'])}",
              "", "### Timeline", "| from | to | RMS dBFS | centroid Hz | flatness | onsets | pitch class |",
              "|---|---|---|---|---|---|---|"]
        for w in a["timeline"]:
            L.append(f"| {w['from']} | {w['to']} | {w['rms_dbfs']} | {w['centroid_hz']} | {w['flatness']} | {w['onsets']} | {w['top_pitch_class']} |")
    return "\n".join(L) + "\n"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("file")
    p.add_argument("--mode", choices=["all", "transcribe", "analyze"], default="all")
    p.add_argument("--tags", action="store_true", help="also classify sound events (needs transformers+torch)")
    p.add_argument("--model", default="small", help="whisper size: tiny/base/small/medium/large-v3/turbo")
    p.add_argument("--language", default=None, help="force language code, e.g. tr, en")
    p.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--start", type=float, default=None)
    p.add_argument("--end", type=float, default=None)
    p.add_argument("--timeline", type=int, default=12, help="number of timeline windows")
    p.add_argument("--out", default=None)
    args = p.parse_args()

    src = Path(args.file).expanduser().resolve()
    if not src.exists():
        sys.exit(f"file not found: {src}")
    out = Path(args.out) if args.out else Path(tempfile.gettempdir()) / "claude-listen" / src.stem
    out.mkdir(parents=True, exist_ok=True)
    offset = args.start or 0.0

    report = {"file": str(src), "segment": f"{fmt_t(offset)} → {fmt_t(args.end) if args.end else 'end'}"}
    log("decoding audio ...")
    y16 = load_audio(src, WHISPER_SR, args.start, args.end)

    if args.mode in ("all", "transcribe"):
        try:
            report["transcript"] = transcribe(y16, args.model, args.language, args.device, offset)
            (out / "transcript.txt").write_text(
                "\n".join(f"[{fmt_t(s['start'])} → {fmt_t(s['end'])}] {s['text']}"
                          for s in report["transcript"]["segments"]), encoding="utf-8")
        except Exception as e:
            report["transcript_error"] = f"{type(e).__name__}: {e}"
            log(report["transcript_error"])

    if args.tags:
        try:
            report["tags"] = tag_sounds(y16, offset)
        except Exception as e:
            report["tags_error"] = f"{type(e).__name__}: {e}"
            log(report["tags_error"])

    if args.mode in ("all", "analyze"):
        import numpy as np
        import librosa

        # decode again at a higher rate so content above 8 kHz is not lost
        y = load_audio(src, ANALYSIS_SR, args.start, args.end)
        if not len(y):
            y = np.zeros(1, np.float32)
        log("acoustic analysis ...")
        report["analysis"], extras = analyze(y, ANALYSIS_SR, offset, args.timeline)
        try:
            png = out / "spectrogram.png"
            plot(y, ANALYSIS_SR, offset, extras, png, src.name)
            report["spectrogram"] = str(png)
        except Exception as e:
            log(f"plot failed: {e}")

    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    md = render_md(report)
    (out / "report.md").write_text(md, encoding="utf-8")
    print(md)
    print(f"(files in {out})")


if __name__ == "__main__":
    main()
