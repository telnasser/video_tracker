import { useEffect, useRef, useState, useCallback } from 'react';
import { DETRDetector } from '@/lib/detr-detector';
import { CentroidTracker, BoundingBox } from '@/lib/tracker';
import { useCreateDetection } from '@workspace/api-client-react';

const LOG_INTERVAL_MS = 5000;
// Run segmentation every N animation frames (skip-frames are drawn with the
// previous result so the overlay looks smooth at full 60fps display rate).
const SEGMENT_EVERY_N = 3;

export function useLiveDetection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isModelLoading, setIsModelLoading] = useState(true);
  const [modelError,    setModelError]    = useState<string | null>(null);
  const [cameraError,   setCameraError]   = useState<string | null>(null);
  const [isActive,      setIsActive]      = useState(false);
  const [currentStats,  setCurrentStats]  = useState({ fps: 0, personCount: 0 });

  // ── Refs that the RAF loop reads directly (no stale-closure issues) ────
  const segmentorRef   = useRef<DETRDetector | null>(null);
  const trackerRef     = useRef<CentroidTracker>(new CentroidTracker(20, 100));
  const reqRef         = useRef<number>();
  const isActiveRef    = useRef(false);        // mirrors isActive state for RAF
  const lastLogRef     = useRef<number>(0);
  const lastFpsRef     = useRef<number>(performance.now());
  const fpsCountRef    = useRef<number>(0);
  const rafCountRef    = useRef<number>(0);    // throttle segmentation
  // Keep last successful segmentation so skip-frames still draw the overlay
  const lastSegsRef    = useRef<Awaited<ReturnType<DETRDetector['segment']>>>([]);
  const lastSrRef      = useRef<ReturnType<DETRDetector['extractBoxesWithIndex']>>([]);
  const lastTrackedRef = useRef<Parameters<DETRDetector['drawSegmentedOverlay']>[3]>([]);

  const createDetection = useCreateDetection();

  // ── Camera init ─────────────────────────────────────────────────────────
  const initCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'environment' },
      });
      if (!videoRef.current) return false;
      videoRef.current.srcObject = stream;
      await new Promise<void>(resolve => {
        if (videoRef.current) videoRef.current.onloadedmetadata = () => resolve();
      });
      videoRef.current.play();
      return true;
    } catch (err) {
      console.error(err);
      setCameraError('Camera access denied or device not found.');
      return false;
    }
  };

  // ── Model init ──────────────────────────────────────────────────────────
  const initModel = async () => {
    try {
      setIsModelLoading(true);
      const seg = new DETRDetector();
      await seg.load();
      segmentorRef.current = seg;
      setIsModelLoading(false);
    } catch (err) {
      console.error(err);
      setModelError('Failed to load segmentation model. Check console for details.');
      setIsModelLoading(false);
    }
  };

  // ── RAF loop — reads only from refs, never from closure state ──────────
  // This avoids stale-closure / multiple-loop bugs that occur when useCallback
  // re-creates processFrame on every isActive change and starts a second loop
  // while the first is still running.
  const processFrame = useCallback(async () => {
    const video    = videoRef.current;
    const canvas   = canvasRef.current;
    const detector = segmentorRef.current;

    if (!isActiveRef.current || !video || !canvas || !detector) {
      // Keep polling so the loop can resume without a fresh useEffect
      if (isActiveRef.current) reqRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      // Only reset canvas size when dimensions actually change (resizing clears the canvas)
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        rafCountRef.current++;
        const runSegmentation = rafCountRef.current % SEGMENT_EVERY_N === 0;

        try {
          if (runSegmentation) {
            const segs       = await detector.segment(video);
            const segResults = detector.extractBoxesWithIndex(segs);
            const tracked    = trackerRef.current.update(segResults.map(r => r.box));

            // Cache for skip-frames
            lastSegsRef.current    = segs;
            lastSrRef.current      = segResults;
            lastTrackedRef.current = tracked;

            // FPS counter (counts segmentation calls, not RAF ticks)
            fpsCountRef.current++;
            const now = performance.now();
            if (now - lastFpsRef.current >= 1000) {
              setCurrentStats(s => ({ ...s, fps: fpsCountRef.current }));
              fpsCountRef.current = 0;
              lastFpsRef.current  = now;
            }

            const visibleCount = tracked.filter(o => o.missedFrames === 0).length;
            setCurrentStats(s => ({ ...s, personCount: visibleCount }));

            // DB log
            if (now - lastLogRef.current > LOG_INTERVAL_MS && visibleCount > 0) {
              lastLogRef.current = now;
              createDetection.mutate(
                { data: { personCount: visibleCount, boxes: tracked.filter(o => o.missedFrames === 0).map(o => ({ ...o.box })) } },
                { onError: () => console.error('Failed to log detection') }
              );
            }
          }

          // Always redraw with latest (or cached) data so the overlay is smooth
          detector.drawSegmentedOverlay(
            ctx,
            lastSegsRef.current,
            lastSrRef.current,
            lastTrackedRef.current,
          );
        } catch (e) {
          console.error('Inference error:', e);
        }
      }
    }

    reqRef.current = requestAnimationFrame(processFrame);
  }, []); // ← intentionally empty deps: all mutable state accessed via refs

  // ── Keep isActiveRef in sync with isActive state ────────────────────────
  useEffect(() => {
    isActiveRef.current = isActive;
    if (isActive && !segmentorRef.current) return; // wait for model
    if (isActive) {
      // Resume: kick off the loop (it self-reschedules while isActiveRef is true)
      reqRef.current = requestAnimationFrame(processFrame);
    } else {
      // Pause: cancel the pending RAF; the next processFrame check will bail early
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    }
  }, [isActive, processFrame]);

  // ── One-time init ────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([initModel(), initCamera()]).then(([, cameraOk]) => {
      if (cameraOk) setIsActive(true);
    });

    return () => {
      isActiveRef.current = false;
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    videoRef,
    canvasRef,
    isModelLoading,
    modelError,
    cameraError,
    currentStats,
    isActive,
    setIsActive,
  };
}
