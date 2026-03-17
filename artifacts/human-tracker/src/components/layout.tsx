import { Sidebar } from './layout/sidebar';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex overflow-hidden">
      {/* Dynamic background effects layered behind content */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full"></div>
      </div>
      
      <Sidebar />
      <main className="flex-1 flex overflow-hidden h-screen relative z-10">
        {children}
      </main>
    </div>
  );
}
