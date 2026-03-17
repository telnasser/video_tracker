import { Sidebar } from './layout/sidebar';
import { Link, useLocation } from 'wouter';
import { Activity, Film, History } from 'lucide-react';

const NAV_LINKS = [
  { href: '/', label: 'Live', icon: Activity },
  { href: '/video', label: 'Upload Video', icon: Film },
  { href: '/history', label: 'History', icon: History },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* Dynamic background effects layered behind content */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full"></div>
      </div>

      {/* Top nav bar — visible on all screen sizes */}
      <header className="relative z-30 border-b border-border bg-card/80 backdrop-blur-md flex items-center justify-between px-4 h-12 shrink-0">
        <div className="flex items-center gap-2 font-mono font-bold text-primary text-sm tracking-tight">
          <span className="w-5 h-5 rounded bg-primary/10 border border-primary flex items-center justify-center text-[10px]">A</span>
          AEGIS
        </div>
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono text-xs transition-all border
                  ${active
                    ? 'bg-primary/10 text-primary border-primary/40'
                    : 'text-muted-foreground hover:text-foreground border-transparent hover:border-border'
                  }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Main content row */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex overflow-hidden relative z-10">
          {children}
        </main>
      </div>
    </div>
  );
}
