export default function ScreenshotPreview() {
  return (
    <div className="relative">
      {/* Blue glow behind */}
      <div className="absolute -inset-4 rounded-2xl bg-accent/10 blur-3xl" />

      {/* Mock browser frame */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl float-animation">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="h-3 w-3 rounded-full bg-[#f85149]" />
          <div className="h-3 w-3 rounded-full bg-[#d29922]" />
          <div className="h-3 w-3 rounded-full bg-[#3fb950]" />
          <div className="ml-4 flex-1 rounded-md bg-bg-tertiary px-3 py-1 text-xs text-text-muted font-mono">
            localhost:9090/capture
          </div>
        </div>

        {/* Screenshot content - mock capture interface */}
        <div className="p-4 bg-background">
          {/* Nav bar mock */}
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded bg-accent/30" />
              <span className="font-mono text-sm text-foreground">sniff!</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-lg bg-good/15 px-2 py-0.5 text-xs text-good">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                Capturing
              </span>
            </div>
          </div>

          {/* Flow table mock */}
          <div className="space-y-1 text-xs font-mono">
            <div className="grid grid-cols-[60px_1fr_80px_60px] gap-2 px-2 py-1 text-text-muted border-b border-border">
              <span>Method</span>
              <span>URL</span>
              <span>Status</span>
              <span>Size</span>
            </div>
            {[
              { method: "GET", url: "api.example.com/v2/user/profile", status: "200", size: "2.4K", methodColor: "text-good" },
              { method: "POST", url: "api.example.com/v2/auth/token", status: "200", size: "892B", methodColor: "text-accent-light" },
              { method: "GET", url: "cdn.example.com/assets/config.json", status: "304", size: "0B", methodColor: "text-good" },
              { method: "PUT", url: "api.example.com/v2/user/settings", status: "201", size: "1.1K", methodColor: "text-[#d29922]" },
              { method: "GET", url: "api.example.com/v2/feed/timeline", status: "200", size: "18K", methodColor: "text-good" },
              { method: "POST", url: "api.example.com/v2/analytics/event", status: "204", size: "0B", methodColor: "text-accent-light" },
              { method: "GET", url: "api.example.com/v2/notifications", status: "200", size: "4.7K", methodColor: "text-good" },
            ].map((flow, i) => (
              <div
                key={i}
                className="grid grid-cols-[60px_1fr_80px_60px] gap-2 rounded px-2 py-1.5 hover:bg-bg-tertiary transition-colors"
              >
                <span className={flow.methodColor}>{flow.method}</span>
                <span className="text-text-secondary truncate">{flow.url}</span>
                <span className="text-foreground">{flow.status}</span>
                <span className="text-text-muted">{flow.size}</span>
              </div>
            ))}
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border text-xs text-text-muted">
            <span>7 flows captured</span>
            <span>3 domains</span>
            <span className="text-good">SSL bypass active</span>
          </div>
        </div>
      </div>
    </div>
  );
}
