"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Settings, Bell, MoreHorizontal, Download, Play, Square } from "lucide-react";
import { useAppState } from "@/lib/store";
import { apiPost, flowsToHar, downloadJson } from "@/lib/api";
import { saveRecentHar } from "@/lib/filters";

const routeNames: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/settings": "Settings",
  "/dashboard/device": "Device",
  "/dashboard/apps": "Apps",
  "/dashboard/scripts": "Scripts",
  "/dashboard/capture": "Capture",
  "/dashboard/modes": "App Modes",
  "/dashboard/har": "HAR Inspector",
  "/dashboard/terminal": "Terminal",
};

export default function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { capturing, pkg, flows, captureName, setCapturing } = useAppState();
  const currentName = routeNames[pathname] || "Dashboard";
  const isSubPage = pathname !== "/dashboard";

  async function handleCaptureToggle() {
    if (capturing) {
      setCapturing(false);
      try {
        await apiPost("/capture/stop", {});
      } catch (e: any) {
        console.error("capture toggle:", e);
        setCapturing(true); // revert on failure
      }
    } else {
      try {
        await apiPost("/capture/start", { mode: "standard", package: pkg });
        setCapturing(true);
        if (pathname !== "/dashboard/capture") {
          router.push("/dashboard/capture");
        }
      } catch (e: any) {
        console.error("capture toggle:", e);
      }
    }
  }

  function handleExport() {
    if (flows.length === 0) return;
    const har = flowsToHar(flows);
    const name = captureName || `capture_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "_")}`;
    const harFilename = `${name}.har`;
    const data = JSON.stringify(har, null, 2);
    downloadJson(har, harFilename);
    // Save to recent HARs for easy loading in HAR inspector
    saveRecentHar({
      name: harFilename,
      size: data.length,
      entryCount: flows.length,
      date: new Date().toISOString(),
      data,
    });
  }

  return (
    <nav className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-bg-secondary/50 backdrop-blur-sm shrink-0">
      {/* User badge */}
      <div className="flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-accent to-accent-light flex items-center justify-center text-white text-[11px] font-bold shadow-sm shadow-accent/20">
          {(pkg || "S")[0].toUpperCase()}
        </div>
        <span className="text-[13px] text-text-secondary font-medium max-w-[200px] truncate">
          {pkg || "sniff!"}
        </span>
        <span className="text-border-light">
          <svg width="4" height="4"><circle cx="2" cy="2" r="2" fill="currentColor" /></svg>
        </span>
      </div>

      <Bell className="h-4 w-4 text-text-muted hover:text-foreground transition-colors cursor-pointer" />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 ml-1">
        {isSubPage && (
          <Link
            href="/dashboard"
            className="text-text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <span className="text-sm font-semibold text-foreground">
          {currentName}
        </span>
        <button className="text-text-muted hover:text-foreground transition-colors cursor-pointer">
          <Settings className="h-3.5 w-3.5" />
        </button>
        <button className="text-text-muted hover:text-foreground transition-colors cursor-pointer">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1" />

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary border border-border rounded-lg px-2.5 py-1.5 hover:bg-bg-tertiary hover:text-foreground transition-colors cursor-pointer"
        >
          <Download className="h-3 w-3" />
          Download results
        </button>
        <button
          onClick={handleCaptureToggle}
          className={`flex items-center gap-1.5 text-[11px] font-semibold rounded-lg px-3 py-1.5 transition-colors cursor-pointer ${
            capturing
              ? "bg-bad/15 text-bad border border-bad/20 hover:bg-bad/25"
              : "bg-accent text-white shadow-sm shadow-accent/25 hover:bg-accent-light"
          }`}
        >
          {capturing ? (
            <>
              <Square className="h-3 w-3" />
              Stop capture
            </>
          ) : (
            <>
              <Play className="h-3 w-3" />
              Start capture
            </>
          )}
        </button>
      </div>
    </nav>
  );
}
