import { Container, Title, Text, Stack } from '@mantine/core';
import { LandingHeroActions } from '@/components/landing/LandingHeroActions';
import { HeaderSignInButton } from '@/components/landing/HeaderSignInButton';

export default function Home() {
  return (
    <div className="relative min-h-screen bg-[#000000] flex flex-col justify-between overflow-hidden">
      
      {/* PLACEHOLDER NOTE FOR BACKGROUND IMAGES:
          Inject your absolute backdrop cinematic element or background slider engine here inside this div wrapper.
      */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40 bg-linear-to-b from-[#000000] via-[#323379]/20 to-[#000000]" />

      {/* Header Container Area - Static Server Rendered with Client Leaf Node */}
      <header className="relative z-10 w-full px-6 py-4 sm:px-12 flex justify-between items-center bg-linear-to-b from-black/80 to-transparent">
        <Title order={2} className="text-[#6366F1] font-black tracking-wider text-2xl sm:text-3xl uppercase">
          SynchroStream
        </Title>
        <HeaderSignInButton />
      </header>

      {/* Main Hero Callout Container - Static Text Layout + Hydrated Leaf Actions */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-4 max-w-4xl mx-auto">
        <Stack gap="xl">
          <Title className="text-4xl sm:text-6xl font-black text-white leading-tight tracking-tight">
            Synchronized Collaborative Film Platform
          </Title>
          <Text className="text-lg sm:text-2xl text-zinc-300 max-w-2xl mx-auto font-light">
            Watch contents in absolute real-time frame synchronization with your global peers. 
            No drift. No delays. Pure unified connection.
          </Text>

          <LandingHeroActions />
        </Stack>
      </main>

      {/* Secondary Feature Sections - 100% Server Optimized Pre-rendered Block */}
      <section className="relative z-10 bg-[#000000] border-t-8 border-zinc-900 py-16 px-6">
        <Container size="lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <Stack gap="md">
              <Title order={2} className="text-3xl sm:text-4xl font-extrabold text-white">
                Sub-Second Sync Engine
              </Title>
              <Text className="text-zinc-400 text-lg">
                Powered by our dedicated Redis state persistency layer, playheads lock securely inside 100ms drift variations. 
                If one participant stumbles, the platform auto-heals playback tracks transparently.
              </Text>
            </Stack>
            <div className="h-64 rounded-xl border border-dashed border-[#323379] bg-[#323379]/10 flex items-center justify-center">
              <Text size="sm" className="text-zinc-500 italic">[Engine Metrics Visual Panel Placeholder]</Text>
            </div>
          </div>
        </Container>
      </section>

      {/* Bottom Legal Footer Element */}
      <footer className="relative z-10 bg-[#000000] border-t-8 border-zinc-900 text-zinc-600 py-8 px-6 text-center text-sm">
        <p>© {new Date().getFullYear()} SynchroStream. All operational rights reserved.</p>
      </footer>
    </div>
  );
}