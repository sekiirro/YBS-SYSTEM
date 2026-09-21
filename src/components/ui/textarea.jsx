import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    (<textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-lg border border-white/[0.08] bg-[hsl(var(--card))] px-3 py-2 text-[14px] shadow-inner placeholder:text-muted-foreground transition-colors hover:border-white/[0.12] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props} />)
  );
})
Textarea.displayName = "Textarea"

export { Textarea }
