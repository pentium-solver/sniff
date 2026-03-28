import {
  Wifi,
  ShieldOff,
  Search,
  Terminal,
  Smartphone,
  Download,
  type LucideIcon,
} from "lucide-react";

export interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface NavItem {
  label: string;
  href: string;
  external?: boolean;
  children?: { label: string; href: string }[];
}

export const features: Feature[] = [
  {
    icon: Wifi,
    title: "Traffic Capture",
    description:
      "Intercept HTTP/HTTPS traffic from any Android application with transparent proxying and real-time flow display.",
  },
  {
    icon: ShieldOff,
    title: "SSL Pinning Bypass",
    description:
      "Universal SSL unpinning via Frida injection. Works on certificate pinning, public key pinning, and custom trust managers.",
  },
  {
    icon: Search,
    title: "App Inspector",
    description:
      "Browse installed apps, select targets, and inspect per-app network behavior with package-specific capture modes.",
  },
  {
    icon: Terminal,
    title: "Frida Scripts",
    description:
      "Manage and swap Frida scripts on the fly. Built-in universal bypass plus custom script support.",
  },
  {
    icon: Smartphone,
    title: "Device Manager",
    description:
      "Monitor ADB connection, Frida server status, proxy configuration, and device info from a single dashboard.",
  },
  {
    icon: Download,
    title: "Export Tools",
    description:
      "Export captured flows to HAR, JSON, or mitmproxy-compatible formats for further analysis.",
  },
];

export const moduleTags = [
  "Traffic Capture",
  "SSL Bypass",
  "App Inspector",
  "Frida Scripts",
  "Device Manager",
  "Export Tools",
  "Real-time Monitoring",
  "App-specific Modes",
];

export const navItems: NavItem[] = [
  { label: "Features", href: "#features" },
  {
    label: "Modules",
    href: "#modules",
    children: [
      { label: "Traffic Capture", href: "#features" },
      { label: "SSL Bypass", href: "#features" },
      { label: "Frida Scripts", href: "#features" },
      { label: "Device Manager", href: "#features" },
      { label: "Export Tools", href: "#features" },
    ],
  },
  { label: "Docs", href: "/docs" },
  { label: "Changelog", href: "#" },
];

export const heroBullets = [
  "Bypass SSL pinning on any Android app",
  "Real-time traffic inspection and filtering",
  "Frida-powered script injection engine",
  "Export captures to HAR, JSON, or mitmproxy format",
];

export const typingWords = [
  "HTTPS Traffic",
  "SSL Pinning",
  "Network Packets",
  "API Calls",
];
