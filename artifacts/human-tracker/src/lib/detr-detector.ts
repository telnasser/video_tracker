/**
 * DETRDetector
 * Uses DETR ResNet-50 (via @xenova/transformers / ONNX) for real-time
 * person detection, then renders a proportional human body silhouette
 * (head + torso + legs) within each bounding box — not a rectangle.
 *
 * Interface is intentionally identical to BodyPixSegmentor so the two files
 * that consume it (use-live-detection.ts + video-analysis.tsx) need only
 * a 1-line import change.
 */

// Lazy-load to avoid Vite top-level-await issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipeline: any = null;

async function getPipeline() {
  if (!_pipeline) {
    const mod = await import('@xenova/transformers');
    _pipeline = mod.pipeline;
  }
  return _pipeline;
}

export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  trackId: number;
}

export interface SegmentResult {
  box: DetectionBox;
  segIndex: number;
}

// Output from the object-detection pipeline
interface DetectionEntry {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [0, 255, 200];
}

/** Draw a stylised human body silhouette within a bounding box. */
function drawBodySilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha = 0.55
) {
  const [r, g, b] = hexToRgb(color);
  const fill = `rgba(${r},${g},${b},${alpha})`;

  // Proportions of a standing person inside the bbox
  const headR   = w * 0.22;
  const headCX  = x + w / 2;
  const headCY  = y + headR + h * 0.02;

  const shoulderY = headCY + headR;
  const shoulderW = w * 0.72;
  const waistW    = w * 0.45;
  const hipW      = w * 0.55;
  const torsoH    = h * 0.35;
  const torsoY    = shoulderY;

  const legTopY   = torsoY + torsoH;
  const legBotY   = y + h;
  const legW      = w * 0.22;
  const leftLegX  = x + w / 2 - hipW / 2;
  const rightLegX = x + w / 2 + hipW / 2 - legW;

  // ── Head ────────────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.ellipse(headCX, headCY, headR * 0.85, headR, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  // ── Torso (trapezoid: wider at shoulders, narrower at waist) ─────────
  ctx.beginPath();
  ctx.moveTo(headCX - shoulderW / 2, torsoY);
  ctx.lineTo(headCX + shoulderW / 2, torsoY);
  ctx.lineTo(headCX + waistW / 2, torsoY + torsoH);
  ctx.lineTo(headCX - waistW / 2, torsoY + torsoH);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // ── Arms (slim rounded rects on each side) ───────────────────────────
  const armW = w * 0.13;
  const armH = torsoH * 0.85;
  const armY = torsoY + h * 0.02;

  // left arm
  ctx.beginPath();
  ctx.roundRect(
    headCX - shoulderW / 2 - armW + w * 0.02, armY,
    armW, armH, armW / 2
  );
  ctx.fillStyle = fill;
  ctx.fill();

  // right arm
  ctx.beginPath();
  ctx.roundRect(
    headCX + shoulderW / 2 - w * 0.02, armY,
    armW, armH, armW / 2
  );
  ctx.fillStyle = fill;
  ctx.fill();

  // ── Hips connector ───────────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(headCX - waistW / 2, legTopY);
  ctx.lineTo(headCX + waistW / 2, legTopY);
  ctx.lineTo(headCX + hipW / 2, legTopY + h * 0.06);
  ctx.lineTo(headCX - hipW / 2, legTopY + h * 0.06);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // ── Left leg ─────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.roundRect(leftLegX, legTopY + h * 0.05, legW, legBotY - legTopY - h * 0.05, legW / 2);
  ctx.fillStyle = fill;
  ctx.fill();

  // ── Right leg ────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.roundRect(rightLegX, legTopY + h * 0.05, legW, legBotY - legTopY - h * 0.05, legW / 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export class DETRDetector {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pipe: any = null;

  async load() {
    const pipeline = await getPipeline();
    // facebook/detr-resnet-50 — DETR with ResNet-50 backbone, COCO-trained.
    // Xenova ONNX version; quantized=true uses int8 (~45 MB).
    this.pipe = await pipeline(
      'object-detection',
      'Xenova/detr-resnet-50',
      { quantized: true }
    );
  }

  isLoaded() {
    return this.pipe !== null;
  }

  /** Run DETR on a video/canvas frame; returns only person detections. */
  async segment(
    source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
  ): Promise<DetectionEntry[]> {
    if (!this.pipe) throw new Error('DETR model not loaded');
    const results: DetectionEntry[] = await this.pipe(source, { threshold: 0.5 });
    return results.filter((r) => r.label === 'person');
  }

  /** Convert DETR detection boxes → SegmentResult for the centroid tracker. */
  extractBoxesWithIndex(detections: DetectionEntry[]): SegmentResult[] {
    return detections.map((d, si) => ({
      segIndex: si,
      box: {
        x: d.box.xmin,
        y: d.box.ymin,
        width: d.box.xmax - d.box.xmin,
        height: d.box.ymax - d.box.ymin,
        confidence: d.score,
        trackId: 0,
      },
    }));
  }

  drawSegmentedOverlay(
    ctx: CanvasRenderingContext2D,
    detections: DetectionEntry[],
    segResults: SegmentResult[],
    trackedObjects: Array<{
      id: number;
      box: DetectionBox;
      history: { x: number; y: number }[];
      missedFrames: number;
      color: string;
    }>
  ) {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // ── Match tracked objects → DETR detections (nearest centroid) ───────
    const usedSegs = new Set<number>();
    const assignments: Array<{ obj: typeof trackedObjects[0]; segResult: SegmentResult }> = [];

    for (const obj of trackedObjects) {
      if (obj.missedFrames > 0) continue;
      const ox = obj.box.x + obj.box.width / 2;
      const oy = obj.box.y + obj.box.height / 2;
      let bestIdx = -1, bestDist = Infinity;
      for (const sr of segResults) {
        if (usedSegs.has(sr.segIndex)) continue;
        const d = Math.hypot(ox - (sr.box.x + sr.box.width / 2), oy - (sr.box.y + sr.box.height / 2));
        if (d < bestDist) { bestDist = d; bestIdx = sr.segIndex; }
      }
      if (bestIdx >= 0) {
        usedSegs.add(bestIdx);
        assignments.push({ obj, segResult: segResults[bestIdx] });
      }
    }

    // ── Layer 1: body silhouettes with glow ───────────────────────────────
    for (const { obj, segResult: { box } } of assignments) {
      ctx.save();
      ctx.shadowColor = obj.color;
      ctx.shadowBlur = 20;
      drawBodySilhouette(ctx, box.x, box.y, box.width, box.height, obj.color, 0.60);
      ctx.restore();
    }

    // ── Layer 2: edge-glow outline (re-draw at lower opacity for rim) ─────
    for (const { obj, segResult: { box } } of assignments) {
      ctx.save();
      ctx.shadowColor = obj.color;
      ctx.shadowBlur = 35;
      ctx.globalAlpha = 0.35;
      drawBodySilhouette(ctx, box.x, box.y, box.width, box.height, obj.color, 0);
      ctx.restore();
    }

    // ── Layer 3: motion trails ────────────────────────────────────────────
    for (const obj of trackedObjects) {
      const { color, history } = obj;
      if (history.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = color + 'aa';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(history[0].x, history[0].y);
      for (let i = 1; i < history.length; i++) ctx.lineTo(history[i].x, history[i].y);
      ctx.stroke();
    }

    // ── Layer 4: centroid crosshair + ID label ────────────────────────────
    for (const obj of trackedObjects) {
      if (obj.missedFrames > 0) continue;
      const { color, box, id } = obj;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy);
      ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy + 16);
      ctx.stroke();
      ctx.restore();

      const label = `ID:${id}`;
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      const tw = ctx.measureText(label).width;
      const lx = cx - tw / 2 - 4;
      const ly = box.y - 24;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color + 'ee';
      ctx.fillRect(lx, ly, tw + 8, 19);
      ctx.restore();
      ctx.fillStyle = '#000';
      ctx.fillText(label, lx + 4, ly + 13);
    }
  }
}
