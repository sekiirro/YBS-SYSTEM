import * as React from "react"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-semibold tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 shadow-[0_0_10px_hsl(var(--primary)/0.1)]",
        secondary:
          "border-white/10 bg-secondary/80 text-secondary-foreground hover:bg-secondary shadow-sm",
        destructive:
          "border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 shadow-[0_0_10px_hsl(var(--destructive)/0.1)]",
        outline: "border-white/15 text-foreground hover:bg-white/5",
        success:
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 shadow-[0_0_10px_hsl(var(--success)/0.1)]",
        warning:
          "border-amber-500/20 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 shadow-[0_0_10px_hsl(var(--warning)/0.1)]",
        info:
          "border-sky-500/20 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 shadow-[0_0_10px_hsl(var(--primary)/0.1)]",
        purple:
          "border-violet-500/20 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 shadow-[0_0_10px_hsl(var(--muted-foreground)/0.1)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}) {
  return (<div className={cn(badgeVariants({ variant }), className)} {...props} />);
}

export { Badge, badgeVariants }
