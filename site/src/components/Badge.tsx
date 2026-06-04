import clsx from "clsx";

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
}

export default function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-dim/20 backdrop-blur-md px-4 py-1 text-xs font-bold tracking-wide uppercase text-accent-light",
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      {children}
    </span>
  );
}
