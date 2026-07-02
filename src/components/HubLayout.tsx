import React, { useState } from 'react';
import SideBar from './SideBar';
import TopBar from './TopBar';

interface HubLayoutProps {
  children: React.ReactNode;
  selectedBusinessId: string | null;
  onBusinessSelect: (id: string | null) => void;
}

export default function HubLayout({ children, selectedBusinessId, onBusinessSelect }: HubLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <SideBar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          onMenuToggle={() => setSidebarOpen(o => !o)}
          selectedBusinessId={selectedBusinessId}
          onBusinessSelect={onBusinessSelect}
        />
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <div className="max-w-[1320px] mx-auto w-full px-6 md:px-8 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
