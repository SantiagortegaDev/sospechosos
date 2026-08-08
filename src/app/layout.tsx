import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PortalClientProvider } from "@/components/interrogation/portal-client-provider";

export const metadata: Metadata = {
  title: "Los Sospechosos · Interrogación en vivo",
  description:
    "Dos detectives interrogan sospechosos de IA en tiempo real y buscan contradicciones.",
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
        <PortalClientProvider>{children}</PortalClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
