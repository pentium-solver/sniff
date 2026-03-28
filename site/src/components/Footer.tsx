function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  );
}

const footerLinks = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "Modules", href: "#modules" },
    { label: "Changelog", href: "https://github.com/pentium-solver/sniff/releases" },
    { label: "Download", href: "/connect" },
  ],
  Resources: [
    { label: "Documentation", href: "/docs" },
    { label: "Getting Started", href: "/docs#getting-started" },
    { label: "Frida Scripts", href: "/docs#frida-scripts" },
    { label: "API Reference", href: "/docs#api-reference" },
  ],
  Community: [
    { label: "GitHub", href: "https://github.com/pentium-solver/sniff" },
  ],
};

export default function Footer() {
  return (
    <footer className="border-t border-border bg-bg-secondary">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:py-16">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-4">
            <a href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-light shadow-md shadow-brand/20">
                <LockIcon className="h-4 w-4 text-white" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-semibold"><span className="text-brand-light">x</span><span className="text-foreground">-lock</span></span>
                <span className="text-text-muted text-[15px] font-light">/</span>
                <span className="font-bold text-[15px]"><span className="text-foreground">sniff</span><span className="text-accent-bright">!</span></span>
              </div>
            </a>
            <p className="text-sm text-text-secondary leading-relaxed">
              Professional Android HTTPS interception and network traffic
              analysis tool. An open source project by x-lock.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="mb-4 text-sm font-semibold text-foreground">
                {title}
              </h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-text-secondary hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-text-muted">
          <span>&copy; {new Date().getFullYear()} x-lock / sniff! All rights reserved.</span>
          <div className="flex items-center gap-1.5">
            <LockIcon className="h-3 w-3 text-brand/50" />
            <span>
              Powered by{" "}
              <a href="https://x-lock.cloud" target="_blank" rel="noopener noreferrer" className="text-brand/60 hover:text-brand transition-colors">
                x-lock
              </a>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
