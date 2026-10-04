# BinBeats — Binaural Beats Generator

An installable **PWA** (Progressive Web App) that runs on **Windows, macOS and iOS**
in the browser and can be added to the home screen / start menu as an app icon.

> The user interface is in German; this documentation is in English.

## Features

- **Two frequency sliders** (left/right channel), 20–1000 Hz, **0.01 Hz steps** with slider
  + numeric input — fine enough for e.g. the Schumann resonance (7.83 Hz beat)
- **Live beat readout** (difference of the two frequencies, 2 decimals) with the matching EEG band
- **EEG presets**: Delta, Theta, Alpha, Beta, Gamma — stay lit as long as the beat is
  within that band's range — plus a **Schumann** preset (7.83 Hz, exact-match highlight)
- **Beat coupling** (🔗): keeps the distance (beat) constant — moving the carrier (left)
  frequency carries the right one along; picking a preset or setting the right frequency
  (re)locks the beat. Can be toggled off.
- **Save / load settings as a file** (`binbeats-settings.json`) **and** automatic remember
  of the last state in the browser (restored on next open)
- **Waveform visualization** of the real beat envelope + a gentle pulse glow in sync with
  the beat (smoothed = no strobe, respects `prefers-reduced-motion`)
- **Timer** (10/20/30/60 min) with countdown and a gentle fade-out at the end; the whole UI
  **dims** while a timer is active
- **Pink noise** mixable in (on/off + level), from a filtered noise buffer
- Precise stereo sine oscillators via the **Web Audio API** (true channel separation)
- Smooth fade in/out and gliding frequency changes (no clicks)
- Volume control, dark UI, **offline-capable** (service worker, network-first for HTML)
- **Screen Wake Lock**: the display stays awake during playback (no auto-lock);
  behavior & iOS limits are described in [BUILD-NATIVE.md](BUILD-NATIVE.md)

## EEG frequency bands (beat frequency)

| Band  | Range     | Preset | Typical association                 |
|-------|-----------|--------|-------------------------------------|
| Delta | 0.5–4 Hz  | 2 Hz   | Deep sleep, regeneration            |
| Theta | 4–8 Hz    | 6 Hz   | Meditation, deep relaxation         |
| Alpha | 8–13 Hz   | 10 Hz  | Relaxation, calm wakefulness        |
| Beta  | 13–30 Hz  | 20 Hz  | Concentration, focus                |
| Gamma | 30–100 Hz | 40 Hz  | High cognitive activity             |

Presets keep the **carrier frequency** (left channel) fixed and set the right channel
to `left + beat`.

The **Schumann** preset sets a 7.83 Hz beat (the Earth–ionosphere resonance). It is not
an EEG band but falls inside Theta; its chip lights only on an exact match.

## Run locally

Web Audio, the manifest and the service worker require `http://` (not `file://`):

```bash
py -m http.server 5173
```

Then open `http://localhost:5173`. **Headphones required** — the effect only occurs with
separate channels per ear.

## Deploy to GitHub Pages

The repo is ready to deploy as-is (all paths are relative, so it works from a project
subpath like `https://<user>.github.io/<repo>/`).

1. Push this project to a GitHub repository (default branch `main`).
2. In the repo: **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
3. The workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds and
   deploys on every push to `main`. The live URL appears in the Actions run and under Settings → Pages.

`.nojekyll` is included so GitHub serves the files as-is (no Jekyll processing).

### Installing the deployed app
- **iOS (Safari):** Share → "Add to Home Screen"
- **Windows/macOS (Chrome/Edge):** address bar → install icon

## Project structure

```
index.html                 UI
styles.css                 Styling (dark theme, responsive)
app.js                     Audio engine (Web Audio) + UI logic
manifest.webmanifest       PWA manifest
sw.js                      Service worker (offline cache)
icons/                     App icons (192/512, maskable)
.nojekyll                  Disable Jekyll on GitHub Pages
.github/workflows/         GitHub Pages deploy workflow
capacitor.config.json      Config for native iOS packaging (optional)
BUILD-NATIVE.md            Guide for native builds (Tauri/Capacitor) & iOS install
.claude/launch.json        Dev-server configuration
```

## Native apps later (optional)

The same codebase can be packaged as a real app-store app with **Tauri v2**
(Windows/macOS/iOS from one codebase, recommended) or **Capacitor** (iOS). Step by step
in [BUILD-NATIVE.md](BUILD-NATIVE.md), which also covers how to get the app onto an iPhone.
iOS builds and signing require a Mac + Apple Developer account.

---

> Not a medical device. No health claims. Do not use while driving or operating machinery.
> If you have epilepsy or a pacemaker, consult a doctor first.
