import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[14px] font-medium tracking-tight transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "ybs-button-primary",
        destructive:
          "bg-rose-500 text-pearl shadow-[0_0_24px_-8px_hsl(var(--destructive)/0.6)] hover:bg-rose-600 hover:shadow-[0_0_32px_-8px_hsl(var(--destructive)/0.8)]",
        outline:
          "border border-white/[0.12] bg-transparent text-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_20px_hsl(var(--primary)/0.1)]",
        secondary:
          "bg-white/[0.06] text-foreground border border-white/[0.08] hover:bg-white/[0.1] hover:border-white/[0.12] shadow-sm",
        ghost: "text-foreground/80 hover:text-foreground hover:bg-white/[0.06]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "ybs-button h-11 px-5 py-2",
        sm: "ybs-button h-10 px-4 text-sm",
        lg: "ybs-button h-12 px-8 text-base",
        icon: "ybs-button h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  if (asChild) {
    const Comp = Slot;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
  return (
    <motion.button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      whileHover={{ scale: 1.015, transition: { duration: 0.15, ease: 'easeOut' } }}
      whileTap={{ scale: 0.975, transition: { duration: 0.1, ease: 'easeIn' } }}
      {...props}
    />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
