import { useEffect, useRef, useState, useCallback } from 'react';
import { YOLODetector } from '@/lib/yolo';
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

  const detectorRef = useRef<YOLODetector | null>(null);
  const trackerRef = useRef<CentroidTracker>(new CentroidTracker(20, 100));
  const reqRef = useRef<number>();
  const lastLogTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const framesRef = useRef<number>(0);
  
  const createDetection = useCreateDetection();

  const initCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720, facingMode: 'environment' } 
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
      setCameraError("Camera access denied or device not found.");
      return false;
    }
    return false;
  };

  const initModel = async () => {
    try {
      setIsModelLoading(true);
      const detector = new YOLODetector({ confThreshold: 0.45 });
      await detector.load();
      detectorRef.current = detector;
      setIsModelLoading(false);
    } catch (err) {
      console.error(err);
      setModelError("Failed to load YOLO model. Check console for details.");
      setIsModelLoading(false);
    }
  };

  const logDetection = useCallback((count: number, boxes: BoundingBox[]) => {
    const now = performance.now();
    if (now - lastLogTimeRef.current > LOG_INTERVAL_MS && count > 0) {
      lastLogTimeRef.current = now;
      createDetection.mutate(
        { data: { personCount: count, boxes } },
        { 
          onError: () => console.error("Failed to log detection"),
          onSuccess: () => {
            // Optional: show mini toast or just silent success
          }
        }
      );
    }
  }, [createDetection]);

  const drawOverlay = (ctx: CanvasRenderingContext2D, trackedObjects: any[]) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    for (const obj of trackedObjects) {
      if (obj.missedFrames > 0) continue; // Only draw currently visible
      
      const { x, y, width, height, confidence, trackId } = obj.box;
      const color = obj.color;

      // Draw trails
      if (obj.history.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = `${color}88`; // 50% opacity
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(obj.history[0].x, obj.history[0].y);
        for (let i = 1; i < obj.history.length; i++) {
          ctx.lineTo(obj.history[i].x, obj.history[i].y);
        }
        ctx.stroke();
      }

      // Draw Box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);

      // Draw Corners
      const cornerLen = 15;
      ctx.lineWidth = 4;
      
      // Top Left
      ctx.beginPath(); ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y); ctx.stroke();
      // Top Right
      ctx.beginPath(); ctx.moveTo(x + width - cornerLen, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + cornerLen); ctx.stroke();
      // Bottom Left
      ctx.beginPath(); ctx.moveTo(x, y + height - cornerLen); ctx.lineTo(x, y + height); ctx.lineTo(x + cornerLen, y + height); ctx.stroke();
      // Bottom Right
      ctx.beginPath(); ctx.moveTo(x + width - cornerLen, y + height); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width, y + height - cornerLen); ctx.stroke();

      // Label
      const label = `ID:${trackId} ${(confidence * 100).toFixed(0)}%`;
      ctx.fillStyle = color;
      ctx.font = '14px "Share Tech Mono"';
      const textWidth = ctx.measureText(label).width;
      
      ctx.fillRect(x, y - 20, textWidth + 8, 20);
      ctx.fillStyle = '#000';
      ctx.fillText(label, x + 4, y - 5);
      
      // Target Reticle
      const cx = x + width / 2;
      const cy = y + height / 2;
      ctx.beginPath();
      ctx.strokeStyle = `${color}44`;
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.moveTo(cx - 15, cy); ctx.lineTo(cx + 15, cy);
      ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy + 15);
      ctx.stroke();
    }
  };

  const processFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !detectorRef.current || !isActive) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        try {
          const detections = await detectorRef.current.detect(video);
          const trackedObjects = trackerRef.current.update(detections);
          
          drawOverlay(ctx, trackedObjects);
          
          const visibleCount = trackedObjects.filter(o => o.missedFrames === 0).length;
          
          // FPS Calculation
          framesRef.current++;
          const now = performance.now();
          if (now - lastFrameTimeRef.current >= 1000) {
            setCurrentStats(s => ({ ...s, fps: framesRef.current }));
            framesRef.current = 0;
            lastFrameTimeRef.current = now;
          }
          
          setCurrentStats(s => ({ ...s, personCount: visibleCount }));
          logDetection(visibleCount, detections.map((d, i) => ({ ...d, trackId: trackedObjects.find(o => o.box.confidence === d.confidence)?.id || 0 })));

        } catch (e) {
          console.error("Inference error:", e);
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
    setIsActive
  };
}
