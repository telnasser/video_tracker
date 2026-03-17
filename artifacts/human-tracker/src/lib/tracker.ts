export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  trackId: number;
}

interface TrackedObject {
  id: number;
  box: BoundingBox;
  history: { x: number; y: number }[];
  missedFrames: number;
  color: string;
}

const COLORS = [
  '#00ffcc', '#ff00ff', '#ffcc00', '#ffff00', 
  '#00ccff', '#ff3366', '#33ff33', '#cc33ff'
];

export class CentroidTracker {
  private nextObjectId: number = 1;
  private objects: Map<number, TrackedObject> = new Map();
  private maxDisappeared: number;
  private maxDistance: number;

  constructor(maxDisappeared = 15, maxDistance = 150) {
    this.maxDisappeared = maxDisappeared;
    this.maxDistance = maxDistance;
  }

  private getCentroid(box: Omit<BoundingBox, 'trackId'>) {
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    };
  }

  private calculateDistance(c1: {x: number, y: number}, c2: {x: number, y: number}) {
    return Math.sqrt(Math.pow(c1.x - c2.x, 2) + Math.pow(c1.y - c2.y, 2));
  }

  public update(rects: Omit<BoundingBox, 'trackId'>[]): TrackedObject[] {
    if (rects.length === 0) {
      // Increment missed frames for all tracked objects
      for (const [id, obj] of this.objects.entries()) {
        obj.missedFrames++;
        if (obj.missedFrames > this.maxDisappeared) {
          this.objects.delete(id);
        }
      }
      return Array.from(this.objects.values());
    }

    const inputCentroids = rects.map(r => this.getCentroid(r));

    if (this.objects.size === 0) {
      for (let i = 0; i < rects.length; i++) {
        this.register(rects[i], inputCentroids[i]);
      }
    } else {
      const objectIds = Array.from(this.objects.keys());
      const objectCentroids = objectIds.map(id => this.getCentroid(this.objects.get(id)!.box));

      // Calculate distance matrix
      const D: number[][] = [];
      for (let i = 0; i < objectCentroids.length; i++) {
        D[i] = [];
        for (let j = 0; j < inputCentroids.length; j++) {
          D[i][j] = this.calculateDistance(objectCentroids[i], inputCentroids[j]);
        }
      }

      const usedRows = new Set<number>();
      const usedCols = new Set<number>();

      // Simple greedy matching
      while (usedRows.size < objectCentroids.length && usedCols.size < inputCentroids.length) {
        let minVal = Infinity;
        let minRow = -1;
        let minCol = -1;

        for (let i = 0; i < D.length; i++) {
          if (usedRows.has(i)) continue;
          for (let j = 0; j < D[i].length; j++) {
            if (usedCols.has(j)) continue;
            if (D[i][j] < minVal) {
              minVal = D[i][j];
              minRow = i;
              minCol = j;
            }
          }
        }

        if (minRow === -1 || minVal > this.maxDistance) break;

        const objectId = objectIds[minRow];
        const obj = this.objects.get(objectId)!;
        
        // Update object
        const centroid = inputCentroids[minCol];
        obj.history.push({ ...centroid });
        if (obj.history.length > 30) obj.history.shift(); // Keep last 30 points
        
        obj.box = { ...rects[minCol], trackId: objectId };
        obj.missedFrames = 0;

        usedRows.add(minRow);
        usedCols.add(minCol);
      }

      // Handle unmatched existing objects
      for (let i = 0; i < objectCentroids.length; i++) {
        if (!usedRows.has(i)) {
          const id = objectIds[i];
          const obj = this.objects.get(id)!;
          obj.missedFrames++;
          if (obj.missedFrames > this.maxDisappeared) {
            this.objects.delete(id);
          }
        }
      }

      // Handle unmatched new input detections
      for (let i = 0; i < inputCentroids.length; i++) {
        if (!usedCols.has(i)) {
          this.register(rects[i], inputCentroids[i]);
        }
      }
    }

    return Array.from(this.objects.values());
  }

  private register(rect: Omit<BoundingBox, 'trackId'>, centroid: {x: number, y: number}) {
    this.objects.set(this.nextObjectId, {
      id: this.nextObjectId,
      box: { ...rect, trackId: this.nextObjectId },
      history: [{ ...centroid }],
      missedFrames: 0,
      color: COLORS[this.nextObjectId % COLORS.length]
    });
    this.nextObjectId++;
  }
}
