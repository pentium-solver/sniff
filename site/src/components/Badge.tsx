import clsx from "clsx";

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
}

export default function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent-dim px-4 py-1.5 text-sm font-medium text-accent-light",
        className
      )}
    >
      {children}
    </span>
  );
}
