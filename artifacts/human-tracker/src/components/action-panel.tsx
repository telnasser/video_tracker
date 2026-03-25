import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, AlertTriangle, Info, Bell, BellOff, Trash2 } from 'lucide-react';
import { ActionConfig, ActionEvent, DEFAULT_ACTIONS } from '@/lib/action-detector';

interface ActionPanelProps {
  events: ActionEvent[];
  onConfigChange: (configs: ActionConfig[]) => void;
}

const MAX_EVENTS = 30;

const severityStyles = {
  info:     { icon: Info,          color: 'text-primary',     bg: 'bg-primary/10',     border: 'border-primary/30'     },
  warn:     { icon: AlertTriangle, color: 'text-yellow-400',  bg: 'bg-yellow-400/10',  border: 'border-yellow-400/30'  },
  critical: { icon: Zap,           color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30' },
};

export default function ActionPanel({ events, onConfigChange }: ActionPanelProps) {
  const [configs, setConfigs]     = useState<ActionConfig[]>(DEFAULT_ACTIONS.map(a => ({ ...a })));
  const [tab, setTab]             = useState<'events' | 'config'>('events');
  const [displayEvents, setDisplayEvents] = useState<ActionEvent[]>([]);

  // Accumulate incoming events (keep last MAX_EVENTS)
  useEffect(() => {
    if (events.length === 0) return;
    setDisplayEvents(prev => {
      const merged = [...events, ...prev].slice(0, MAX_EVENTS);
      return merged;
    });
  }, [events]);

  const toggle = (id: ActionConfig['id']) => {
    const next = configs.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c);
    setConfigs(next);
    onConfigChange(next);
  };

  const clearEvents = () => setDisplayEvents([]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };

  return (
    <div className="bg-card border border-border rounded-lg flex flex-col overflow-hidden">
      {/* Header + tabs */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0 border-b border-border/50">
        <h3 className="font-mono text-xs text-muted-foreground flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          ACTION_DETECTION
        </h3>
        <div className="flex">
          {(['events', 'config'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 font-mono text-[10px] border-b-2 transition-colors ${
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'events' ? 'EVENTS' : 'CONFIG'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'events' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Clear button */}
          <div className="flex justify-between items-center px-4 py-2 border-b border-border/30">
            <span className="font-mono text-[10px] text-muted-foreground">
              {displayEvents.length} EVENT{displayEvents.length !== 1 ? 'S' : ''} LOGGED
            </span>
            {displayEvents.length > 0 && (
              <button
                onClick={clearEvents}
                className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                CLEAR
              </button>
            )}
          </div>

          {/* Event list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-64">
            {displayEvents.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-muted-foreground font-mono text-xs text-center border border-dashed border-border/40 rounded m-2">
                NO EVENTS YET<br />
                <span className="text-[10px] mt-1 opacity-60">Enable actions in CONFIG tab</span>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {displayEvents.map(evt => {
                  const s = severityStyles[evt.severity];
                  const Icon = s.icon;
                  return (
                    <motion.div
                      key={evt.id}
                      initial={{ opacity: 0, x: -12, height: 0 }}
                      animate={{ opacity: 1, x: 0, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`flex items-start gap-2 px-3 py-2 rounded border ${s.bg} ${s.border} text-[11px] font-mono`}
                    >
                      <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${s.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold ${s.color} truncate`}>{evt.label}</div>
                        <div className="text-muted-foreground text-[9px]">
                          ID:{evt.trackId} · {formatTime(evt.timestamp)}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </div>
      )}

      {tab === 'config' && (
        <div className="p-3 space-y-2 overflow-y-auto max-h-80">
          {configs.map(cfg => {
            const s = severityStyles[cfg.severity];
            return (
              <div
                key={cfg.id}
                className={`flex items-start gap-3 p-3 rounded border transition-colors ${
                  cfg.enabled ? `${s.bg} ${s.border}` : 'bg-secondary/30 border-border/40'
                }`}
              >
                {/* Toggle */}
                <button
                  onClick={() => toggle(cfg.id)}
                  className={`mt-0.5 shrink-0 w-8 h-4 rounded-full transition-all relative ${
                    cfg.enabled ? 'bg-primary' : 'bg-muted'
                  }`}
                  title={cfg.enabled ? 'Disable' : 'Enable'}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-background transition-all ${
                      cfg.enabled ? 'left-4' : 'left-0.5'
                    }`}
                  />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    {cfg.enabled
                      ? <Bell className={`w-3 h-3 shrink-0 ${s.color}`} />
                      : <BellOff className="w-3 h-3 shrink-0 text-muted-foreground" />}
                    <span className={`font-mono text-[11px] font-bold ${cfg.enabled ? s.color : 'text-muted-foreground'}`}>
                      {cfg.label}
                    </span>
                    <span className={`ml-auto font-mono text-[9px] px-1.5 py-0.5 rounded ${s.bg} ${s.color} border ${s.border}`}>
                      {cfg.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="font-mono text-[9px] text-muted-foreground leading-snug">
                    {cfg.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
