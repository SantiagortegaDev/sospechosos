import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PortalClientProvider } from "@/components/interrogation/portal-client-provider";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "THE INTERROGATION ROOM // CASE_001",
  description:
    "Realtime collaborative interrogation. Two detectives, three AI suspects, one truth buried under lies. Built on Portal realtime infrastructure.",
  keywords: [
    "Portal",
    "realtime",
    "interrogation",
    "AI",
    "hackathon",
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
        className={`${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/*
         * PortalClientProvider is a Client Component that constructs the Portal
         * client on the client side. The root layout (this file) is a Server
         * Component; we can't pass a class instance across the boundary, so we
         * delegate to a wrapper that can.
         */}
        <PortalClientProvider>{children}</PortalClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
