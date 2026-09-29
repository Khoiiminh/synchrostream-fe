import { Container, Title, Text, Stack } from '@mantine/core';
import { LandingHeroActions } from '@/components/landing/LandingHeroActions';
import { HeaderSignInButton } from '@/components/landing/HeaderSignInButton';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#06060A] py-4 sm:py-6 px-2 sm:px-4">
      {/* Framed cinematic screen — glass edge sheen makes it read as a pane of glass, not a flat panel */}
      <div
        className="relative w-full overflow-hidden rounded-[28px] sm:rounded-[36px] bg-[#0A0A12]/95 backdrop-blur-xl ring-2 ring-white/30"
        style={{
          boxShadow:
            'inset 0 2px 1px 0 rgba(255,255,255,0.9), inset 0 -2px 1px 0 rgba(255,255,255,0.7), inset 2px 0 1px 0 rgba(255,255,255,0.6), inset -2px 0 1px 0 rgba(255,255,255,0.6), inset 0 0 40px rgba(255,255,255,0.15), 0 40px 100px -24px rgba(0,0,0,0.95)',
        }}
      >
        {/* Top rim highlight — the thin bright line light catches on a glass edge */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-transparent via-white to-transparent" />

        {/* Bottom rim highlight */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-linear-to-r from-transparent via-white/90 to-transparent" />

        {/* LEFT & RIGHT */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-linear-to-b from-transparent via-white/80 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-0.5 bg-linear-to-b from-transparent via-white/80 to-transparent" />
        {/* Soft corner glint */}
        <div className="pointer-events-none absolute -top-8 -left-8 h-32 w-32 rounded-full bg-white/20 blur-xl" />
        <div className="pointer-events-none absolute -top-8 -right-8 h-32 w-32 rounded-full bg-white/20 blur-xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/15 blur-xl" />
        <div className="pointer-events-none absolute -bottom-8 -right-8 h-32 w-32 rounded-full bg-white/15 blur-xl" />

        {/* Ambient glow field */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[38%] h-140 w-180 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,#6366F1_0%,#3C3A8E_45%,transparent_75%)] opacity-[0.28] blur-[90px]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,#06060A_85%)]" />
        </div>

        {/* Header */}
        <header className="relative z-10 flex w-full items-center justify-between px-6 py-5 sm:px-10">
          <Title order={2} className="text-lg font-bold tracking-tight text-white sm:text-xl">
            SynchroStream
          </Title>
          <HeaderSignInButton />
        </header>

        {/* Hero */}
        <main className="relative z-10 flex min-h-130 flex-col items-center justify-center px-6 pb-28 pt-6 text-center sm:min-h-150 sm:pb-36">
          <Stack gap="lg" align="center" className="max-w-2xl">
            <Title className="text-[2.5rem] font-black leading-[1.08] tracking-tight text-white sm:text-6xl">
              Watch films together,
              <br />
              frame for frame
            </Title>
            <Text className="max-w-md text-base font-normal text-[#A1A1AE] sm:text-lg">
              Host a room, share a link, and stay in perfect sync with everyone watching —
              no drift, no delay.
            </Text>

            <LandingHeroActions />
          </Stack>
        </main>
      </div>

      {/* Feature section */}
      <section className="px-2 py-20 sm:py-28">
        <Container size="lg" px={0}>
          <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2">
            <Stack gap="sm">
              <Title order={2} className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Built on a sub-second sync engine
              </Title>
              <Text className="max-w-md text-[#9C9CA8]">
                A dedicated Redis state layer keeps every playhead within 100ms of each
                other. If someone&apos;s connection stumbles, playback heals itself —
                nobody has to hit pause and wait.
              </Text>
            </Stack>

            <div className="relative h-64 overflow-hidden rounded-3xl border border-white/8 bg-[#0A0A12]">
              <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-[#6366F1] opacity-20 blur-[70px]" />
              <div className="absolute -bottom-10 -right-10 h-40 w-40 rounded-full bg-[#A78BFA] opacity-20 blur-[70px]" />
              <div className="relative flex h-full items-center justify-center">
                <Text size="sm" className="text-[#6C6C78]">
                  Engine metrics visual
                </Text>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Footer */}
      <footer className="px-6 pb-10 pt-4 text-center text-sm text-[#5C5C68]">
        <p>© {new Date().getFullYear()} SynchroStream</p>
      </footer>
    </div>
  );
}