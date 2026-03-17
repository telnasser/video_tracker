import { useGetDetections, useGetDetectionStats } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { Database, TrendingUp, Users, Target, Activity } from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar 
} from 'recharts';

export default function History() {
  const { data: detections, isLoading: isLoadingList } = useGetDetections({ limit: 100 });
  const { data: stats, isLoading: isLoadingStats } = useGetDetectionStats();

  if (isLoadingList || isLoadingStats) {
    return (
      <div className="flex-1 p-6 flex items-center justify-center relative z-10">
        <div className="flex flex-col items-center gap-4 text-primary">
          <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          <span className="font-mono text-sm tracking-widest animate-pulse">QUERYING DATABANKS...</span>
        </div>
      </div>
    );
  }

  const chartData = stats?.recentActivity?.map(item => ({
    time: format(new Date(item.hour), 'HH:mm'),
    count: item.count
  })) || [];

  return (
    <div className="flex-1 p-4 md:p-6 h-screen flex flex-col relative z-10 max-w-7xl mx-auto w-full overflow-y-auto">
      <header className="mb-8 flex justify-between items-end shrink-0">
        <div>
          <h2 className="text-2xl font-bold font-mono text-foreground flex items-center gap-2">
            <Database className="w-6 h-6 text-primary" />
            DATABANKS.SYS
          </h2>
          <p className="text-muted-foreground font-mono text-xs mt-1">
            Historical threat detection and spatial telemetry logs.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 shrink-0">
        {[
          { label: "TOTAL LOGS", value: stats?.totalDetections || 0, icon: Target },
          { label: "ENTITIES SCANNED", value: stats?.totalPersonsDetected || 0, icon: Users },
          { label: "PEAK CAPACITY", value: stats?.maxPersonsDetected || 0, icon: TrendingUp },
          { label: "AVG / SCAN", value: (stats?.averagePersonsPerDetection || 0).toFixed(1), icon: Activity },
        ].map((stat, i) => (
          <div key={i} className="bg-card border border-border p-5 rounded-lg hover-elevate group">
            <div className="flex justify-between items-start mb-2">
              <span className="font-mono text-[10px] text-muted-foreground">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-primary/50 group-hover:text-primary transition-colors" />
            </div>
            <div className="font-mono text-3xl font-bold text-foreground group-hover:text-primary transition-colors">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[400px]">
        
        {/* Chart */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-5 flex flex-col">
          <h3 className="font-mono text-xs text-muted-foreground mb-6 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            TEMPORAL_ACTIVITY_MATRIX
          </h3>
          <div className="flex-1 w-full h-full min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={10} 
                  fontFamily="'Share Tech Mono', monospace"
                  tickLine={false}
                  axisLine={false}
                  dy={10}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={10} 
                  fontFamily="'Share Tech Mono', monospace"
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    borderColor: 'hsl(var(--border))',
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: '12px'
                  }}
                  itemStyle={{ color: 'hsl(var(--primary))' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="count" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorCount)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Detections List */}
        <div className="bg-card border border-border rounded-lg flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border shrink-0">
            <h3 className="font-mono text-xs text-muted-foreground flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              RAW_DETECTION_FEED
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {detections?.length === 0 ? (
              <div className="text-center p-8 font-mono text-xs text-muted-foreground">
                NO DATA FOUND IN ARCHIVES
              </div>
            ) : (
              detections?.map((det) => (
                <div key={det.id} className="p-3 bg-secondary rounded border border-border/50 flex flex-col gap-2 hover:border-primary/50 transition-colors">
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-xs text-primary">ID: {det.id.toString().padStart(6, '0')}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {format(new Date(det.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                    </span>
                  </div>
                  <div className="flex justify-between items-end">
                    <span className="font-mono text-sm text-foreground">
                      {det.personCount} Entities
                    </span>
                    <span className="font-mono text-[10px] px-2 py-1 bg-background rounded-sm text-muted-foreground">
                      {det.boxes.length} BBOXES
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
