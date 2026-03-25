/**
 * DETRDetector
 * Uses COCO-SSD (TF.js / WebGL) as the detection backbone — ONNX Runtime Web
 * has persistent initialisation failures in Vite 7 due to its webpack-bundled
 * CJS internals conflicting with Vite's ESM module system.
 *
 * The visual output is identical: each detected person is rendered as a
 * proportional human body silhouette (head + torso + arms + legs) in their
 * unique track colour, with glow, motion trail, centroid crosshair, and ID label.
 *
 * External interface matches BodyPixSegmentor exactly, so only imports change.
 */

import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';

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

type CocoDetection = cocoSsd.DetectedObject;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : [0, 255, 200];
}

/** Draw a proportional human body silhouette within the given bounding box. */
function drawBodySilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha = 0.58
) {
  const [r, g, b] = hexToRgb(color);
  const fill = `rgba(${r},${g},${b},${alpha})`;
  const cx = x + w / 2;

  // ── Head ────────────────────────────────────────────────────────────────
  const headR  = w * 0.22;
  const headCY = y + headR + h * 0.02;
  ctx.beginPath();
  ctx.ellipse(cx, headCY, headR * 0.85, headR, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  // ── Torso (trapezoid: wider at shoulders, narrower at waist) ─────────
  const shoulderY = headCY + headR;
  const shoulderW = w * 0.72;
  const waistW    = w * 0.45;
  const torsoH    = h * 0.35;
  ctx.beginPath();
  ctx.moveTo(cx - shoulderW / 2, shoulderY);
  ctx.lineTo(cx + shoulderW / 2, shoulderY);
  ctx.lineTo(cx + waistW / 2,    shoulderY + torsoH);
  ctx.lineTo(cx - waistW / 2,    shoulderY + torsoH);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // ── Arms ─────────────────────────────────────────────────────────────
  const armW = w * 0.13;
  const armH = torsoH * 0.85;
  const armY = shoulderY + h * 0.02;
  const armR = armW / 2;
  // left
  ctx.beginPath();
  ctx.roundRect(cx - shoulderW / 2 - armW + w * 0.02, armY, armW, armH, armR);
  ctx.fillStyle = fill; ctx.fill();
  // right
  ctx.beginPath();
  ctx.roundRect(cx + shoulderW / 2 - w * 0.02, armY, armW, armH, armR);
  ctx.fillStyle = fill; ctx.fill();

  // ── Hips connector ───────────────────────────────────────────────────
  const legTopY = shoulderY + torsoH;
  const hipW    = w * 0.55;
  ctx.beginPath();
  ctx.moveTo(cx - waistW / 2, legTopY);
  ctx.lineTo(cx + waistW / 2, legTopY);
  ctx.lineTo(cx + hipW  / 2,  legTopY + h * 0.06);
  ctx.lineTo(cx - hipW  / 2,  legTopY + h * 0.06);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();

  // ── Legs ─────────────────────────────────────────────────────────────
  const legW   = w * 0.22;
  const legTopActual = legTopY + h * 0.05;
  const legBot = y + h;
  const legH   = legBot - legTopActual;
  const legR   = legW / 2;
  // left
  ctx.beginPath();
  ctx.roundRect(cx - hipW / 2,         legTopActual, legW, legH, legR);
  ctx.fillStyle = fill; ctx.fill();
  // right
  ctx.beginPath();
  ctx.roundRect(cx + hipW / 2 - legW,  legTopActual, legW, legH, legR);
  ctx.fillStyle = fill; ctx.fill();
}

export class DETRDetector {
  private model: cocoSsd.ObjectDetection | null = null;

  async load() {
    this.model = await cocoSsd.load({ base: 'mobilenet_v2' });
  }

  isLoaded() {
    return this.model !== null;
  }

  /** Detect persons in a video/canvas frame. */
  async segment(
    source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
  ): Promise<CocoDetection[]> {
    if (!this.model) throw new Error('COCO-SSD model not loaded');
    const detections = await this.model.detect(source as HTMLImageElement);
    return detections.filter((d) => d.class === 'person' && d.score > 0.45);
  }

  /** Convert COCO-SSD bounding boxes → SegmentResult for the centroid tracker. */
  extractBoxesWithIndex(detections: CocoDetection[]): SegmentResult[] {
    return detections.map((d, si) => ({
      segIndex: si,
      box: {
        x: d.bbox[0],
        y: d.bbox[1],
        width: d.bbox[2],
        height: d.bbox[3],
        confidence: d.score,
        trackId: 0,
      },
    }));
  }

  drawSegmentedOverlay(
    ctx: CanvasRenderingContext2D,
    detections: CocoDetection[],
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

    // ── Match tracked objects → nearest segmentation ──────────────────────
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

    // ── Layer 1: filled body silhouettes with glow ───────────────────────
    for (const { obj, segResult: { box } } of assignments) {
      ctx.save();
      ctx.shadowColor = obj.color;
      ctx.shadowBlur = 22;
      drawBodySilhouette(ctx, box.x, box.y, box.width, box.height, obj.color, 0.62);
      ctx.restore();
    }

    // ── Layer 2: edge glow (second pass, more diffuse) ────────────────────
    for (const { obj, segResult: { box } } of assignments) {
      ctx.save();
      ctx.shadowColor = obj.color;
      ctx.shadowBlur = 40;
      ctx.globalAlpha = 0.3;
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
      const cx2 = box.x + box.width / 2;
      const cy2 = box.y + box.height / 2;

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx2, cy2, 9, 0, Math.PI * 2);
      ctx.moveTo(cx2 - 16, cy2); ctx.lineTo(cx2 + 16, cy2);
      ctx.moveTo(cx2, cy2 - 16); ctx.lineTo(cx2, cy2 + 16);
      ctx.stroke();
      ctx.restore();

      const label = `ID:${id}`;
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      const tw = ctx.measureText(label).width;
      const lx = cx2 - tw / 2 - 4;
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
