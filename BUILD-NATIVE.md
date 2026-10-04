# Native Builds (Windows · macOS · iOS)

The app is a PWA and already runs on all three platforms in the browser and as an
installed home-screen / start-menu icon. For real, store-distributable **native apps**
there are two routes. **Tauri v2** is recommended because it covers all three targets
from a single codebase.

> ⚠️ **iOS always requires a Mac** with Xcode + an Apple Developer account.
> This cannot be worked around on Windows (Apple's build/signing toolchain is
> macOS-only). Windows and macOS desktop builds are produced on their respective
> target platform.

---

## 📱 Getting it onto an iPhone — 3 options compared

| Option | Effort | Mac needed? | Apple account | How long does it last? |
|--------|--------|-------------|---------------|------------------------|
| **PWA (Home Screen)** | minimal | no | no | permanent |
| **Xcode to your own device** | medium | **yes** | free Apple ID is enough | **7 days**, then reinstall |
| **TestFlight / App Store** | high | **yes** | **paid (99 €/year)** | permanent |

### Option 1 — PWA straight to the Home Screen (simplest, no Mac)
1. Put the app on an **HTTPS host** (e.g. GitHub Pages, Netlify, Cloudflare Pages —
   all free). HTTPS is mandatory, otherwise no service worker / no install.
   - Quick testing on the iPhone also works without hosting: run
     `py -m http.server 5173` on the PC and open `http://<PC-IP>:5173` on the iPhone
     in the same Wi-Fi. For "Add to Home Screen" with offline support you still need HTTPS.
2. Open the page on the iPhone in **Safari** (not Chrome — only Safari can install).
3. **Share** button → **"Add to Home Screen"** → done.

Result: own app icon, full screen without the browser bar, works offline. Audio plays.
Limitation: no App Store presence; launched from the home-screen icon.

#### Offline & keep-running (important)
- **Offline:** after the first load everything works **without internet** — the service
  worker caches the files and the sound is generated entirely on-device (nothing is
  streamed). Airplane mode is fine.
- **Screen lock (Wake Lock):** while playing, the app requests a **screen wake lock** →
  the screen does **not** auto-lock and the session keeps running (e.g. until the timer
  ends). On stop the lock is released. When the app returns from the background the lock
  is re-requested automatically. Supported from **Safari iOS 16.4** as well as Chrome/Edge;
  on older systems without wake-lock support the normal auto-lock simply applies.
- **Manual lock / swiping the app away:** here iOS **stops** playback — iOS suspends web
  apps in the background and the `AudioContext` is halted. This is an iOS platform limit
  that cannot be bypassed from a PWA. When you return to the foreground the app resumes.
- **True background / lock-screen audio** on iPhone is only possible via a **native app**
  (Option 2/3) with the *background audio* capability enabled.

> Rule of thumb on iPhone: put it down with the **screen on** → runs until the timer
> thanks to the wake lock. In your pocket with the **screen off** → a native app is needed.

### Option 2 — As a real app on your own iPhone (Mac needed, free Apple ID)
For testing on your own device a **free Apple ID** is enough (no 99 € program required):
1. On a **Mac**, set up Variant A or B below.
2. Connect the iPhone via cable and open it in **Xcode** (`npx tauri ios dev` or
   `npx cap open ios`).
3. In Xcode under *Signing & Capabilities* select your Apple-ID team (free account),
   choose the iPhone as the target, **▶ Run**.
4. On the iPhone, trust the developer certificate once under
   *Settings → General → VPN & Device Management*.

⚠️ With a free account the app runs for **7 days**, after which you just reinstall it from
Xcode. Permanent/distributable only via Option 3.

### Option 3 — TestFlight or App Store (Mac + paid Developer Program)
1. **Apple Developer Program** (99 €/year) + create the app in *App Store Connect*.
2. On the Mac: `npx tauri ios build` (or *Archive* in Xcode) → upload.
3. Distribute via **TestFlight** to testers or submit for **App Store review**.

> **In short:** onto the iPhone right now = **Option 1 (PWA)**, no Mac needed. A real
> native app to try out = **Option 2** (Mac + free ID, 7-day limit). Permanent
> distribution = **Option 3** (Mac + paid account).

---

## Variant A — Tauri v2 (recommended, all 3 targets)

Tauri wraps the existing web frontend (`index.html`, `app.js`, …) in a lightweight
native shell. Desktop builds are much smaller than Electron.

### Prerequisites
- Node.js ≥ 18
- Rust (via <https://rustup.rs>)
- **Windows:** Microsoft C++ Build Tools + WebView2 (present on Win 11)
- **macOS/iOS:** Xcode + Xcode Command Line Tools

### Set up
Add Tauri in the project folder and point it at the static files (no dev server/bundler
needed — `frontendDist` is this folder):

```bash
npm install -D @tauri-apps/cli
npx tauri init \
  --app-name BinBeats \
  --window-title BinBeats \
  --frontend-dist . \
  --dev-url http://localhost:5173 \
  --before-dev-command "" \
  --before-build-command ""
```

Then set the bundle ID in `src-tauri/tauri.conf.json`:
`"identifier": "app.binbeats"`.

### Build desktop
```bash
# Run on Windows -> .msi / .exe
npx tauri build
# Run on macOS -> .app / .dmg
npx tauri build
```

### Build iOS (Mac only)
```bash
npx tauri ios init
npx tauri ios dev      # test in the simulator
npx tauri ios build    # archive for the App Store / TestFlight
```

---

## Variant B — Capacitor (iOS/Android) + Tauri/Electron (desktop)

If you prefer Capacitor: the matching [`capacitor.config.json`](capacitor.config.json)
is already in the project (`webDir: "."`).

```bash
npm install @capacitor/core @capacitor/ios
npm install -D @capacitor/cli
npx cap add ios
npx cap sync
npx cap open ios      # opens Xcode (Mac only) -> build/signing there
```

For the desktop in this case additionally use Tauri (see Variant A) or Electron.

---

## Variant C — PWA (no build, instantly on all 3 platforms)

Already done. Host it (any static host with HTTPS — see the GitHub Pages section in the
[README](README.md)) and install:

- **iOS (Safari):** Share → "Add to Home Screen"
- **Windows/macOS (Chrome/Edge):** address bar → install icon

Locally:
```bash
py -m http.server 5173
```

---

## Recommendation

1. **Now:** use/host the PWA — zero extra effort, all three platforms.
2. **If store distribution / a native icon is wanted:** Tauri v2 (Variant A).
   Build Windows on a Windows machine, macOS and iOS on a Mac.
