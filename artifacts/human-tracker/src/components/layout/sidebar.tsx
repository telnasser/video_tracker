import { Link, useLocation } from 'wouter';
import { Activity, History, ShieldAlert, Cpu, Film } from 'lucide-react';

export function Sidebar() {
  const [location] = useLocation();

  const links = [
    { href: '/', label: 'Live Monitor', icon: Activity },
    { href: '/video', label: 'Video Analysis', icon: Film },
    { href: '/history', label: 'History Logs', icon: History },
  ];

  return (
    <aside className="w-64 border-r border-border bg-card/50 backdrop-blur-md flex flex-col h-screen shrink-0 hidden md:flex relative z-20">
      <div className="p-6 border-b border-border flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary flex items-center justify-center relative overflow-hidden">
          <ShieldAlert className="w-5 h-5 text-primary relative z-10" />
          <div className="absolute inset-0 bg-primary/20 animate-pulse"></div>
        </div>
        <div>
          <h1 className="font-mono font-bold text-lg text-primary tracking-tight uppercase">Aegis</h1>
          <p className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest">Motion Tracking</p>
        </div>
      </div>

      <nav className="flex-1 py-6 flex flex-col gap-2 px-4">
        <div className="text-xs font-mono text-muted-foreground mb-2 px-2">MODULES</div>
        {links.map(({ href, label, icon: Icon }) => {
          const active = location === href;
          return (
            <Link 
              key={href} 
              href={href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-md font-mono text-sm transition-all
                ${active 
                  ? 'bg-primary/10 text-primary border border-primary/30 shadow-[0_0_15px_rgba(0,255,204,0.1)]' 
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent'}
              `}
            >
              <Icon className="w-4 h-4" />
              {label}
              {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_5px_currentColor]"></div>}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 m-4 rounded-lg border border-border bg-background/50 relative overflow-hidden group">
        <div className="absolute -inset-2 bg-primary/5 blur-xl group-hover:bg-primary/10 transition-colors"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-primary" />
            <span className="text-xs font-mono font-bold text-foreground">SYSTEM STATUS</span>
          </div>
          <div className="space-y-2 font-mono text-[10px] text-muted-foreground">
            <div className="flex justify-between">
              <span>CORE</span>
              <span className="text-primary">ONLINE</span>
            </div>
            <div className="flex justify-between">
              <span>MODEL</span>
              <span>DETR</span>
            </div>
            <div className="flex justify-between">
              <span>RUNTIME</span>
              <span>ONNX RUNTIME</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
