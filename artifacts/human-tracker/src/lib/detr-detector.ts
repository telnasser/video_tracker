/**
 * DETRDetector — pixel-perfect body segmentation via BodyPix MobileNetV1.
 *
 * Uses `@tensorflow-models/body-pix` (TF.js / WebGL) to produce a per-pixel
 * binary mask for each detected person.  Every foreground pixel of the mask is
 * painted with the person's unique track colour, giving an exact body-shape
 * overlay rather than a generic silhouette or bounding box.
 *
 * External interface is identical to the previous detectors so nothing in
 * use-live-detection.ts or video-analysis.tsx needs to change.
 */

import * as bodyPix from '@tensorflow-models/body-pix';
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

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 255, 200];
}

export class DETRDetector {
  private net: bodyPix.BodyPix | null = null;

  async load() {
    this.net = await bodyPix.load({
      architecture: 'MobileNetV1',
      outputStride: 16,
      multiplier: 0.75,
      quantBytes: 2,
    });
  }

  isLoaded() {
    return this.net !== null;
  }

  /** Segment every person in the current frame; returns one mask per person. */
  async segment(
    source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
  ): Promise<bodyPix.PersonSegmentation[]> {
    if (!this.net) throw new Error('BodyPix model not loaded');
    return this.net.segmentMultiPerson(source, {
      flipHorizontal: false,
      internalResolution: 'low',       // fastest inference; mask is still per-pixel
      segmentationThreshold: 0.6,
      maxDetections: 10,
      scoreThreshold: 0.3,
      nmsRadius: 20,
    });
  }

  /** Derive axis-aligned bounding boxes from pixel masks for the centroid tracker. */
  extractBoxesWithIndex(segs: bodyPix.PersonSegmentation[]): SegmentResult[] {
    const results: SegmentResult[] = [];
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      let minX = seg.width, minY = seg.height, maxX = 0, maxY = 0, found = false;
      for (let i = 0; i < seg.data.length; i++) {
        if (seg.data[i] === 1) {
          found = true;
          const px = i % seg.width;
          const py = Math.floor(i / seg.width);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
      if (!found) continue;
      results.push({
        segIndex: si,
        box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY, confidence: 0.9, trackId: 0 },
      });
    }
    return results;
  }

  drawSegmentedOverlay(
    ctx: CanvasRenderingContext2D,
    segs: bodyPix.PersonSegmentation[],
    segResults: SegmentResult[],
    trackedObjects: Array<{
      id: number;
      box: DetectionBox;
      history: { x: number; y: number }[];
      missedFrames: number;
      color: string;
    }>
  ) {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);

    // ── Match each visible tracked object to its nearest segmentation ────
    const usedSegs = new Set<number>();
    const assignments: Array<{ obj: typeof trackedObjects[0]; segIndex: number }> = [];

    for (const obj of trackedObjects) {
      if (obj.missedFrames > 0) continue;
      const ox = obj.box.x + obj.box.width / 2;
      const oy = obj.box.y + obj.box.height / 2;
      let bestSeg = -1, bestDist = Infinity;
      for (const { box, segIndex } of segResults) {
        if (usedSegs.has(segIndex)) continue;
        const d = Math.hypot(ox - (box.x + box.width / 2), oy - (box.y + box.height / 2));
        if (d < bestDist) { bestDist = d; bestSeg = segIndex; }
      }
      if (bestSeg >= 0) { usedSegs.add(bestSeg); assignments.push({ obj, segIndex: bestSeg }); }
    }

    // ── Layer 1: pixel-perfect filled mask ───────────────────────────────
    // Walk every pixel of each person's binary mask and paint it with their
    // unique colour at ~67 % opacity — exact body shape, no approximation.
    if (assignments.length > 0) {
      const imageData = ctx.createImageData(width, height);

      for (const { obj, segIndex } of assignments) {
        const seg = segs[segIndex];
        const [r, g, b] = hexToRgb(obj.color);

        // BodyPix mask may be at a lower resolution than the canvas; scale.
        const scaleX = width  / seg.width;
        const scaleY = height / seg.height;
        const needsScale = scaleX !== 1 || scaleY !== 1;

        if (needsScale) {
          for (let my = 0; my < seg.height; my++) {
            for (let mx = 0; mx < seg.width; mx++) {
              if (seg.data[my * seg.width + mx] !== 1) continue;
              const cx = Math.round(mx * scaleX);
              const cy = Math.round(my * scaleY);
              if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
              const pidx = (cy * width + cx) * 4;
              imageData.data[pidx]     = r;
              imageData.data[pidx + 1] = g;
              imageData.data[pidx + 2] = b;
              imageData.data[pidx + 3] = 172;
            }
          }
        } else {
          for (let i = 0; i < seg.data.length; i++) {
            if (seg.data[i] !== 1) continue;
            const pidx = i * 4;
            imageData.data[pidx]     = r;
            imageData.data[pidx + 1] = g;
            imageData.data[pidx + 2] = b;
            imageData.data[pidx + 3] = 172;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }

    // ── Layer 2: edge glow — redraw the mask with heavy blur for a rim effect
    if (assignments.length > 0) {
      ctx.save();
      for (const { obj, segIndex } of assignments) {
        const seg = segs[segIndex];
        const scaleX = width  / seg.width;
        const scaleY = height / seg.height;

        ctx.shadowColor = obj.color;
        ctx.shadowBlur  = 18;
        ctx.fillStyle   = obj.color + '00'; // transparent fill; only the shadow shows

        // Trace edge pixels (where mask transitions 0→1) to build the glow outline
        ctx.beginPath();
        for (let my = 1; my < seg.height - 1; my++) {
          for (let mx = 1; mx < seg.width - 1; mx++) {
            if (seg.data[my * seg.width + mx] !== 1) continue;
            // Is this pixel on the boundary?
            const right = seg.data[my * seg.width + mx + 1];
            const below = seg.data[(my + 1) * seg.width + mx];
            if (right === 0 || below === 0) {
              ctx.rect(
                Math.round(mx * scaleX),
                Math.round(my * scaleY),
                Math.max(1, Math.round(scaleX)),
                Math.max(1, Math.round(scaleY))
              );
            }
          }
        }
        ctx.fill();
      }
      ctx.restore();
    }

    // ── Layer 3: motion trails ───────────────────────────────────────────
    for (const obj of trackedObjects) {
      const { color, history } = obj;
      if (history.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = color + 'aa';
      ctx.lineWidth   = 2.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.moveTo(history[0].x, history[0].y);
      for (let i = 1; i < history.length; i++) ctx.lineTo(history[i].x, history[i].y);
      ctx.stroke();
    }

    // ── Layer 4: centroid crosshair + ID label ───────────────────────────
    for (const obj of trackedObjects) {
      if (obj.missedFrames > 0) continue;
      const { color, box, id } = obj;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur  = 6;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
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
      ctx.shadowBlur  = 8;
      ctx.fillStyle   = color + 'ee';
      ctx.fillRect(lx, ly, tw + 8, 19);
      ctx.restore();
      ctx.fillStyle = '#000';
      ctx.fillText(label, lx + 4, ly + 13);
    }
  }
}
