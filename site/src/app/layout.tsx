import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "sniff! — Android HTTPS Traffic Interception Tool",
  description:
    "Intercept, inspect, and analyze Android HTTPS traffic with SSL pinning bypass. Built for security researchers and penetration testers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-glow text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
