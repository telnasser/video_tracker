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

export class YOLODetector {
  private model: cocoSsd.ObjectDetection | null = null;
  private inputWidth: number;
  private inputHeight: number;

  constructor(_config?: { confThreshold?: number }) {
    this.inputWidth = 640;
    this.inputHeight = 640;
  }

  async load() {
    if (this.model) return;
    this.model = await cocoSsd.load({
      base: 'mobilenet_v2',
    });
  }

  async detect(imageSource: HTMLVideoElement | HTMLCanvasElement): Promise<DetectionBox[]> {
    if (!this.model) throw new Error("Model not loaded");

    const predictions = await this.model.detect(imageSource);

    return predictions
      .filter(p => p.class === 'person')
      .map(p => ({
        x: p.bbox[0],
        y: p.bbox[1],
        width: p.bbox[2],
        height: p.bbox[3],
        confidence: p.score,
        trackId: 0,
      }));
  }
}
