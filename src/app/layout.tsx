import type { Metadata } from "next";
import { Press_Start_2P, VT323, Silkscreen, Pixelify_Sans } from "next/font/google";
import "./globals.css";
import { PortalClientProvider } from "@/components/interrogation/portal-client-provider";
import { AmbientMusic } from "@/components/interrogation/ambient-music";

// Headings grandes — títulos principales (poco texto, mucho impacto)
const pressStart2P = Press_Start_2P({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Body text retro — texto corrido legible
const vt323 = VT323({
  variable: "--font-pixel-body",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Etiquetas y headers medianos — pixel font más legible que Press Start 2P
const silkscreen = Silkscreen({
  variable: "--font-pixel-label",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

// UI text moderna pixel — botones, inputs, chats
const pixelifySans = Pixelify_Sans({
  variable: "--font-pixel-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SOSPECHOSOS — The Interrogation Room",
  description:
    "Pixel art noir detective game. Interrogate a suspect. Discover the truth. Built on Portal.",
  keywords: ["Portal", "realtime", "interrogation", "pixel art", "detective", "AI"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className="dark">
      <body
        className={`${pressStart2P.variable} ${vt323.variable} ${silkscreen.variable} ${pixelifySans.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: "var(--font-pixel-ui), var(--font-pixel-body), monospace" }}
      >
        <AmbientMusic />
        <PortalClientProvider>{children}</PortalClientProvider>
      </body>
    </html>
  );
}
