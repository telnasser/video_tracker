import { useEffect, useRef, useState, useCallback } from 'react';
import { DETRDetector } from '@/lib/detr-detector';
import { CentroidTracker, BoundingBox } from '@/lib/tracker';
import { ActionDetector, ActionEvent, ActionConfig } from '@/lib/action-detector';
import { useCreateDetection } from '@workspace/api-client-react';

const LOG_INTERVAL_MS = 5000;
const SEGMENT_EVERY_N = 3;

export function useLiveDetection() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isModelLoading, setIsModelLoading] = useState(true);
  const [modelError,     setModelError]     = useState<string | null>(null);
  const [cameraError,    setCameraError]    = useState<string | null>(null);
  const [isActive,       setIsActive]       = useState(false);
  const [currentStats,   setCurrentStats]   = useState({ fps: 0, personCount: 0 });
  const [actionEvents,   setActionEvents]   = useState<ActionEvent[]>([]);

  const segmentorRef    = useRef<DETRDetector | null>(null);
  const trackerRef      = useRef<CentroidTracker>(new CentroidTracker(20, 100));
  const actionDetRef    = useRef<ActionDetector>(new ActionDetector());
  const reqRef          = useRef<number>();
  const isActiveRef     = useRef(false);
  const lastLogRef      = useRef<number>(0);
  const lastFpsRef      = useRef<number>(performance.now());
  const fpsCountRef     = useRef<number>(0);
  const rafCountRef     = useRef<number>(0);
  const knownIdsRef     = useRef<Set<number>>(new Set()); // for EXITED_FRAME

  const lastSegsRef    = useRef<Awaited<ReturnType<DETRDetector['segment']>>>([]);
  const lastSrRef      = useRef<ReturnType<DETRDetector['extractBoxesWithIndex']>>([]);
  const lastTrackedRef = useRef<Parameters<DETRDetector['drawSegmentedOverlay']>[3]>([]);

  const createDetection = useCreateDetection();

  // ── Camera ───────────────────────────────────────────────────────────────
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

  // ── Model ────────────────────────────────────────────────────────────────
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

  // ── RAF loop (all mutable state via refs — no stale closures) ────────────
  const processFrame = useCallback(async () => {
    const video    = videoRef.current;
    const canvas   = canvasRef.current;
    const detector = segmentorRef.current;

    if (!isActiveRef.current || !video || !canvas || !detector) {
      if (isActiveRef.current) reqRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
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

            lastSegsRef.current    = segs;
            lastSrRef.current      = segResults;
            lastTrackedRef.current = tracked;

            // ── Action detection ────────────────────────────────────────
            const newEvents = actionDetRef.current.update(tracked, knownIdsRef.current);

            // Update knownIds to current active tracks
            const nextIds = new Set<number>();
            for (const obj of tracked) {
              if (obj.missedFrames === 0) nextIds.add(obj.id);
            }
            knownIdsRef.current = nextIds;

            if (newEvents.length > 0) {
              setActionEvents(newEvents); // parent accumulates with useEffect
            }

            // FPS
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

          detector.drawSegmentedOverlay(ctx, lastSegsRef.current, lastSrRef.current, lastTrackedRef.current);
        } catch (e) {
          console.error('Inference error:', e);
        }
      }
    }

    reqRef.current = requestAnimationFrame(processFrame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── isActive → isActiveRef sync + loop control ───────────────────────────
  useEffect(() => {
    isActiveRef.current = isActive;
    if (isActive) {
      reqRef.current = requestAnimationFrame(processFrame);
    } else {
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

  // ── Allow live config updates from the UI ─────────────────────────────────
  const setActionConfigs = useCallback((configs: ActionConfig[]) => {
    actionDetRef.current.setConfigs(configs);
  }, []);

  return {
    videoRef,
    canvasRef,
    isModelLoading,
    modelError,
    cameraError,
    currentStats,
    isActive,
    setIsActive,
    actionEvents,
    setActionConfigs,
  };
}
