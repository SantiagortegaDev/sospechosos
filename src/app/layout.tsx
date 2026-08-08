import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Sospechosos · Expedientes de investigación",
  description:
    "Un juego de investigación e interrogatorio con casos, pistas y contradicciones verificables.",
  keywords: [
    "realtime",
    "interrogation",
    "AI",
    "cyber-noir",
  ],
  authors: [{ name: "The Interrogation Room" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className="antialiased bg-background text-foreground"
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
