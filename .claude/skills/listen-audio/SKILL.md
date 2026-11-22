---
name: listen-audio
description: Lets Claude "listen" to audio and video files (mp3, wav, m4a, ogg, flac, opus, webm, mp4, voice notes, recordings, podcasts, songs, meeting audio). Transcribes speech with timestamps (Whisper, any language incl. Turkish), measures loudness/silence/pitch/tempo/key/timbre, optionally tags sound events (dog, siren, applause, music...), and renders a spectrogram image Claude can look at. Use this whenever the user gives or mentions a sound or video file and wants to know what is in it - "dinle", "bu ses kaydında ne var", "transcribe", "deşifre et", "ne diyor", "şarkının temposu", "gürültü var mı", "who is speaking", "summarize this recording" - even if they don't say "transcribe" or "analyze". Claude cannot hear audio natively; this skill is the way to do it.
---

# Listen to audio

Claude has no ears, but it can read numbers and look at pictures. `scripts/listen.py` turns sound into
both: a timestamped transcript, an acoustic measurement report, optional sound-event labels, and a
waveform + loudness + mel-spectrogram PNG. Combine them to describe what the file sounds like.

## Run it

```bash
python ".claude/skills/listen-audio/scripts/listen.py" "<audio-or-video-file>" --out "<scratchpad>/listen/<name>"
```

When installed as a plugin, `${CLAUDE_PLUGIN_ROOT}` above is already replaced with the real path. If it still
reads literally `${CLAUDE_PLUGIN_ROOT}`, the skill was installed as a plain folder: use this skill's base
directory instead.

Useful flags:
- `--mode transcribe|analyze|all` (default `all`). Use `analyze` for music/ambience where words don't matter; `transcribe` when only the words matter and speed is important.
- `--tags` adds AudioSet sound-event labels per 10 s chunk ("Speech", "Dog", "Siren", "Guitar", "Applause"...). Turn it on whenever the question is *what kind of sounds* are present, not just what was said. Needs the optional deps below; first run downloads ~350 MB.
- `--model` whisper size: `small` (default, good balance), `turbo` or `large-v3` for hard audio / accents / noisy recordings, `base` for a quick look. First use of a model downloads it.
- `--language tr` forces language when auto-detect picks wrong (short clips, mixed languages).
- `--start 60 --end 120` listens to only part of a long file - good for a first pass on hour-long recordings.

The report is printed to stdout and saved (with `report.json`, `transcript.txt`, `spectrogram.png`) in `--out`.
Long runs (long files, big models on CPU) can take minutes - run in the background if the file is > ~10 min.

## Then actually "listen"

1. **Look at the picture.** Open `spectrogram.png` with Read. Horizontal stripes = sustained tones/harmonics
   (voice, instruments, hum); vertical lines = clicks/beats/percussion; diffuse fog = noise (wind, hiss,
   traffic); bright bands that rise and fall = speech or melody; empty dark columns = silence. The loudness
   row shows where things get louder/quieter.
2. **Read the numbers with judgement, not literally.** Tempo and key only mean something for music;
   pitch "voice_hint" is a rough guess from median F0 and can be wrong. Spectral flatness near 0 = tonal,
   > 0.3 = noise-like. A constant energy peak in the `sub_bass`/`bass` band with tonal flatness often means
   mains hum (50 Hz in Turkey/Europe). Clipping ratio > 0.1% means audible distortion.
3. **Check the transcript quality.** Segments flagged `⚠low-conf` may be misheard - say so rather than
   presenting them as fact. If language detection probability is low, rerun with `--language`. If the
   transcript is garbage but the spectrogram shows clear speech, rerun with a bigger `--model`.
4. **Answer the user's question** in their language. Quote timestamps (`02:15`) so they can jump there.
   Be honest about what is inferred (emotion, speaker gender, instrument) versus measured.

Whisper does not separate speakers. If the user needs "who said what", infer turns from content and pauses
and say it is an inference.

## Setup (once)

Requires Python 3.9+. Core:

```bash
python -m pip install faster-whisper librosa matplotlib soundfile
```

Optional, for `--tags`:

```bash
python -m pip install transformers torch
```

No system ffmpeg is needed: PyAV (installed with faster-whisper) bundles its own decoder, so video files
work too. The script decodes with PyAV directly if faster-whisper's own decoder breaks on a newer PyAV.
On an NVIDIA GPU, whisper tries CUDA and falls back to CPU if cuBLAS/cuDNN are missing - CPU is fine for
`base`/`small`; for big models on long files, installing the CUDA 12 runtime speeds things up a lot.

On Windows, if `python` opens the Microsoft Store stub, call the interpreter by its full path (for a
per-user install: `%LOCALAPPDATA%\Programs\Python\Python3XX\python.exe`). If an import fails, install the
missing package and retry rather than guessing the audio content.
