import { Title } from '@mantine/core';
import { BaseWorkspace } from '@/components/dashboard/BaseWorkspace';

export const metadata = {
  title: 'Admin Command Telemetry | SynchroStream',
};

export default function AdminDashboardPage() {
  return (
    <div className="min-h-screen bg-[#000000] text-slate-50 flex flex-col">
      <header className="w-full px-6 py-4 sm:px-12 flex justify-between items-center border-b border-zinc-900 bg-black/50 backdrop-blur">
        <Title order={3} className="text-[#4B4DB5] font-black tracking-wider text-xl uppercase">
          SynchroStream
        </Title>
      </header>

      <main className="flex-1 flex flex-col justify-center">
        <BaseWorkspace roleScope="Admin" />
      </main>
    </div>
  );
}