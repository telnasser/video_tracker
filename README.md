# AEGIS — Human Motion Tracking System
## Technical Documentation

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Data Flow](#data-flow)
4. [Component Reference](#component-reference)
5. [Action Detection Engine](#action-detection-engine)
6. [API Reference](#api-reference)
7. [Database Schema](#database-schema)
8. [Performance Tuning](#performance-tuning)
9. [Known Constraints](#known-constraints)

---

## Overview

Aegis is a real-time human figure detection and motion tracking web application that runs entirely in the browser. It uses a neural network (BodyPix MobileNetV1) to produce pixel-accurate body segmentation masks for every person in view, tracks each person across frames with a persistent ID, detects behavioural events (standing, falling, running), and logs detection history to a PostgreSQL database.

**Key capabilities:**

| Feature | Detail |
|---|---|
| Detection model | BodyPix MobileNetV1 via TensorFlow.js / WebGL |
| Segmentation | Per-pixel body mask — not bounding boxes or generic shapes |
| Tracking | Centroid-based greedy IoU matching with persistent IDs |
| Action detection | 7 event types inferred from bounding box geometry |
| Video analysis | Frame-by-frame seek-and-analyse on uploaded video files |
| Auto-transcoding | FFmpeg server-side transcode of unsupported formats → H.264 MP4 |
| Persistence | PostgreSQL via Express REST API |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  01 // INPUT LAYER                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ Webcam           │  │ Video File Upload │  │ FFmpeg       │  │
│  │ getUserMedia()   │  │ MP4·WebM·AVI     │  │ Auto-transcode│  │
│  │ {w:1280, h:720}  │  │ MOV·MKV          │  │ → H.264 MP4  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  02 // ML INFERENCE LAYER                                       │
│  ┌──────────────────────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ BodyPix MobileNetV1      │  │TF.js     │  │internalRes  │  │
│  │ segmentMultiPerson()     │  │WebGL     │  │'low'        │  │
│  │ Per-pixel body mask      │  │GPU accel │  │Every 3rd RAF│  │
│  └──────────────────────────┘  └──────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  03 // TRACKING LAYER                                           │
│  ┌─────────────────────────┐  ┌────────────────────────────┐   │
│  │ CentroidTracker          │  │ ActionDetector             │   │
│  │ Greedy distance matching │  │ Aspect ratio · Δheight     │   │
│  │ maxDist:100 · maxGap:20  │  │ Velocity · Posture signals │   │
│  └─────────────────────────┘  └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  04 // RENDERING LAYER                                          │
│  ┌────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │ Pixel Mask     │  │ Edge Glow        │  │ Motion Trails │   │
│  │ ImageData      │  │ ctx.shadowBlur=18│  │ 30-pt history │   │
│  │ putImageData() │  │ Boundary pixels  │  │ Centroid cross│   │
│  └────────────────┘  └──────────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  05 // REACT UI LAYER                                           │
│  ┌────────────┐  ┌──────────────┐  ┌───────────┐  ┌─────────┐ │
│  │live-feed   │  │video-analysis│  │history-   │  │action-  │ │
│  │.tsx        │  │.tsx          │  │logs.tsx   │  │panel.tsx│ │
│  └────────────┘  └──────────────┘  └───────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  06 // BACKEND LAYER                                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ Express API      │  │ PostgreSQL        │  │ Multer      │  │
│  │ Port 8080        │  │ detections table  │  │ File upload │  │
│  │ /api/detections  │  │ bboxes · count·ts │  │ multipart   │  │
│  │ /api/transcode   │  │                   │  │             │  │
│  └──────────────────┘  └──────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Monorepo structure:**

```
workspace/
├── artifacts/
│   ├── human-tracker/          # React + Vite frontend
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── detr-detector.ts    # BodyPix wrapper + drawing
│   │       │   ├── tracker.ts          # CentroidTracker
│   │       │   ├── action-detector.ts  # Action event engine
│   │       │   └── segmentation.ts     # (legacy, unused)
│   │       ├── hooks/
│   │       │   └── use-live-detection.ts
│   │       ├── pages/
│   │       │   ├── live-feed.tsx
│   │       │   ├── video-analysis.tsx
│   │       │   └── history-logs.tsx
│   │       └── components/
│   │           ├── action-panel.tsx
│   │           └── layout/sidebar.tsx
│   └── api-server/             # Express backend
│       └── src/
│           └── routes/
│               ├── detections.ts
│               └── transcode.ts
└── packages/
    └── api-client-react/       # TanStack Query hooks (shared)
```

---

## Data Flow

```
Camera/Video Frame (raw pixel buffer)
           │
           ▼
BodyPix.segmentMultiPerson(source, opts)
   internalResolution: 'low'
   segmentationThreshold: 0.60
   maxDetections: 10
           │
           ▼  PersonSegmentation[]
           │  each: { data: Uint8Array(0|1), width, height }
           │
           ▼
extractBoxesWithIndex()
   scan mask pixels → min/max X,Y per person
           │
           ▼  SegmentResult[]
           │  each: { segIndex, box: {x,y,width,height} }
           │
           ▼
CentroidTracker.update(boxes)
   greedy distance matrix matching
   maxDistance: 100px · maxDisappeared: 20 frames
           │
           ▼  TrackedObject[]
           │  each: { id, box, history[30], missedFrames, color }
           │
     ┌─────┴──────┐
     │             │
     ▼             ▼
drawSegmented    ActionDetector
Overlay(ctx)     .update(tracked, knownIds)
     │             │
     │             ▼  ActionEvent[]
Pixel mask        { type, trackId, timestamp,
Edge glow           label, severity }
Motion trails        │
     │             ▼
     │        setActionEvents()
     │        ActionPanel re-renders
     │
     ▼
setCurrentStats() → Telemetry panel re-renders
           │
           ▼
    personCount > 0
    AND Δt > 5000ms ?
           │
      YES  │  NO → skip
           ▼
POST /api/detections
{ personCount, boxes[] }
           │
           ▼
PostgreSQL INSERT
detections (person_count, bboxes, detected_at)
```

**Video upload path:**

```
User selects file
       │
       ├── Supported (MP4/WebM) ──────────────────────────────────┐
       │                                                           │
       └── Unsupported format ──→ POST /api/transcode             │
                                  Multer receives multipart        │
                                  FFmpeg: -c:v libx264 -preset fast│
                                  Returns H.264 MP4 blob ──────────┘
                                                                   │
                                                           <video> element
                                                                   │
                                                  for t = 0..duration step 1s:
                                                    video.currentTime = t
                                                    await 'seeked' event
                                                    BodyPix pipeline (same as live)
                                                    Draw overlay on analysis canvas
```

---

## Component Reference

### `detr-detector.ts` — `DETRDetector`

Central ML wrapper. Wraps BodyPix and owns all canvas drawing.

| Method | Signature | Description |
|---|---|---|
| `load()` | `async () => void` | Initialises BodyPix MobileNetV1 (quantBytes:2, outputStride:16, multiplier:0.75) |
| `isLoaded()` | `() => boolean` | Returns true once load() resolves |
| `segment()` | `async (source) => PersonSegmentation[]` | Runs inference on a video/canvas/image element |
| `extractBoxesWithIndex()` | `(segs) => SegmentResult[]` | Scans mask pixels to derive bounding boxes |
| `drawSegmentedOverlay()` | `(ctx, segs, segResults, trackedObjects) => void` | Renders all 4 visual layers onto the provided 2D context |

**Drawing layers (in order):**
1. `ImageData` pixel fill — each foreground mask pixel painted at 172/255 α in the person's colour
2. Edge glow — boundary pixels redrawn with `ctx.shadowBlur = 18` for rim-light effect
3. Motion trails — polyline through last 30 centroid positions
4. Centroid crosshair + ID label

---

### `tracker.ts` — `CentroidTracker`

Maintains persistent identity across frames using a greedy minimum-distance matching algorithm.

```
State per object: { id, box, history[30], missedFrames, color }

On each update(rects):
  1. Compute centroids for existing objects and new detections
  2. Build NxM distance matrix
  3. Greedily assign closest pairs (skip if distance > maxDistance)
  4. Unmatched existing objects: increment missedFrames
  5. Objects exceeding maxDisappeared: deregister
  6. Unmatched new detections: register with next ID + colour
```

**Colour palette** (cycles): `#00ffcc · #ff00ff · #ffcc00 · #ffff00 · #00ccff · #ff3366 · #33ff33 · #cc33ff`

---

### `action-detector.ts` — `ActionDetector`

Analyses rolling bounding box history per tracked person and emits typed events.

#### Signal table

| Signal | Computation | Threshold |
|---|---|---|
| Aspect ratio | `width / height` of latest box | `< 0.65` → tall (standing), `> 1.05` → wide (fallen) |
| Height delta | `(h_now - h_ref) / h_ref` over 20-frame window | `≥ 0.22` change triggers stand/sit |
| Bottom stability | `Δ(y + height)` over window | Must be `< 25%` of body height |
| Vertical velocity | `Δcy / frames` over 8-frame window | `> 12 px/frame` → fall confirmation |
| Horizontal speed | `|Δcx| / frames` over 10-frame window | `> 8 px/frame` → running |
| Stationarity | Cumulative motion over 25 frames | `< 15 px` total → stationary |

#### Action types

| Type | Severity | Trigger | Default |
|---|---|---|---|
| `STAND_UP` | info | Height ↑ 22%+ while feet stable | enabled |
| `SIT_DOWN` | info | Height ↓ 22%+ while feet stable | enabled |
| `FALL_DETECTED` | critical | AR flips wide + downward velocity | enabled |
| `RUNNING` | warn | Horizontal speed > 8 px/frame | enabled |
| `STATIONARY` | info | < 15px motion over 25 frames | disabled |
| `ENTERED_FRAME` | info | New track ID registered | enabled |
| `EXITED_FRAME` | info | Existing track ID removed | enabled |

**Debounce:** Same action type per person fires at most once every 3 seconds.

---

### `use-live-detection.ts` — `useLiveDetection()`

Custom React hook that owns the entire live detection pipeline. All mutable state accessed by the RAF loop lives in `useRef` — never in closure-captured React state — to prevent the stale-closure / multiple-loop race condition.

```
RAF loop:
  every tick  →  drawSegmentedOverlay() with cached last result  (smooth 60fps display)
  every 3rd   →  BodyPix inference  →  tracker update  →  action detection  →  state update
```

**Returns:**

| Value | Type | Description |
|---|---|---|
| `videoRef` | `RefObject<HTMLVideoElement>` | Attach to `<video>` element |
| `canvasRef` | `RefObject<HTMLCanvasElement>` | Attach to overlay `<canvas>` |
| `isModelLoading` | `boolean` | True while BodyPix initialises |
| `modelError` | `string \| null` | Set if model load fails |
| `cameraError` | `string \| null` | Set if getUserMedia fails |
| `currentStats` | `{ fps, personCount }` | Updated every second |
| `isActive` | `boolean` | Feed running state |
| `setIsActive` | `Dispatch` | Toggle the feed on/off |
| `actionEvents` | `ActionEvent[]` | Latest batch of action events |
| `setActionConfigs` | `(configs) => void` | Live-update enabled actions |

---

## API Reference

Base URL: `/api` (proxied to Express on port 8080 by Replit's dev proxy)

### `POST /api/detections`

Log a detection snapshot.

**Request body:**
```json
{
  "personCount": 2,
  "boxes": [
    { "x": 120, "y": 80, "width": 180, "height": 420, "confidence": 0.9, "trackId": 1 },
    { "x": 540, "y": 60, "width": 160, "height": 390, "confidence": 0.9, "trackId": 2 }
  ]
}
```

**Response:** `201 Created`
```json
{ "id": 42, "personCount": 2, "detectedAt": "2026-03-25T07:00:00.000Z" }
```

---

### `GET /api/detections`

Retrieve detection history.

**Query params:** `limit` (default 100), `offset` (default 0)

**Response:** `200 OK`
```json
[
  {
    "id": 42,
    "personCount": 2,
    "bboxes": [...],
    "detectedAt": "2026-03-25T07:00:00.000Z"
  }
]
```

---

### `POST /api/transcode`

Transcode an unsupported video format to H.264 MP4.

**Request:** `multipart/form-data` with field `video` containing the file.

**Response:** `200 OK` — raw MP4 binary (`Content-Type: video/mp4`)

FFmpeg flags used: `-c:v libx264 -preset fast -crf 22 -c:a aac -movflags frag_keyframe+empty_moov`

---

## Database Schema

```sql
CREATE TABLE detections (
  id           SERIAL PRIMARY KEY,
  person_count INTEGER NOT NULL,
  bboxes       JSONB,
  detected_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_detections_detected_at ON detections (detected_at DESC);
```

**`bboxes` field structure:**
```json
[
  { "x": 120, "y": 80, "width": 180, "height": 420, "confidence": 0.9, "trackId": 1 }
]
```

---

## Performance Tuning

| Parameter | Location | Value | Effect |
|---|---|---|---|
| `internalResolution` | `detr-detector.ts` | `'low'` | Fastest inference; ~2× speedup vs `'medium'` |
| `SEGMENT_EVERY_N` | `use-live-detection.ts` | `3` | Run inference every 3rd RAF frame (~8–15 FPS at 60fps display) |
| `segmentationThreshold` | `detr-detector.ts` | `0.60` | Lower = more pixels included; raise to reduce noise |
| `multiplier` | `detr-detector.ts` | `0.75` | BodyPix model width; `0.5` is faster, `1.0` is more accurate |
| `quantBytes` | `detr-detector.ts` | `2` | Model weight quantisation: `1` fastest, `4` most accurate |
| `maxDetections` | `detr-detector.ts` | `10` | Maximum persons tracked simultaneously |
| `maxDistance` | `tracker.ts` | `100` | Maximum centroid jump (px) to re-identify same person |
| `maxDisappeared` | `tracker.ts` | `20` | Frames before a lost track is dropped |
| History window | `tracker.ts` | `30` | Centroid points retained for motion trail |

**Typical observed FPS by device:**

| Device GPU | Inference FPS | Display FPS |
|---|---|---|
| Dedicated (RTX/M-series) | 15–25 | 60 |
| Integrated (Intel Iris) | 8–14 | 60 |
| Mobile (Chrome/Safari) | 4–10 | 30–60 |
| No WebGL (CPU fallback) | 1–3 | 10–20 |

---

## Known Constraints

| Constraint | Detail |
|---|---|
| WebGL required | TF.js falls back to CPU if WebGL is unavailable; inference is ~10× slower |
| Single camera | `facingMode: 'environment'` — rear camera on mobile, webcam on desktop |
| BodyPix accuracy | Works best with clear separation between people; overlapping bodies may merge into one mask |
| Action detection | Uses bounding-box geometry only — no skeletal keypoints. Works reliably for clear standing/falling; subtle posture changes may not trigger |
| Video transcoding | Limited to server memory for FFmpeg processing; very large files (>500 MB) may timeout |
| ONNX Runtime / DETR | `@xenova/transformers` with ORT 1.14 produces a fatal `registerBackend is undefined` error in Vite 7's ESM environment due to webpack CJS bundle conflicts — not fixable via config. Do not re-introduce without a different ORT build |
| DB logging rate | Capped at one INSERT per 5 seconds per session to avoid write storms on the database |
