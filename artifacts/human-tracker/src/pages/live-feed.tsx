import { useLiveDetection } from '@/hooks/use-live-detection';
import { Camera, AlertTriangle, Play, Square, Crosshair, Users, Activity } from 'lucide-react';
import { motion } from 'framer-motion';

export default function LiveFeed() {
  const {
    videoRef,
    canvasRef,
    isModelLoading,
    modelError,
    cameraError,
    currentStats,
    isActive,
    setIsActive
  } = useLiveDetection();

  return (
    <div className="flex-1 p-4 md:p-6 h-screen flex flex-col relative z-10 max-w-7xl mx-auto w-full">
      <header className="mb-6 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold font-mono text-foreground flex items-center gap-2">
            <Camera className="w-6 h-6 text-primary" />
            LIVE_FEED.SYS
          </h2>
          <p className="text-muted-foreground font-mono text-xs mt-1">
            Real-time multi-object tracking and surveillance overlay.
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-destructive animate-pulse' : 'bg-muted'}`}></span>
            {isActive ? 'RECORDING' : 'STANDBY'}
          </div>
          <button
            onClick={() => setIsActive(!isActive)}
            disabled={isModelLoading || !!cameraError || !!modelError}
            className={`
              px-4 py-2 font-mono text-xs font-bold flex items-center gap-2 rounded-md border transition-all
              ${isActive 
                ? 'bg-destructive/10 text-destructive border-destructive/50 hover:bg-destructive/20' 
                : 'bg-primary/10 text-primary border-primary/50 hover:bg-primary/20'}
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isActive ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isActive ? 'STOP_FEED' : 'START_FEED'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
        
        <div className="lg:col-span-3 flex flex-col gap-4">
          {/* Main Video Area */}
          <div className="flex-1 relative bg-black border border-border rounded-lg overflow-hidden flex items-center justify-center shadow-2xl shadow-primary/5 cam-corners group">
            <div className="cam-corners-inner"></div>
            
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover object-center opacity-80"
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
            />
            <div className="scanlines"></div>
            
            {/* Overlays */}
            {isModelLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-30">
                <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="font-mono text-primary animate-pulse tracking-widest">LOADING NEURAL NETWORK...</p>
                <p className="font-mono text-xs text-muted-foreground mt-2">COCO-SSD MOBILENET_V2</p>
              </div>
            )}

            {(cameraError || modelError) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-destructive/10 backdrop-blur-sm z-30 text-destructive p-6 text-center">
                <AlertTriangle className="w-12 h-12 mb-4" />
                <h3 className="font-mono font-bold text-lg mb-2">SYSTEM FAILURE</h3>
                <p className="font-mono text-sm max-w-md">{cameraError || modelError}</p>
              </div>
            )}

            {!isActive && !isModelLoading && !cameraError && !modelError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-30 text-muted-foreground">
                <Camera className="w-12 h-12 mb-4 opacity-50" />
                <p className="font-mono text-sm tracking-widest">FEED OFFLINE</p>
              </div>
            )}

            {/* Crosshair Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
              <div className="w-[1px] h-full bg-primary/50"></div>
              <div className="w-full h-[1px] bg-primary/50 absolute"></div>
              <div className="w-32 h-32 border border-primary/50 rounded-full absolute"></div>
            </div>
          </div>
        </div>

        {/* Telemetry Panel */}
        <div className="flex flex-col gap-4">
          <div className="bg-card border border-border p-4 rounded-lg relative overflow-hidden hover-elevate">
            <h3 className="font-mono text-xs text-muted-foreground flex items-center gap-2 mb-4">
              <Crosshair className="w-4 h-4 text-primary" />
              TELEMETRY_DATA
            </h3>
            
            <div className="space-y-6">
              <div>
                <p className="font-mono text-[10px] text-muted-foreground mb-1">TARGETS ACQUIRED</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-4xl font-bold text-primary">{currentStats.personCount}</span>
                  <span className="font-mono text-xs text-muted-foreground">ENTITIES</span>
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] text-muted-foreground mb-1">ENGINE FPS</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold text-foreground">{currentStats.fps}</span>
                  <span className="font-mono text-xs text-muted-foreground">HZ</span>
                </div>
                <div className="w-full bg-muted h-1 mt-2 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((currentStats.fps / 60) * 100, 100)}%` }}
                    transition={{ type: 'tween', ease: 'linear', duration: 0.5 }}
                  />
                </div>
              </div>

              <div className="p-3 bg-secondary rounded border border-border/50">
                <div className="flex items-center gap-2 mb-2 text-xs font-mono">
                  <Activity className="w-3 h-3 text-primary" />
                  <span>LOG FREQUENCY</span>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Capturing snapshot every 5.0s when subjects &gt; 0. Data transmitted to central database.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border p-4 rounded-lg flex-1">
             <h3 className="font-mono text-xs text-muted-foreground flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-primary" />
              THREAT_ASSESSMENT
            </h3>
            {currentStats.personCount === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground font-mono text-xs text-center border border-dashed border-border/50 rounded">
                NO SUBJECTS<br/>DETECTED
              </div>
            ) : (
              <div className="space-y-3">
                {Array.from({ length: currentStats.personCount }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded bg-secondary border border-border/50">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
                      <span className="font-mono text-xs">SUBJECT_{i+1}</span>
                    </div>
                    <span className="font-mono text-xs text-primary">TRACKING</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
