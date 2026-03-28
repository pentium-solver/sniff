"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Radio,
  Settings,
  Smartphone,
  AppWindow,
  FileCode,
  Layers,
  Wifi,
  ShieldOff,
  BookOpen,
  LogOut,
  LayoutDashboard,
  ExternalLink,
  FileSearch,
  TerminalSquare,
} from "lucide-react";
import { useAppState } from "@/lib/store";
import { clearBackendUrl } from "@/lib/connection";
import clsx from "clsx";

interface NavLink {
  href: string;
  icon: React.ElementType;
  label: string;
}

const workspace: NavLink[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { href: "/dashboard/capture", icon: Radio, label: "Capture" },
  { href: "/dashboard/modes", icon: Layers, label: "App Modes" },
  { href: "/dashboard/har", icon: FileSearch, label: "HAR Inspector" },
  { href: "/dashboard/terminal", icon: TerminalSquare, label: "Terminal" },
];

const management: NavLink[] = [
  { href: "/dashboard/device", icon: Smartphone, label: "Device" },
  { href: "/dashboard/apps", icon: AppWindow, label: "Apps" },
  { href: "/dashboard/scripts", icon: FileCode, label: "Scripts" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 pt-4 pb-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-muted px-2.5 mb-1.5">
        {title}
      </div>
      <nav className="space-y-0.5">{children}</nav>
    </div>
  );
}

function NavItem({ item, active }: { item: NavLink; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={clsx(
        "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium no-underline transition-all duration-150",
        active
          ? "bg-accent/10 text-accent-bright border border-accent/15"
          : "text-text-secondary hover:text-foreground hover:bg-bg-elevated border border-transparent"
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.label}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { flows, capturing } = useAppState();

  return (
    <aside className="w-[240px] shrink-0 border-r border-border bg-sidebar flex flex-col h-full">
      {/* Brand header */}
      <div className="px-4 py-5 border-b border-border">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 no-underline group"
        >
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-semibold"><span className="text-brand-light">x</span><span className="text-foreground">-lock</span></span>
              <span className="text-text-muted text-[15px] font-light">/</span>
              <span className="font-bold text-[15px]"><span className="text-foreground">sniff</span><span className="text-accent-bright">!</span></span>
            </div>
            <span className="text-[10px] text-text-muted tracking-wide">
              Open Source
            </span>
          </div>
        </Link>
      </div>

      {/* Statistics */}
      <SidebarSection title="Statistics">
        <div className="space-y-0.5">
          <div className="flex items-center justify-between px-3 py-2 rounded-xl text-[13px]">
            <span className="flex items-center gap-2.5 text-text-secondary">
              <Wifi className="h-4 w-4" />
              Flows
            </span>
            <span className="text-[12px] font-mono font-semibold text-accent-bright bg-accent/10 rounded-lg px-2 py-0.5 min-w-[32px] text-center">
              {flows.length}
            </span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-xl text-[13px]">
            <span className="flex items-center gap-2.5 text-text-secondary">
              <ShieldOff className="h-4 w-4" />
              SSL Bypass
            </span>
            <span
              className={clsx(
                "text-[12px] font-mono font-semibold rounded-lg px-2 py-0.5",
                capturing
                  ? "text-good bg-good/10"
                  : "text-text-muted bg-bg-tertiary"
              )}
            >
              {capturing ? "Active" : "Idle"}
            </span>
          </div>
        </div>
      </SidebarSection>

      {/* Workspace */}
      <SidebarSection title="Workspace">
        {workspace.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            active={
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname === item.href ||
                  pathname.startsWith(item.href + "/")
            }
          />
        ))}
      </SidebarSection>

      {/* Management */}
      <SidebarSection title="Management">
        {management.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            active={pathname === item.href}
          />
        ))}
      </SidebarSection>

      <div className="flex-1" />

      {/* Links */}
      <div className="px-3 pt-3 pb-3 border-t border-border">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-text-muted px-2.5 mb-1.5">
          Links
        </div>
        <nav className="space-y-0.5">
          <a
            href="/docs"
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium text-text-secondary hover:text-foreground hover:bg-bg-elevated no-underline transition-all duration-150"
          >
            <BookOpen className="h-4 w-4" />
            Documentation
          </a>
          <a
            href="https://x-lock.cloud"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium text-text-secondary hover:text-brand-light hover:bg-brand-dim no-underline transition-all duration-150"
          >
            <ExternalLink className="h-4 w-4" />
            x-lock.cloud
          </a>
        </nav>
      </div>

      {/* Footer */}
      <div className="px-3 pb-4 flex gap-2">
        <button
          onClick={() => {
            clearBackendUrl();
            router.push("/connect");
          }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-bg-tertiary text-text-secondary text-xs font-medium py-2.5 hover:bg-bg-elevated hover:text-foreground transition-colors cursor-pointer border border-border"
        >
          <LogOut className="h-3.5 w-3.5" />
          Disconnect
        </button>
      </div>
    </aside>
  );
}
