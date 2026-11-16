"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: replaces the root layout, so it must render <html>/<body>.
 * Only used when the root layout itself throws.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("LINKFLOW global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          background: "#f6f7fb",
          color: "#0c1222",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <div
            style={{
              width: 48,
              height: 48,
              margin: "0 auto 16px",
              borderRadius: 16,
              display: "grid",
              placeItems: "center",
              background: "rgba(229,72,77,0.1)",
              border: "1px solid rgba(229,72,77,0.25)",
              color: "#e5484d",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>
            LINKFLOW could not start
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "#66708a", margin: "0 0 20px" }}>
            A fatal error interrupted rendering. Reload the page. If the problem persists, check that
            your Supabase environment variables are set correctly.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#8a93a8", margin: "0 0 16px", fontFamily: "monospace" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 12,
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "linear-gradient(135deg, #3b5bfd, #7b5cff)",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
