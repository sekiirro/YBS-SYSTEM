import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    (<input
      type={type}
      className={cn(
        "ybs-field flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-[14px] text-foreground shadow-inner transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-white/[0.12] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props} />)
  );
})
Input.displayName = "Input"

export { Input }
