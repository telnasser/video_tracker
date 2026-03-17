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

export class BodyPixSegmentor {
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

  async segment(
    source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
  ): Promise<bodyPix.PersonSegmentation[]> {
    if (!this.net) throw new Error('BodyPix model not loaded');
    return this.net.segmentMultiPerson(source, {
      flipHorizontal: false,
      internalResolution: 'low',
      segmentationThreshold: 0.7,
      maxDetections: 10,
      scoreThreshold: 0.3,
      nmsRadius: 20,
    });
  }

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
        box: {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          confidence: 0.9,
          trackId: 0,
        },
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

    // Match each visible tracked object to the closest segmentation by centroid
    const usedSegs = new Set<number>();
    const assignments: Array<{ obj: typeof trackedObjects[0]; segIndex: number }> = [];

    for (const obj of trackedObjects) {
      if (obj.missedFrames > 0) continue;
      const ox = obj.box.x + obj.box.width / 2;
      const oy = obj.box.y + obj.box.height / 2;

      let bestSeg = -1;
      let bestDist = Infinity;
      for (const { box, segIndex } of segResults) {
        if (usedSegs.has(segIndex)) continue;
        const bx = box.x + box.width / 2;
        const by = box.y + box.height / 2;
        const d = Math.hypot(ox - bx, oy - by);
        if (d < bestDist) {
          bestDist = d;
          bestSeg = segIndex;
        }
      }
      if (bestSeg >= 0) {
        usedSegs.add(bestSeg);
        assignments.push({ obj, segIndex: bestSeg });
      }
    }

    // Layer 1: filled silhouette masks (ImageData for pixel-level control)
    if (assignments.length > 0) {
      const imageData = ctx.createImageData(width, height);
      for (const { obj, segIndex } of assignments) {
        const seg = segs[segIndex];
        const [r, g, b] = hexToRgb(obj.color);
        for (let i = 0; i < seg.data.length; i++) {
          if (seg.data[i] === 1) {
            const pidx = i * 4;
            imageData.data[pidx]     = r;
            imageData.data[pidx + 1] = g;
            imageData.data[pidx + 2] = b;
            imageData.data[pidx + 3] = 170;
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }

    // Layer 2: motion trails + labels for every tracked object (even those fading out)
    for (const obj of trackedObjects) {
      const { color, history, box, id, missedFrames } = obj;
      if (missedFrames > 0 && history.length < 2) continue;

      // Motion trail
      if (history.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = color + 'aa';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(history[0].x, history[0].y);
        for (let i = 1; i < history.length; i++) ctx.lineTo(history[i].x, history[i].y);
        ctx.stroke();
      }

      if (missedFrames > 0) continue;

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Centroid crosshair
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy);
      ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy + 16);
      ctx.stroke();

      // ID label above head
      const label = `ID:${id}`;
      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      const tw = ctx.measureText(label).width;
      const lx = cx - tw / 2 - 4;
      const ly = box.y - 22;
      ctx.fillStyle = color + 'dd';
      ctx.fillRect(lx, ly, tw + 8, 18);
      ctx.fillStyle = '#000';
      ctx.fillText(label, lx + 4, ly + 13);
    }
  }
}
