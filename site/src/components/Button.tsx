import clsx from "clsx";
import Link from "next/link";

interface ButtonProps {
  children: React.ReactNode;
  href?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
}

export default function Button({
  children,
  href,
  variant = "primary",
  size = "md",
  className,
  onClick,
}: ButtonProps) {
  const classes = clsx(
    "inline-flex items-center justify-center rounded-xl transition-all duration-300 cursor-pointer active:scale-95",
    {
      "bg-accent text-white hover:bg-accent-bright hover:shadow-[0_0_20px_rgba(59,111,246,0.4)] font-bold":
        variant === "primary",
      "border border-border text-text-secondary hover:border-accent/50 hover:text-foreground hover:bg-accent-dim/20 font-medium":
        variant === "secondary",
    },
    {
      "px-4 py-2 text-xs": size === "sm",
      "px-6 py-3 text-sm": size === "md",
      "px-10 py-4 text-base": size === "lg",
    },
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
