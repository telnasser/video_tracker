import { useEffect, useRef, useState, useCallback } from 'react';
import { BodyPixSegmentor } from '@/lib/segmentation';
import { CentroidTracker, BoundingBox } from '@/lib/tracker';
import { useCreateDetection } from '@workspace/api-client-react';

const LOG_INTERVAL_MS = 5000;

export function useLiveDetection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isModelLoading, setIsModelLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [currentStats, setCurrentStats] = useState({ fps: 0, personCount: 0 });

  const segmentorRef = useRef<BodyPixSegmentor | null>(null);
  const trackerRef = useRef<CentroidTracker>(new CentroidTracker(20, 100));
  const reqRef = useRef<number>();
  const lastLogTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const framesRef = useRef<number>(0);

  const createDetection = useCreateDetection();

  const initCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'environment' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise(resolve => {
          if (videoRef.current) videoRef.current.onloadedmetadata = resolve;
        });
        videoRef.current.play();
        return true;
      }
    } catch (err) {
      console.error(err);
      setCameraError('Camera access denied or device not found.');
      return false;
    }
    return false;
  };

  const initModel = async () => {
    try {
      setIsModelLoading(true);
      const seg = new BodyPixSegmentor();
      await seg.load();
      segmentorRef.current = seg;
      setIsModelLoading(false);
    } catch (err) {
      console.error(err);
      setModelError('Failed to load segmentation model. Check console for details.');
      setIsModelLoading(false);
    }
  };

  const logDetection = useCallback(
    (count: number, boxes: BoundingBox[]) => {
      const now = performance.now();
      if (now - lastLogTimeRef.current > LOG_INTERVAL_MS && count > 0) {
        lastLogTimeRef.current = now;
        createDetection.mutate(
          { data: { personCount: count, boxes } },
          { onError: () => console.error('Failed to log detection') }
        );
      }
    },
    [createDetection]
  );

  const processFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !segmentorRef.current || !isActive) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        try {
          const segs = await segmentorRef.current.segment(video);
          const segResults = segmentorRef.current.extractBoxesWithIndex(segs);
          const trackedObjects = trackerRef.current.update(segResults.map(r => r.box));

          segmentorRef.current.drawSegmentedOverlay(ctx, segs, segResults, trackedObjects);

          const visibleCount = trackedObjects.filter(o => o.missedFrames === 0).length;

          framesRef.current++;
          const now = performance.now();
          if (now - lastFrameTimeRef.current >= 1000) {
            setCurrentStats(s => ({ ...s, fps: framesRef.current }));
            framesRef.current = 0;
            lastFrameTimeRef.current = now;
          }

          setCurrentStats(s => ({ ...s, personCount: visibleCount }));
          logDetection(
            visibleCount,
            trackedObjects
              .filter(o => o.missedFrames === 0)
              .map(o => ({ ...o.box }))
          );
        } catch (e) {
          console.error('Inference error:', e);
        }
      }
    }

    if (isActive) {
      reqRef.current = requestAnimationFrame(processFrame);
    }
  }, [isActive, logDetection]);

  useEffect(() => {
    initModel();
    initCamera().then(success => {
      if (success) setIsActive(true);
    });

    return () => {
      setIsActive(false);
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (isActive && !isModelLoading) {
      reqRef.current = requestAnimationFrame(processFrame);
    }
  }, [isActive, isModelLoading, processFrame]);

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
