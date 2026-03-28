"use client";

import { useEffect, useState } from "react";
import { api, apiPost } from "@/lib/api";
import { RefreshCw, Smartphone, Wifi, Shield, Globe, Server, AlertCircle } from "lucide-react";
import type { DeviceInfo } from "@/lib/types";

export default function DevicePage() {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [startingFrida, setStartingFrida] = useState(false);
  const [clearingProxy, setClearingProxy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api("/device");
      setConnected(res.connected);
      if (res.connected) {
        setInfo(res.info);
      } else {
        setError(res.error || "Not connected");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function startFrida() {
    setStartingFrida(true);
    try {
      await apiPost("/device/frida/start", {});
      setTimeout(load, 2000);
    } catch (e: any) { setError(e.message); }
    finally { setStartingFrida(false); }
  }

  async function clearProxy() {
    setClearingProxy(true);
    try {
      await apiPost("/device/proxy/clear", {});
      setTimeout(load, 500);
    } catch (e: any) { setError(e.message); }
    finally { setClearingProxy(false); }
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Device</h2>
            <p className="text-sm text-text-muted mt-0.5">
              ADB connection, Frida server, and proxy status
            </p>
          </div>
          <button
            className="flex items-center gap-1.5 text-xs font-medium text-text-secondary border border-card-border rounded-lg px-3 py-2 hover:bg-card-hover hover:text-foreground transition-colors cursor-pointer"
            onClick={load}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center">
            <p className="text-sm text-text-muted">Loading device info...</p>
          </div>
        ) : !connected ? (
          <div className="rounded-xl border border-[#f85149]/20 bg-[#f85149]/[0.04] p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-[#f85149] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#f85149]">
                  {error || "No ADB device connected"}
                </p>
                <p className="text-sm text-text-muted mt-1.5">
                  Connect your Android device via USB and enable USB debugging.
                </p>
              </div>
            </div>
          </div>
        ) : info ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Device info card */}
            <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-text-muted" />
                Device Info
              </h3>
              <div className="space-y-3">
                {[
                  { label: "Model", value: info.Model },
                  { label: "Android", value: info.Android },
                  { label: "SDK", value: info.SDK },
                  { label: "SELinux", value: info.SELinux },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">{r.label}</span>
                    <span className="font-mono text-foreground">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Services card */}
            <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Server className="h-4 w-4 text-text-muted" />
                Services
              </h3>
              <div className="space-y-3">
                {/* Frida */}
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-text-muted">
                    <Shield className="h-3.5 w-3.5" />
                    Frida Server
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono font-medium ${info.FridaRunning ? "text-good" : "text-[#f85149]"}`}>
                      {info.FridaRunning ? "Running" : "Stopped"}
                    </span>
                    {!info.FridaRunning && (
                      <button
                        className="text-[11px] font-medium text-accent border border-accent/20 rounded-md px-2 py-0.5 hover:bg-accent/10 transition-colors cursor-pointer"
                        onClick={startFrida}
                        disabled={startingFrida}
                      >
                        {startingFrida ? "Starting..." : "Start"}
                      </button>
                    )}
                  </div>
                </div>
                {/* Proxy */}
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-text-muted">
                    <Wifi className="h-3.5 w-3.5" />
                    Proxy
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-foreground">{info.Proxy || "none"}</span>
                    {info.Proxy && (
                      <button
                        className="text-[11px] font-medium text-[#d29922] border border-[#d29922]/20 rounded-md px-2 py-0.5 hover:bg-[#d29922]/10 transition-colors cursor-pointer"
                        onClick={clearProxy}
                        disabled={clearingProxy}
                      >
                        {clearingProxy ? "Clearing..." : "Clear"}
                      </button>
                    )}
                  </div>
                </div>
                {/* Host IP */}
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-text-muted">
                    <Globe className="h-3.5 w-3.5" />
                    Host IP
                  </span>
                  <span className="font-mono text-foreground">{info.HostIP}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
