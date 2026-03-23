# 🔬 Netflix DRM Bypass — Security Research & Vulnerability Analysis

> **⚠️ DISCLAIMER:** This repository is strictly for **educational and security research purposes only**. The code and documentation here demonstrate known weaknesses in browser-based DRM implementations to promote awareness, better security design, and responsible disclosure. **Do not use this for piracy or any illegal activity.** Unauthorized circumvention of DRM may violate the DMCA (§ 1201), EU Copyright Directive, and similar laws in your jurisdiction.

---

## 📑 Table of Contents

1. [What This Project Is](#-what-this-project-is)
2. [How Netflix Protects Content — The DRM Stack](#-how-netflix-protects-content--the-drm-stack)
3. [The Vulnerability — Hardware Acceleration & Software Rendering](#-the-vulnerability--hardware-acceleration--software-rendering)
4. [Architecture & How This Project Works](#-architecture--how-this-project-works)
5. [Technical Protocols & Methods](#-technical-protocols--methods)
6. [Netflix Anti-Piracy Measures In Detail](#-netflix-anti-piracy-measures-in-detail)
7. [Why This Bypass Works (And Its Limitations)](#-why-this-bypass-works-and-its-limitations)
8. [Setup & Installation](#-setup--installation)
9. [Project File Structure](#-project-file-structure)
10. [Responsible Disclosure & Ethics](#-responsible-disclosure--ethics)
11. [References](#-references)

---

## 🎯 What This Project Is

This is a **proof-of-concept** Electron application that demonstrates a well-documented weakness in how DRM-protected video content is rendered in Chromium-based browsers. Specifically, it shows that when **hardware acceleration is disabled**, the GPU-level content protection (which causes a "black screen" during screen capture) is bypassed — because the video frames are rendered via the **CPU software path** instead of the protected GPU overlay pipeline.

The project pairs this with a **serverless WebRTC peer-to-peer screen sharing** mechanism to demonstrate how a captured screen could theoretically be streamed to another user — all without any intermediate server infrastructure.

**This is NOT a Netflix ripper, downloader, or streaming redistribution tool.** It captures the screen pixels (like any screenshot tool), it does not extract the underlying encrypted media segments or decryption keys.

---

## 🛡️ How Netflix Protects Content — The DRM Stack

Netflix employs a **multi-layered** defense system to protect its content. Understanding these layers is essential for security research:

### Layer 1: Encrypted Media Extensions (EME)

EME is a **W3C standard API** that allows web browsers to interact with DRM systems without exposing the underlying encryption keys to JavaScript. Here's how it works:

1. The browser requests a media manifest from Netflix's CDN.
2. The manifest describes the available streams (resolutions, bitrates) and includes **PSSH (Protection System Specific Header)** data.
3. JavaScript calls `navigator.requestMediaKeySystemAccess()` to check if the browser supports the required DRM system.
4. A `MediaKeySession` is created, and a **license request** is generated from the PSSH data.
5. This request is sent to Netflix's **license server**, which returns an encrypted license containing the **Content Encryption Key (CEK)**.
6. The CEK is loaded into the **Content Decryption Module (CDM)** — crucially, the key **never touches JavaScript**. It stays within the CDM's trusted boundary.

### Layer 2: Widevine DRM (Google)

Netflix uses **Widevine** on Chrome, Android, Firefox, and most non-Apple platforms. Widevine operates at three security levels:

| Level | Security | Where Decryption Happens | Max Resolution |
|-------|----------|--------------------------|----------------|
| **L1** | Highest | Hardware TEE (TrustZone / Intel SGX) | 4K / HDR |
| **L2** | Medium | Software CDM, hardware processing | 720p |
| **L3** | Lowest | Entirely in software | 480p (SD) |

- **L1** devices process decryption and video rendering entirely within a **Trusted Execution Environment (TEE)**, meaning even the operating system cannot access the decrypted frames.
- **L3** (used in most desktop Chrome browsers) decrypts in a software module (`libwidevinecdm.so`), which is the weakest link.
- Netflix deliberately **restricts resolution** based on the security level — you'll only get 720p on Chrome desktop because it uses L3.

### Layer 3: FairPlay Streaming (Apple)

On Safari and Apple devices, Netflix uses **Apple's FairPlay Streaming (FPS)**:

- FPS leverages Apple's **hardware-backed Secure Enclave** for key management.
- The CDM is integrated directly into the OS at the kernel level.
- Decrypted frames are routed through **IOSurface** (macOS) or **VideoToolbox** (iOS), which are hardware-composited and protected from screen capture by default.
- Apple's tight hardware–software integration makes FairPlay significantly harder to attack than Widevine L3.

### Layer 4: HDCP (Hardware Content Protection)

When outputting to external displays, Netflix requires **HDCP (High-bandwidth Digital Content Protection)**:

- **HDCP 2.2+** is required for 4K content.
- HDCP encrypts the signal between the GPU and the display at the hardware level.
- Without HDCP-compliant hardware, Netflix downgrades the stream resolution.

### Layer 5: Server-Side Protections

Beyond the client-side stack, Netflix also employs:

- **Watermarking** — Invisible forensic watermarks embedded in the video stream, unique per session, that can trace leaked content back to a specific account.
- **License server rate-limiting** — Anomalous license request patterns trigger account flags.
- **Device attestation** — Netflix's servers verify the integrity of the client device and CDM before issuing high-value licenses.
- **Playback telemetry** — Continuous client-to-server heartbeats during playback report device state, screen recording status, and environment anomalies.

---

## 🔓 The Vulnerability — Hardware Acceleration & Software Rendering

### The Core Issue

When a Chromium-based browser (or Electron app) plays DRM-protected video with **hardware acceleration enabled**, the decrypted video frames are composited through the **GPU overlay plane**. This overlay is invisible to screen capture APIs — it's literally a separate hardware layer that the OS compositor doesn't merge into the regular window framebuffer. This is why you see a **black rectangle** when you try to screenshot or screen-share a Netflix video.

**When hardware acceleration is disabled**, Chromium falls back to **software rendering via Skia (CPU)**. In this mode:

- Decrypted video frames are rendered into the regular **window framebuffer** (shared memory).
- The OS compositor treats them as ordinary pixel data.
- Screen capture APIs (`desktopCapturer`, `getDisplayMedia`, any screen recorder) can read these pixels normally.

### Why Chromium Allows This

This isn't a "bug" in the traditional sense — it's an architectural trade-off. Chromium's `--disable-gpu` / `app.disableHardwareAcceleration()` is a legitimate flag for:

- Accessibility (some screen readers need software rendering).
- Debugging GPU issues.
- Running in environments without GPU support (CI servers, containers).

The DRM protection is **coupled to the GPU pipeline**, not to the pixel output stage. When you remove the GPU from the chain, the protection goes with it.

### The Single Line That Does It

In an Electron app, this is all it takes:

```javascript
// index.js — Main process
app.disableHardwareAcceleration();
```

This single API call switches the entire Chromium renderer to CPU-based software rendering, which as a side effect, removes the GPU overlay protection on DRM video frames.

---

## 🏗️ Architecture & How This Project Works

The project is a **serverless Electron application** with two roles — **Host** (sender) and **Viewer** (receiver) — connected via **peer-to-peer WebRTC**:

```
┌──────────────────────────────────────────────────────────────┐
│                    ELECTRON MAIN PROCESS                     │
│   ┌────────────────────────────────────────────────────────┐ │
│   │  app.disableHardwareAcceleration()                     │ │
│   │  → Forces CPU rendering (Skia) instead of GPU overlay  │ │
│   │  → DRM video frames become capturable                  │ │
│   └────────────────────────────────────────────────────────┘ │
│   ┌────────────────────────────────────────────────────────┐ │
│   │  ipcMain.handle('get-sources')                         │ │
│   │  → Uses desktopCapturer to list available screens      │ │
│   └────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬───────────────────────────────┘
                               │ IPC Bridge
┌──────────────────────────────▼───────────────────────────────┐
│                  ELECTRON RENDERER PROCESS                    │
│   ┌─────────────────────┐  ┌──────────────────────────────┐  │
│   │  <webview> tag       │  │  WebRTC Peer Connection      │  │
│   │  Loads DRM content   │  │  ┌────────────────────────┐  │  │
│   │  (e.g., Bitmovin     │  │  │ STUN: google:19302     │  │  │
│   │   DRM demo)          │  │  │ ICE Candidate Gathering │  │  │
│   └─────────────────────┘  │  │ SDP Offer/Answer        │  │  │
│                            │  └────────────────────────┘  │  │
│   ┌─────────────────────┐  │                              │  │
│   │  getUserMedia()      │  │  Manual signaling via       │  │
│   │  chromeMediaSource:  │──│  copy-paste (no server)     │  │
│   │  'desktop'           │  │                              │  │
│   └─────────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                               │
                   WebRTC P2P (DTLS-SRTP encrypted)
                               │
                    ┌──────────▼──────────┐
                    │   VIEWER INSTANCE    │
                    │   Displays remote    │
                    │   stream in <video>  │
                    └─────────────────────┘
```

### Data Flow (Step-by-Step)

1. **App launches** → `app.disableHardwareAcceleration()` forces software rendering.
2. **Host** opens the embedded `<webview>` which loads DRM-protected content.
3. Content plays normally (decrypted by Widevine CDM), but frames go to the CPU framebuffer instead of GPU overlay.
4. Host clicks **"Capture Screen & Create Offer"** → Electron's `desktopCapturer` API lists available screens.
5. `getUserMedia()` captures the entire desktop as a `MediaStream` (video track).
6. An **RTCPeerConnection** is created, and the video track is added.
7. An **SDP Offer** is generated, ICE candidates are gathered, and the complete offer is Base64-encoded.
8. Host manually copies this offer string and sends it to the Viewer (via any messaging app).
9. **Viewer** pastes the offer, creates a matching `RTCPeerConnection`, sets the remote offer, generates an **SDP Answer**, and copies it back.
10. Host pastes the answer → **P2P DTLS-SRTP tunnel** is established.
11. Viewer receives the screen stream and displays it in a `<video>` element.

---

## ⚙️ Technical Protocols & Methods

### WebRTC (Web Real-Time Communication)

WebRTC is the backbone of the P2P streaming in this project. Here are the specific sub-protocols at play:

| Protocol | Role | Detail |
|----------|------|--------|
| **ICE** (Interactive Connectivity Establishment) | NAT traversal | Discovers the best network path between peers. Uses STUN to find the public IP, falls back to TURN relay if direct connection fails. |
| **STUN** (Session Traversal Utilities for NAT) | Public IP discovery | This project uses Google's public STUN server (`stun:stun.l.google.com:19302`). It's only used for IP discovery — no media flows through it. |
| **SDP** (Session Description Protocol) | Codec & capability negotiation | The Offer/Answer contains media capabilities (VP8/VP9/H264 codecs, resolution, framerate), ICE candidates, and DTLS fingerprints. |
| **DTLS** (Datagram Transport Layer Security) | Key exchange | Establishes an encrypted channel over UDP. The DTLS handshake happens after ICE succeeds. |
| **SRTP** (Secure Real-time Transport Protocol) | Encrypted media transport | All video frames are encrypted using keys derived from the DTLS handshake. No cleartext media ever flows over the network. |

### Electron-Specific APIs

| API | Purpose |
|-----|---------|
| `app.disableHardwareAcceleration()` | Forces Skia CPU rendering; removes GPU overlay protection |
| `desktopCapturer.getSources()` | Enumerates available screens and windows for capture |
| `<webview>` tag | Embeds a separate Chromium renderer process (used to load DRM content) |
| `ipcMain` / `ipcRenderer` | Secure inter-process communication between main and renderer |
| `nodeIntegration: true` | Allows Node.js APIs in the renderer (required for `ipcRenderer`) |

### Signaling Method — Manual SDP Exchange

Traditional WebRTC applications use a **signaling server** (WebSocket, HTTP, etc.) to exchange SDP offers and answers. This project deliberately avoids any server infrastructure:

- The SDP + ICE candidates are serialized to JSON, then **Base64-encoded** into a single copyable string.
- Users manually copy-paste this string through any out-of-band channel (WhatsApp, email, etc.).
- This makes the connection **truly serverless** — no signaling server, no TURN server, just a public STUN for IP discovery.

---

## 🔐 Netflix Anti-Piracy Measures In Detail

Netflix invests heavily in content protection. Here's a comprehensive breakdown of their defense systems:

### 1. Multi-DRM Strategy

Netflix doesn't rely on a single DRM system. It uses different DRM providers based on the platform:

| Platform | DRM System | CDM Location |
|----------|-----------|--------------|
| Chrome / Firefox / Android | Widevine | Software CDM (L3) or Hardware TEE (L1) |
| Safari / iOS / macOS | FairPlay | OS-level, hardware-backed |
| Edge (Legacy) | PlayReady | Software + hardware modes |
| Smart TVs / Consoles | Platform-specific | Varies (often hardware TEE) |

This multi-DRM approach means an attacker would need to defeat **multiple independent systems** to achieve universal content access.

### 2. Forensic Watermarking

Netflix embeds **invisible forensic watermarks** directly into the video stream:

- Each stream session receives a **unique watermark pattern** tied to the account and device.
- These watermarks survive re-encoding, cropping, resolution changes, and even camera recordings of a screen (camrips).
- If pirated content surfaces online, Netflix can extract the watermark and **identify the exact account** that leaked it.
- Netflix's watermarking is based on technology from companies like **Irdeto** and their in-house systems.

### 3. Device Attestation & Integrity Checks

Before issuing a high-security license (e.g., for 4K content), Netflix's license server verifies:

- **CDM integrity** — Is the Widevine module genuine and untampered?
- **Device certificate chain** — Does the device have a valid, non-revoked OEM certificate?
- **Root/Jailbreak detection** — On mobile, is the device rooted or jailbroken?
- **Emulator detection** — Is the client running in a VM or emulator?
- **TEE validation** — For L1 content, is a genuine Trusted Execution Environment present?

### 4. Resolution & Quality Gating

Netflix uses DRM security levels to **gate content quality**:

- **Widevine L1** (hardware TEE) → Up to **4K HDR**
- **Widevine L3** (software CDM, e.g., Chrome desktop) → Capped at **720p**
- **No HDCP** on external display → Downgraded to **SD**

This means even if you capture the screen with hardware acceleration disabled, you're only getting **720p at best** on a Chrome/Electron-based approach — because Netflix never sends the 4K stream to a software CDM.

### 5. Content Encryption — CENC & CBCS

Netflix encrypts media segments using:

- **CENC (Common Encryption)** — AES-128 CTR mode encryption applied to media samples. Used primarily on Widevine/PlayReady platforms.
- **CBCS (Common Encryption with CBC and Subsample)** — AES-128 CBC mode with a pattern-based encryption (encrypt 1 out of every 10 blocks). Used with FairPlay.
- Each segment has unique **Initialization Vectors (IVs)**, and keys are rotated periodically.

### 6. Server-Side Rate Limiting & Anomaly Detection

- **License request throttling** — Too many license requests in a short period trigger an account flag.
- **Concurrent stream limits** — Netflix enforces per-plan device concurrency limits.
- **Geographic anomalies** — Requests from VPNs, data centers, or suspicious IP ranges may trigger additional verification.
- **Playback heartbeats** — The Netflix client sends periodic telemetry to report playback state, device health, and environment status. Missing heartbeats or anomalous reports can trigger session termination.

### 7. HDCP Enforcement

- For external displays, Netflix requires **HDCP 1.4+** (for HD) and **HDCP 2.2** (for 4K).
- HDCP encrypts the video signal from the GPU to the display hardware.
- Without HDCP, the stream is either downgraded or blocked entirely.

### 8. Obfuscation & Code Protection

- Netflix's client-side JavaScript (the MSL client, license request logic) is **heavily obfuscated and minified**.
- The Widevine CDM binary (`libwidevinecdm.so` / `widevinecdm.dll`) is **code-signed and integrity-checked** — patching it triggers detection.
- Netflix uses **certificate pinning** for license server communication, preventing MITM attacks on the key exchange.

---

## 🤔 Why This Bypass Works (And Its Limitations)

### Why It Works

The fundamental reason is a **design coupling**: DRM video protection in Chromium relies on the GPU overlay plane, which only exists when hardware acceleration is active. Remove the GPU from the rendering pipeline → the overlay disappears → the frames are just regular pixels in memory.

This is an inherent architectural limitation of how Chromium handles DRM, and it affects **all Chromium-based** browsers and apps (Chrome, Edge, Electron, Brave, Opera, etc.).

### What This Bypass Does NOT Do

| Aspect | Status |
|--------|--------|
| Extract decryption keys | ❌ No |
| Download encrypted media segments | ❌ No |
| Bypass Widevine L1 (hardware TEE) | ❌ No |
| Capture 4K / HDR content | ❌ No (capped at 720p by Netflix) |
| Defeat forensic watermarking | ❌ No (watermarks are in the pixels) |
| Work on Safari / FairPlay | ❌ No (different rendering pipeline) |
| Bypass server-side detection | ❌ No (Netflix can detect this) |

### The Quality Ceiling

Even with this approach, you're limited to **720p** because:

1. Netflix only serves 720p to Widevine L3 (software CDM).
2. Screen capture introduces additional quality loss (compression artifacts, frame drops).
3. WebRTC encoding (VP8/VP9) adds another generation of compression.

This makes it impractical for actual piracy — the quality is poor compared to what's available through legitimate subscriptions.

---

## 🚀 Setup & Installation

### Prerequisites

- **Node.js** (v18 or later) — [https://nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)
- **macOS / Linux / Windows** (macOS tested; screen capture permissions required on macOS)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/yaxit24/Netflix-Streaming.git
cd Netflix-Streaming

# 2. Install all dependencies
npm install

# 3. Launch the Electron app
npm start
```

> **macOS users:** You'll be prompted to grant **Screen Recording** permission to the Electron app on first run. Go to **System Settings → Privacy & Security → Screen Recording** and enable it.

### Usage Flow

1. **Host** opens the app → clicks **"Capture Screen & Create Offer"**.
2. Copy the generated **Offer Code** (a long Base64 string).
3. Send the Offer Code to the **Viewer** via any channel.
4. **Viewer** opens their own instance → pastes the Offer Code → clicks **"Create Answer Code"**.
5. Copy the **Answer Code** and send it back to the Host.
6. **Host** pastes the Answer Code → clicks **"Accept Answer & Connect"**.
7. ✅ **P2P connection established** — the Viewer sees the Host's screen in real time.

---

## 📁 Project File Structure

```
Netflix-Streaming/
├── index.js          # Electron main process — disables HW accel, sets up IPC
├── index.html        # UI — Host/Viewer controls, embedded webview
├── renderer.js       # WebRTC logic — offer/answer generation, P2P streaming
├── package.json      # Dependencies (Electron)
├── .gitignore        # Excludes node_modules, lock files, OS files
├── BLOG.md           # Medium-style technical writeup / blog article
└── README.md         # This file
```

| File | Key Responsibilities |
|------|---------------------|
| `index.js` | Disables hardware acceleration, creates BrowserWindow, handles `desktopCapturer` IPC |
| `index.html` | Two-column Host/Viewer UI, embedded `<webview>` for DRM content, video preview elements |
| `renderer.js` | Full WebRTC lifecycle: `RTCPeerConnection` setup, SDP offer/answer creation, ICE gathering, manual signaling via Base64 encode/decode |
| `package.json` | Electron v41+, Express & Socket.io listed as deps (unused in serverless mode — legacy from earlier iteration) |

---

## ⚖️ Responsible Disclosure & Ethics

This project exists for **one reason**: to demonstrate and document a known architectural weakness in Chromium's DRM rendering pipeline for the benefit of the security research community.

### What We Advocate

- ✅ **Understanding DRM systems** to build better content protection.
- ✅ **Responsible disclosure** of vulnerabilities to browser vendors and DRM providers.
- ✅ **Academic research** into the limits of software-based content protection.
- ✅ **Consumer awareness** about what "protected" really means in practice.

### What We Do NOT Advocate

- ❌ Using this to pirate or redistribute copyrighted content.
- ❌ Building commercial tools based on this bypass.
- ❌ Circumventing DRM protections in violation of applicable laws.

### Legal Context

- **DMCA § 1201 (US):** Prohibits circumvention of technological measures that control access to copyrighted works, with exceptions for security research (§ 1201(j)).
- **EU Copyright Directive (Article 6):** Similar prohibitions with research exceptions.
- **This project operates under the security research exception** — it documents a known vulnerability without extracting, storing, or redistributing any copyrighted content.

---

## 📚 References

1. [W3C Encrypted Media Extensions (EME) Specification](https://www.w3.org/TR/encrypted-media/)
2. [Widevine DRM Architecture Overview](https://developers.google.com/widevine/drm/overview)
3. [Apple FairPlay Streaming Documentation](https://developer.apple.com/streaming/fps/)
4. [WebRTC Protocol Stack — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols)
5. [Chromium GPU Compositing & Overlay Architecture](https://chromium.googlesource.com/chromium/src/+/master/docs/gpu/)
6. [HDCP 2.2 Specification](https://www.digital-cp.com/hdcp-specifications)
7. [Netflix Tech Blog — Content Security](https://netflixtechblog.com/)
8. [CENC (Common Encryption) — ISO/IEC 23001-7](https://www.iso.org/standard/68042.html)

---

<p align="center"><em>Built for security research and education. If you're interested in DRM security, check the references above and consider contributing to responsible disclosure efforts.</em></p>