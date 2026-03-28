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
    "inline-flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer",
    {
      "bg-accent text-white hover:bg-accent-light font-bold":
        variant === "primary",
      "border border-border text-text-secondary hover:border-border-light hover:text-foreground font-medium":
        variant === "secondary",
    },
    {
      "px-4 py-2 text-xs": size === "sm",
      "px-6 py-3 text-sm": size === "md",
      "px-8 py-3.5 text-sm": size === "lg",
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
