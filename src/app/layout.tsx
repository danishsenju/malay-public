import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import { PwaRegister } from "@/components/PwaRegister";
import { InstallPrompt } from "@/components/InstallPrompt";
import { BottomNav } from "@/components/AppNav";
import { SplashScreen } from "@/components/SplashScreen";
import "./globals.css";

// Departure Mono v1.500 - Helena Zhang, SIL Open Font License 1.1
// Source: https://departuremono.com / https://github.com/rektdeckard/departure-mono
// See CREDITS.md - reserved for data: countdown digits, route codes, tickers.
const departureMono = localFont({
  src: "../fonts/DepartureMono-Regular.woff2",
  variable: "--font-departure-mono",
  display: "swap",
  preload: true,
});

// Linksans substitute (per the design-token sheet: "Substitute with Inter or
// General Sans for close geometric proportions"). Variable weights give us the
// 400 body → 800 display range the system calls for.
const linksansSub = Inter({
  subsets: ["latin"],
  variable: "--font-linksans-sub",
  display: "swap",
});

// Absolute base for OG/Twitter images - share cards must unfurl with full
// URLs on Threads/X. Set NEXT_PUBLIC_SITE_URL in production; Vercel's own
// URL is the fallback.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "TransitMY",
  description:
    "Live Malaysian transit tracker - LRT, MRT, Monorail, KTMB & Rapid buses. Real-time arrivals, journey planner, delay tracking.",
  applicationName: "TransitMY",
};

export const viewport: Viewport = {
  // Matches the masthead's linen, so the status bar blends into the page.
  // The app is light-only, so one value (no per-scheme pair) is correct.
  themeColor: "#f3f3f1",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  // Zoom is NOT disabled (maximumScale/userScalable were an accessibility
  // failure). iOS input auto-zoom is fixed at the cause instead: 16px inputs
  // on touch (globals.css).
  // cover: paint under the notch / home indicator; headers + bottom nav pad
  // themselves back out with env(safe-area-inset-*).
  viewportFit: "cover",
  // Android: the keyboard shrinks the layout viewport, so dvh layouts and
  // bottom-pinned inputs move with it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the inline script below sets data-splash on
    // <html> before React hydrates - an attribute React never rendered.
    <html
      lang="ms"
      className={`${linksansSub.variable} ${departureMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs before first paint: a session that has already seen the
            splash hides it via CSS, so it never flashes (SplashScreen.tsx). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem('transitmy:splash')==='1')document.documentElement.setAttribute('data-splash','skip')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full bg-linen-canvas text-ink-black font-sans">
        <SplashScreen />
        {children}
        <BottomNav />
        <InstallPrompt />
        <PwaRegister />
      </body>
    </html>
  );
}
