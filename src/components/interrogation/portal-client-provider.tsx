"use client";

/**
 * PortalClientProvider — client-only wrapper that instantiates the Portal
 * client lazily on first render.
 *
 * Why a separate client component: the Portal client is a class instance,
 * which cannot be serialized across the Server→Client component boundary.
 * The root layout (a Server Component) renders this wrapper; the wrapper,
 * being a Client Component, can safely construct `new Portal({ apiKey })`
 * inside its own render and pass the instance to `<PortalProvider>`.
 */

import { useMemo, type ReactNode } from "react";
import { Portal } from "@portalsdk/core";
import { PortalProvider } from "@portalsdk/react";

export function PortalClientProvider({ children }: { children: ReactNode }) {
  // useMemo so we get one client per mount, not per render.
  // Construction is synchronous and passive per Portal's contract.
  const client = useMemo<Portal | null>(() => {
    const apiKey = process.env.NEXT_PUBLIC_PORTAL_API_KEY;
    if (!apiKey) return null;
    return new Portal({ apiKey });
  }, []);

  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="noir-frame max-w-xl p-6">
          <div className="noir-header">
            <span>SYSTEM // CONFIG REQUIRED</span>
          </div>
          <div className="p-4 space-y-3 text-sm">
            <p className="text-foreground">
              NEXT_PUBLIC_PORTAL_API_KEY is not set. The Interrogation Room cannot
              connect to Portal realtime.
            </p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
              <li>
                Copy <code className="text-sky-500">.env.example</code> to{" "}
                <code className="text-sky-500">.env.local</code>
              </li>
              <li>
                Paste your Portal publishable key (
                <code className="text-sky-500">pk_...</code>)
              </li>
              <li>Restart <code>npm run dev</code></li>
            </ol>
            <p className="text-muted-foreground text-xs pt-2 border-t border-border">
              Get a key at{" "}
              <a
                href="https://useportal.co"
                className="text-sky-500 underline"
                target="_blank"
                rel="noreferrer"
              >
                useportal.co
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <PortalProvider client={client}>{children}</PortalProvider>;
}
