/**
 * Action Detector
 *
 * Analyses per-person bounding box history from the centroid tracker and emits
 * discrete action events based on geometric signals:
 *
 *  Signal              What it tells us
 *  ─────────────────   ────────────────────────────────────────────────────
 *  Aspect ratio        Standing → tall (ratio < 0.65)
 *                      Sitting → moderate (0.65–1.1)
 *                      Fallen  → wide  (ratio > 1.1)
 *  Height Δ            Increasing while bottom-Y stable → STAND_UP
 *                      Decreasing while bottom-Y stable → SIT_DOWN
 *  Vertical velocity   Sudden downward surge             → FALL_DETECTED
 *  Horizontal velocity Sustained fast movement           → RUNNING
 *                      Near-zero for several frames      → STATIONARY
 *  Track lifecycle     New ID registered                 → ENTERED_FRAME
 *                      ID removed from tracker           → EXITED_FRAME
 *
 * No pose keypoints needed — BodyPix bounding boxes are sufficient.
 */

export type ActionType =
  | 'STAND_UP'
  | 'SIT_DOWN'
  | 'FALL_DETECTED'
  | 'RUNNING'
  | 'STATIONARY'
  | 'ENTERED_FRAME'
  | 'EXITED_FRAME';

export interface ActionConfig {
  id: ActionType;
  label: string;
  description: string;
  severity: 'info' | 'warn' | 'critical';
  enabled: boolean;
}

export interface ActionEvent {
  id: string;          // unique event id for React keys
  type: ActionType;
  trackId: number;
  timestamp: number;
  label: string;
  severity: 'info' | 'warn' | 'critical';
}

interface BoxSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  t: number; // timestamp ms
}

interface PersonState {
  snapshots: BoxSnapshot[];    // rolling window (last ~60 frames)
  lastAspectCategory: 'tall' | 'moderate' | 'wide' | null;
  lastAction: Partial<Record<ActionType, number>>; // debounce: last emit timestamp
  stationaryFrames: number;
}

// ── Default action configuration ──────────────────────────────────────────

export const DEFAULT_ACTIONS: ActionConfig[] = [
  {
    id: 'STAND_UP',
    label: 'Stand Up',
    description: 'Person rises from a seated or crouched position.',
    severity: 'info',
    enabled: true,
  },
  {
    id: 'SIT_DOWN',
    label: 'Sit Down',
    description: 'Person lowers into a seated or crouched position.',
    severity: 'info',
    enabled: true,
  },
  {
    id: 'FALL_DETECTED',
    label: 'Fall Detected',
    description: 'Person suddenly collapses or falls to the ground.',
    severity: 'critical',
    enabled: true,
  },
  {
    id: 'RUNNING',
    label: 'Running / Fast Movement',
    description: 'Person moves quickly across the frame.',
    severity: 'warn',
    enabled: true,
  },
  {
    id: 'STATIONARY',
    label: 'Stationary',
    description: 'Person has remained motionless for several seconds.',
    severity: 'info',
    enabled: false,
  },
  {
    id: 'ENTERED_FRAME',
    label: 'Entered Frame',
    description: 'A new person appeared in the camera view.',
    severity: 'info',
    enabled: true,
  },
  {
    id: 'EXITED_FRAME',
    label: 'Exited Frame',
    description: 'A tracked person left the camera view.',
    severity: 'info',
    enabled: true,
  },
];

// ── Tuning constants ───────────────────────────────────────────────────────

const WINDOW     = 60;             // max snapshots kept per person
const DEBOUNCE   = 3000;           // ms — minimum gap between same-type events per person
const STAT_THRESH = 25;            // frames below which we call it stationary

// Aspect ratio thresholds (width / height)
const AR_TALL    = 0.65;           // below → person is standing
const AR_WIDE    = 1.05;           // above → person may be lying / fallen

// Stand/sit: look for a relative height change >= this fraction over ~15 frames
const HEIGHT_CHANGE_THRESH = 0.22;

// Fall: vertical centroid velocity threshold (px/frame)
const FALL_VEL_THRESH = 12;

// Run: horizontal speed threshold (px/frame, averaged over recent frames)
const RUN_SPEED_THRESH = 8;

let _eventSeq = 0;
function makeId() { return `evt-${Date.now()}-${++_eventSeq}`; }

// ── Main class ─────────────────────────────────────────────────────────────

export class ActionDetector {
  private personStates = new Map<number, PersonState>();
  private configs: ActionConfig[] = DEFAULT_ACTIONS.map(a => ({ ...a }));

  setConfigs(configs: ActionConfig[]) {
    this.configs = configs;
  }

  private isEnabled(type: ActionType): boolean {
    return this.configs.find(c => c.id === type)?.enabled ?? false;
  }

  private labelOf(type: ActionType): string {
    return this.configs.find(c => c.id === type)?.label ?? type;
  }

  private severityOf(type: ActionType): 'info' | 'warn' | 'critical' {
    return this.configs.find(c => c.id === type)?.severity ?? 'info';
  }

  private canEmit(state: PersonState, type: ActionType): boolean {
    const last = state.lastAction[type] ?? 0;
    return Date.now() - last > DEBOUNCE;
  }

  private emit(state: PersonState, type: ActionType, trackId: number): ActionEvent {
    state.lastAction[type] = Date.now();
    return {
      id: makeId(),
      type,
      trackId,
      timestamp: Date.now(),
      label: this.labelOf(type),
      severity: this.severityOf(type),
    };
  }

  private getOrCreate(id: number): PersonState {
    if (!this.personStates.has(id)) {
      this.personStates.set(id, {
        snapshots: [],
        lastAspectCategory: null,
        lastAction: {},
        stationaryFrames: 0,
      });
    }
    return this.personStates.get(id)!;
  }

  /**
   * Call this every segmentation frame with the current list of tracked objects.
   * Returns any action events that fired this frame.
   */
  update(
    trackedObjects: Array<{
      id: number;
      box: { x: number; y: number; width: number; height: number };
      missedFrames: number;
    }>,
    knownIds: Set<number>
  ): ActionEvent[] {
    const events: ActionEvent[] = [];
    const currentIds = new Set<number>();

    for (const obj of trackedObjects) {
      if (obj.missedFrames > 0) continue;
      currentIds.add(obj.id);

      const isNew = !this.personStates.has(obj.id);
      const state = this.getOrCreate(obj.id);

      // ── ENTERED_FRAME ────────────────────────────────────────────────
      if (isNew && this.isEnabled('ENTERED_FRAME')) {
        events.push(this.emit(state, 'ENTERED_FRAME', obj.id));
      }

      // Record snapshot
      const { x, y, width, height } = obj.box;
      state.snapshots.push({ x, y, width, height, t: performance.now() });
      if (state.snapshots.length > WINDOW) state.snapshots.shift();

      const snaps = state.snapshots;
      if (snaps.length < 10) continue; // need enough history

      const latest = snaps[snaps.length - 1];
      const ar     = latest.width / Math.max(latest.height, 1);

      // ── Aspect-ratio category ────────────────────────────────────────
      let arCat: 'tall' | 'moderate' | 'wide';
      if      (ar < AR_TALL) arCat = 'tall';
      else if (ar > AR_WIDE) arCat = 'wide';
      else                   arCat = 'moderate';

      // ── FALL_DETECTED — aspect ratio flipped to wide AND/OR rapid vertical drop
      if (arCat === 'wide' && state.lastAspectCategory !== 'wide') {
        // Also check vertical velocity for confirmation
        const lookback = Math.min(8, snaps.length);
        const prev  = snaps[snaps.length - lookback];
        const dy    = (latest.y + latest.height / 2) - (prev.y + prev.height / 2);
        const dtSec = (latest.t - prev.t) / 1000;
        const vy    = dtSec > 0 ? dy / (lookback) : 0; // avg px per frame

        if ((vy > FALL_VEL_THRESH || ar > 1.4) && this.isEnabled('FALL_DETECTED') && this.canEmit(state, 'FALL_DETECTED')) {
          events.push(this.emit(state, 'FALL_DETECTED', obj.id));
        }
      }

      // ── STAND_UP / SIT_DOWN — height change while bottom-Y stable ────
      const lookbackSS = Math.min(20, snaps.length);
      const refSnap    = snaps[snaps.length - lookbackSS];
      const heightDelta = (latest.height - refSnap.height) / Math.max(refSnap.height, 1);
      const bottomDelta = Math.abs((latest.y + latest.height) - (refSnap.y + refSnap.height));
      const bottomStable = bottomDelta < refSnap.height * 0.25; // bottom moved <25% of body height

      if (Math.abs(heightDelta) >= HEIGHT_CHANGE_THRESH && bottomStable) {
        if (heightDelta > 0 && arCat !== 'wide' && state.lastAspectCategory !== 'tall') {
          if (this.isEnabled('STAND_UP') && this.canEmit(state, 'STAND_UP')) {
            events.push(this.emit(state, 'STAND_UP', obj.id));
          }
        } else if (heightDelta < 0 && state.lastAspectCategory === 'tall') {
          if (this.isEnabled('SIT_DOWN') && this.canEmit(state, 'SIT_DOWN')) {
            events.push(this.emit(state, 'SIT_DOWN', obj.id));
          }
        }
      }

      // ── RUNNING — sustained horizontal centroid velocity ─────────────
      const lookbackRun = Math.min(10, snaps.length);
      const refRun = snaps[snaps.length - lookbackRun];
      const cx0 = refRun.x + refRun.width / 2;
      const cx1 = latest.x + latest.width / 2;
      const dx  = Math.abs(cx1 - cx0) / lookbackRun;

      if (dx > RUN_SPEED_THRESH && this.isEnabled('RUNNING') && this.canEmit(state, 'RUNNING')) {
        events.push(this.emit(state, 'RUNNING', obj.id));
      }

      // ── STATIONARY ───────────────────────────────────────────────────
      const totalMotion = snaps.slice(-STAT_THRESH).reduce((acc, s, i, arr) => {
        if (i === 0) return acc;
        return acc + Math.abs((s.x + s.width / 2) - (arr[i - 1].x + arr[i - 1].width / 2))
                   + Math.abs((s.y + s.height / 2) - (arr[i - 1].y + arr[i - 1].height / 2));
      }, 0);
      if (snaps.length >= STAT_THRESH && totalMotion < 15) {
        state.stationaryFrames++;
        if (state.stationaryFrames === STAT_THRESH && this.isEnabled('STATIONARY') && this.canEmit(state, 'STATIONARY')) {
          events.push(this.emit(state, 'STATIONARY', obj.id));
        }
      } else {
        state.stationaryFrames = 0;
      }

      state.lastAspectCategory = arCat;
    }

    // ── EXITED_FRAME — IDs in knownIds that are no longer in currentIds ─
    for (const id of knownIds) {
      if (!currentIds.has(id)) {
        const state = this.personStates.get(id);
        if (state && this.isEnabled('EXITED_FRAME') && this.canEmit(state, 'EXITED_FRAME')) {
          events.push(this.emit(state, 'EXITED_FRAME', id));
        }
        this.personStates.delete(id);
      }
    }

    return events;
  }

  cleanup(id: number) {
    this.personStates.delete(id);
  }
}
