"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * GameErrorBoundary — catches React render errors and displays
 * the actual error message instead of a blank white screen.
 * This helps debug issues like React #310.
 */
export class GameErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    console.error("[GameErrorBoundary] Caught render error:", error);
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            backgroundColor: "#0a0a0f",
            color: "#d8d4c8",
            fontFamily: "'VT323', monospace",
          }}
        >
          <div
            style={{
              maxWidth: "500px",
              width: "100%",
              padding: "1.5rem",
              border: "2px solid #e74c3c",
              backgroundColor: "#0a0a0f",
            }}
          >
            <div
              style={{
                color: "#e74c3c",
                fontSize: "14px",
                fontWeight: "bold",
                letterSpacing: "0.1em",
                marginBottom: "1rem",
              }}
            >
              ERROR DE RENDER
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#ff6b6b",
                marginBottom: "0.5rem",
                wordBreak: "break-all",
                whiteSpace: "pre-wrap",
              }}
            >
              {this.state.error?.message || "Error desconocido"}
            </div>
            {this.state.error?.stack && (
              <details style={{ marginTop: "0.5rem" }}>
                <summary
                  style={{
                    color: "#888",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Stack trace
                </summary>
                <pre
                  style={{
                    fontSize: "10px",
                    color: "#666",
                    overflow: "auto",
                    maxHeight: "200px",
                    marginTop: "0.5rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              style={{
                marginTop: "1rem",
                width: "100%",
                padding: "0.75rem",
                border: "2px solid #f39c12",
                backgroundColor: "transparent",
                color: "#f39c12",
                fontFamily: "'VT323', monospace",
                fontSize: "14px",
                letterSpacing: "0.1em",
                cursor: "pointer",
              }}
            >
              RECARGAR
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
