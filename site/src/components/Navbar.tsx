"use client";

import { useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { navItems } from "@/lib/constants";
import Button from "./Button";

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-semibold"><span className="text-brand-light">x</span><span className="text-foreground">-lock</span></span>
            <span className="text-text-muted text-[15px] font-light">/</span>
            <span className="font-bold text-[15px]"><span className="text-foreground">sniff</span><span className="text-accent-bright">!</span></span>
          </div>
        </a>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <div key={item.label} className="relative">
              {item.children ? (
                <button
                  onClick={() =>
                    setDropdownOpen(
                      dropdownOpen === item.label ? null : item.label
                    )
                  }
                  className="flex items-center gap-1 text-sm text-text-secondary hover:text-foreground transition-colors cursor-pointer"
                >
                  {item.label}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              ) : (
                <a
                  href={item.href}
                  className="text-sm text-text-secondary hover:text-foreground transition-colors"
                  {...(item.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {item.label}
                </a>
              )}

              {/* Dropdown */}
              {item.children && dropdownOpen === item.label && (
                <div className="absolute left-0 top-full mt-2 w-48 rounded-xl border border-border bg-bg-secondary p-2 shadow-xl">
                  {item.children.map((child) => (
                    <a
                      key={child.label}
                      href={child.href}
                      className="block rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary hover:text-foreground transition-colors"
                      onClick={() => setDropdownOpen(null)}
                    >
                      {child.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:block">
          <Button href="/connect" size="sm">
            Get Started
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden text-foreground cursor-pointer"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <Menu className="h-6 w-6" />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-bg-secondary px-6 py-4 md:hidden">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="block py-2.5 text-sm text-text-secondary hover:text-foreground transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <div className="mt-4 pt-4 border-t border-border">
            <Button href="/connect" size="sm" className="w-full">
              Get Started
            </Button>
          </div>
        </div>
      )}
    </nav>
  );
}
