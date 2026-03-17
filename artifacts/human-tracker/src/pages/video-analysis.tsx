import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Play, Pause, RotateCcw, Film, Users, Activity, Crosshair, ChevronLeft, ChevronRight } from 'lucide-react';
import { YOLODetector } from '@/lib/yolo';
import { CentroidTracker } from '@/lib/tracker';
import { useCreateDetection } from '@workspace/api-client-react';

const FRAME_SAMPLE_INTERVAL = 6;

interface FrameResult {
  frameIndex: number;
  timestamp: number;
  personCount: number;
  imageDataUrl: string;
}

export default function VideoAnalysis() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number>();
  const detectorRef = useRef<YOLODetector | null>(null);
  const trackerRef = useRef<CentroidTracker>(new CentroidTracker(10, 120));
  const isRunningRef = useRef(false);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentPersonCount, setCurrentPersonCount] = useState(0);
  const [peakPersonCount, setPeakPersonCount] = useState(0);
  const [totalFramesAnalyzed, setTotalFramesAnalyzed] = useState(0);
  const [frameResults, setFrameResults] = useState<FrameResult[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<FrameResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const createDetection = useCreateDetection();

  const loadModel = useCallback(async () => {
    if (detectorRef.current) return;
    setIsModelLoading(true);
    setModelError(null);
    try {
      const detector = new YOLODetector({ confThreshold: 0.45 });
      await detector.load();
      detectorRef.current = detector;
    } catch (err) {
      setModelError('Failed to load detection model.');
      console.error(err);
    } finally {
      setIsModelLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModel();
    const offscreen = document.createElement('canvas');
    offscreenRef.current = offscreen;
  }, [loadModel]);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    setProgress(0);
    setCurrentPersonCount(0);
    setPeakPersonCount(0);
    setTotalFramesAnalyzed(0);
    setFrameResults([]);
    setSelectedFrame(null);
    setIsSaved(false);
    setIsAnalyzing(false);
    setIsPaused(false);
    trackerRef.current = new CentroidTracker(10, 120);
  }, [videoUrl]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const drawOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    trackedObjects: ReturnType<CentroidTracker['update']>
  ) => {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const obj of trackedObjects) {
      if (obj.missedFrames > 0) continue;
      const { x, y, width, height, confidence, trackId } = obj.box;
      const color = obj.color;

      // Trail
      if (obj.history.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = `${color}66`;
        ctx.lineWidth = 2;
        ctx.moveTo(obj.history[0].x, obj.history[0].y);
        for (let i = 1; i < obj.history.length; i++) {
          ctx.lineTo(obj.history[i].x, obj.history[i].y);
        }
        ctx.stroke();
      }

      // Box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);

      // Corner accents
      const cl = 12;
      ctx.lineWidth = 3;
      [[x, y, x + cl, y, x, y + cl], [x + width - cl, y, x + width, y, x + width, y + cl],
       [x, y + height - cl, x, y + height, x + cl, y + height],
       [x + width - cl, y + height, x + width, y + height, x + width, y + height - cl]]
        .forEach(([ax, ay, bx, by, cx2, cy]) => {
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx2, cy); ctx.stroke();
        });

      // Label
      const label = `ID:${trackId}  ${(confidence * 100).toFixed(0)}%`;
      ctx.font = 'bold 12px monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 18, tw + 8, 18);
      ctx.fillStyle = '#000';
      ctx.fillText(label, x + 4, y - 4);
    }
  }, []);

  // Seek the video to a specific time and wait for it to be ready
  const seekTo = (video: HTMLVideoElement, time: number) =>
    new Promise<void>(resolve => {
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;
    });

  const analyzeVideo = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !detectorRef.current) return;

    // Mark as running via ref so the loop can check without stale closure issues
    isRunningRef.current = true;
    setIsAnalyzing(true);
    setIsPaused(false);
    setProgress(0);
    setFrameResults([]);
    setSelectedFrame(null);
    setIsSaved(false);
    trackerRef.current = new CentroidTracker(10, 120);

    // Seconds to advance per step (analyze one frame every ~0.2s of video)
    const STEP_SECS = FRAME_SAMPLE_INTERVAL / 30;

    let frameIndex = 0;
    let localResults: FrameResult[] = [];
    let localPeak = 0;

    // Jump to start and wait
    await seekTo(video, 0);

    while (isRunningRef.current) {
      const duration = video.duration;
      const currentTime = video.currentTime;

      if (!isFinite(duration) || currentTime >= duration - 0.05) break;

      setProgress((currentTime / duration) * 100);

      // Size canvas to match video
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;

      // Run detection on the current frame
      const detections = await detectorRef.current.detect(video);
      const tracked = trackerRef.current.update(detections);
      const ctx = canvas.getContext('2d');
      if (ctx) drawOverlay(ctx, tracked);

      const count = tracked.filter(o => o.missedFrames === 0).length;
      setCurrentPersonCount(count);
      setTotalFramesAnalyzed(f => f + 1);

      if (count > localPeak) {
        localPeak = count;
        setPeakPersonCount(count);
      }

      // Capture a thumbnail for frames with people detected
      if (count > 0 && localResults.length < 50) {
        const snap = document.createElement('canvas');
        snap.width = canvas.width;
        snap.height = canvas.height;
        const snapCtx = snap.getContext('2d');
        if (snapCtx && ctx) {
          snapCtx.drawImage(video, 0, 0, snap.width, snap.height);
          snapCtx.drawImage(canvas, 0, 0); // overlay bounding boxes
          localResults.push({
            frameIndex,
            timestamp: currentTime,
            personCount: count,
            imageDataUrl: snap.toDataURL('image/jpeg', 0.6),
          });
          setFrameResults([...localResults]);
        }
      }

      frameIndex++;

      const nextTime = currentTime + STEP_SECS;
      if (nextTime >= duration - 0.05) break;
      await seekTo(video, nextTime);
    }

    isRunningRef.current = false;
    setIsAnalyzing(false);
    setProgress(100);
  }, [drawOverlay]);

  const stopAnalysis = useCallback(() => {
    isRunningRef.current = false;
    setIsAnalyzing(false);
    setIsPaused(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const saveToHistory = useCallback(() => {
    if (frameResults.length === 0) return;
    const maxFrame = frameResults.reduce((a, b) => a.personCount > b.personCount ? a : b);
    createDetection.mutate(
      {
        data: {
          personCount: maxFrame.personCount,
          boxes: [],
        }
      },
      {
        onSuccess: () => setIsSaved(true),
        onError: (e) => console.error('Failed to save', e),
      }
    );
  }, [frameResults, createDetection]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="flex-1 p-4 md:p-6 h-screen flex flex-col relative z-10 max-w-7xl mx-auto w-full overflow-y-auto">
      <header className="mb-6 flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-2xl font-bold font-mono text-foreground flex items-center gap-2">
            <Film className="w-6 h-6 text-primary" />
            VIDEO_ANALYSIS.SYS
          </h2>
          <p className="text-muted-foreground font-mono text-xs mt-1">
            Upload a video file for offline human detection and motion tracking.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
        {/* Left: Upload + Video */}
        <div className="lg:col-span-3 flex flex-col gap-4">

          {/* Upload Drop Zone */}
          {!videoUrl && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`
                flex-1 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-4 p-12 cursor-pointer transition-colors min-h-64
                ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-white/2'}
              `}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className={`w-12 h-12 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="text-center">
                <p className="font-mono text-sm text-foreground">DROP VIDEO FILE HERE</p>
                <p className="font-mono text-xs text-muted-foreground mt-1">or click to browse — MP4, WebM, MOV supported</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileInput}
              />
            </motion.div>
          )}

          {/* Video + Canvas */}
          {videoUrl && (
            <div className="flex flex-col gap-3">
              <div className="relative bg-black border border-border rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="absolute inset-0 w-full h-full object-contain"
                  playsInline
                  muted
                  preload="auto"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                />
                {isModelLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-20">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="font-mono text-xs text-primary animate-pulse">LOADING MODEL...</p>
                  </div>
                )}
                {isAnalyzing && (
                  <div className="absolute top-3 left-3 bg-black/60 border border-primary/40 rounded px-3 py-1 font-mono text-xs text-primary flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    ANALYZING... {progress.toFixed(0)}%
                  </div>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary"
                  animate={{ width: `${progress}%` }}
                  transition={{ type: 'tween', ease: 'linear', duration: 0.3 }}
                />
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3">
                {!isAnalyzing ? (
                  <button
                    onClick={analyzeVideo}
                    disabled={isModelLoading || !!modelError}
                    className="flex items-center gap-2 px-4 py-2 font-mono text-xs font-bold bg-primary/10 text-primary border border-primary/50 rounded hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    {progress > 0 && progress < 100 ? 'RESTART_SCAN' : 'START_SCAN'}
                  </button>
                ) : (
                  <button
                    onClick={stopAnalysis}
                    className="flex items-center gap-2 px-4 py-2 font-mono text-xs font-bold bg-destructive/10 text-destructive border border-destructive/50 rounded hover:bg-destructive/20 transition-colors"
                  >
                    <Pause className="w-4 h-4" />
                    STOP
                  </button>
                )}

                <button
                  onClick={() => {
                    setVideoUrl(null);
                    setVideoFile(null);
                    setProgress(0);
                    setFrameResults([]);
                    setSelectedFrame(null);
                    setCurrentPersonCount(0);
                    setPeakPersonCount(0);
                    setTotalFramesAnalyzed(0);
                    setIsAnalyzing(false);
                    setIsSaved(false);
                    trackerRef.current = new CentroidTracker(10, 120);
                  }}
                  className="flex items-center gap-2 px-4 py-2 font-mono text-xs text-muted-foreground border border-border rounded hover:border-primary/30 hover:text-foreground transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  NEW FILE
                </button>

                <span className="font-mono text-xs text-muted-foreground ml-auto">
                  {videoFile?.name}
                </span>
              </div>
            </div>
          )}

          {/* Frame Gallery */}
          <AnimatePresence>
            {frameResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="border border-border rounded-lg p-4 bg-card/50"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-mono text-xs text-muted-foreground flex items-center gap-2">
                    <Crosshair className="w-4 h-4 text-primary" />
                    DETECTION_SNAPSHOTS ({frameResults.length})
                  </h3>
                  {!isAnalyzing && frameResults.length > 0 && (
                    <button
                      onClick={saveToHistory}
                      disabled={isSaved}
                      className="font-mono text-xs px-3 py-1 border border-primary/50 text-primary rounded hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSaved ? '✓ SAVED_TO_LOG' : 'SAVE_TO_LOG'}
                    </button>
                  )}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {frameResults.map((fr) => (
                    <button
                      key={fr.frameIndex}
                      onClick={() => setSelectedFrame(fr)}
                      className={`shrink-0 relative rounded overflow-hidden border-2 transition-colors ${selectedFrame?.frameIndex === fr.frameIndex ? 'border-primary' : 'border-border hover:border-primary/50'}`}
                      style={{ width: 120, height: 68 }}
                    >
                      <img src={fr.imageDataUrl} alt={`Frame ${fr.frameIndex}`} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 inset-x-0 bg-black/60 font-mono text-[9px] text-primary px-1 py-0.5 flex justify-between">
                        <span>{formatTime(fr.timestamp)}</span>
                        <span>{fr.personCount}P</span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Expanded frame */}
                <AnimatePresence>
                  {selectedFrame && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-3 overflow-hidden"
                    >
                      <div className="border border-primary/30 rounded overflow-hidden relative">
                        <img src={selectedFrame.imageDataUrl} alt="Selected frame" className="w-full" />
                        <div className="absolute top-2 left-2 bg-black/70 border border-primary/40 rounded px-2 py-1 font-mono text-xs text-primary">
                          {formatTime(selectedFrame.timestamp)} · {selectedFrame.personCount} PERSON{selectedFrame.personCount !== 1 ? 'S' : ''} DETECTED
                        </div>
                        <div className="absolute top-2 right-2 flex gap-2">
                          <button
                            onClick={() => {
                              const idx = frameResults.findIndex(f => f.frameIndex === selectedFrame.frameIndex);
                              if (idx > 0) setSelectedFrame(frameResults[idx - 1]);
                            }}
                            className="bg-black/70 border border-border p-1 rounded hover:border-primary/50 transition-colors"
                          >
                            <ChevronLeft className="w-4 h-4 text-primary" />
                          </button>
                          <button
                            onClick={() => {
                              const idx = frameResults.findIndex(f => f.frameIndex === selectedFrame.frameIndex);
                              if (idx < frameResults.length - 1) setSelectedFrame(frameResults[idx + 1]);
                            }}
                            className="bg-black/70 border border-border p-1 rounded hover:border-primary/50 transition-colors"
                          >
                            <ChevronRight className="w-4 h-4 text-primary" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Stats */}
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border p-4 rounded-lg">
            <h3 className="font-mono text-xs text-muted-foreground flex items-center gap-2 mb-4">
              <Crosshair className="w-4 h-4 text-primary" />
              SCAN_TELEMETRY
            </h3>
            <div className="space-y-5">
              <div>
                <p className="font-mono text-[10px] text-muted-foreground mb-1">CURRENT SUBJECTS</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-4xl font-bold text-primary">{currentPersonCount}</span>
                  <span className="font-mono text-xs text-muted-foreground">ENTITIES</span>
                </div>
              </div>
              <div>
                <p className="font-mono text-[10px] text-muted-foreground mb-1">PEAK DETECTED</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold text-foreground">{peakPersonCount}</span>
                  <span className="font-mono text-xs text-muted-foreground">MAX</span>
                </div>
              </div>
              <div>
                <p className="font-mono text-[10px] text-muted-foreground mb-1">FRAMES ANALYZED</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold text-foreground">{totalFramesAnalyzed}</span>
                  <span className="font-mono text-xs text-muted-foreground">SCANS</span>
                </div>
              </div>
              <div>
                <p className="font-mono text-[10px] text-muted-foreground mb-1">SCAN PROGRESS</p>
                <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-primary"
                    animate={{ width: `${progress}%` }}
                    transition={{ type: 'tween', ease: 'linear', duration: 0.3 }}
                  />
                </div>
                <p className="font-mono text-[10px] text-muted-foreground mt-1">{progress.toFixed(1)}%</p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-4 rounded-lg flex-1">
            <h3 className="font-mono text-xs text-muted-foreground flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-primary" />
              DETECTION_LOG
            </h3>
            {frameResults.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground font-mono text-xs text-center border border-dashed border-border/50 rounded">
                NO DATA<br/>YET
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {[...frameResults].reverse().slice(0, 20).map((fr) => (
                  <button
                    key={fr.frameIndex}
                    onClick={() => setSelectedFrame(fr)}
                    className={`w-full flex items-center justify-between p-2 rounded text-left transition-colors border ${selectedFrame?.frameIndex === fr.frameIndex ? 'border-primary/50 bg-primary/5' : 'border-border/30 bg-secondary hover:border-primary/30'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Activity className="w-3 h-3 text-primary shrink-0" />
                      <span className="font-mono text-[10px]">{formatTime(fr.timestamp)}</span>
                    </div>
                    <span className="font-mono text-[10px] text-primary">{fr.personCount}P</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {modelError && (
            <div className="border border-destructive/50 bg-destructive/5 rounded p-3 font-mono text-xs text-destructive">
              {modelError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
