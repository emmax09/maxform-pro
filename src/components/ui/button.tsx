/* eslint-disable react-refresh/only-export-components */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:bg-foreground/90",
        /*
         * Brand conversion action (Start free, Sign up, Create form, Upgrade,
         * Contact sales). Added as its own variant rather than changing
         * `default`, because `default` is shared with the signed-in app where
         * --primary is the customer's own workspace colour - repointing it
         * there would restyle every dashboard button.
         */
        brand:
          "bg-primary text-primary-foreground hover:bg-[hsl(var(--primary-hover))] active:bg-[hsl(var(--primary-active))]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-foreground/40 bg-transparent text-foreground hover:bg-foreground hover:text-background",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof (value as PromiseLike<unknown>).then === "function";

const hasAnimatedLoadingChild = (children: React.ReactNode): boolean =>
  React.Children.toArray(children).some((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; className?: string }>(
      child,
    )) {
      return false;
    }
    if (
      typeof child.props.className === "string" &&
      child.props.className.includes("animate-spin")
    ) {
      return true;
    }
    return hasAnimatedLoadingChild(child.props.children);
  });

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      children,
      className,
      disabled,
      loading,
      loadingLabel = "Action in progress",
      onClick,
      size,
      variant,
      ...props
    },
    ref,
  ) => {
    const [internalPending, setInternalPending] = React.useState(false);
    const actionSequence = React.useRef(0);
    const legacyLoading = hasAnimatedLoadingChild(children);
    const hasControlledLoading = loading !== undefined;
    const isLoading = hasControlledLoading
      ? Boolean(loading) || internalPending
      : internalPending || legacyLoading;
    const Comp = asChild ? Slot : "button";

    React.useEffect(() => {
      return () => {
        actionSequence.current += 1;
      };
    }, []);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || isLoading) {
        event.preventDefault();
        return;
      }
      const result = (
        onClick as
          | ((event: React.MouseEvent<HTMLButtonElement>) => unknown)
          | undefined
      )?.(event);
      if (!isPromiseLike(result)) return;

      const sequence = actionSequence.current + 1;
      actionSequence.current = sequence;
      setInternalPending(true);
      void Promise.resolve(result).then(
        () => {
          if (actionSequence.current === sequence) setInternalPending(false);
        },
        () => {
          if (actionSequence.current === sequence) setInternalPending(false);
        },
      );
    };

    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          onClick={handleClick}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <Comp
        aria-busy={isLoading || undefined}
        className={cn(buttonVariants({ variant, size, className }))}
        data-loading={isLoading || undefined}
        disabled={disabled || isLoading}
        onClick={handleClick}
        ref={ref}
        {...props}
      >
        {isLoading ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            data-button-loading-indicator=""
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          </span>
        ) : null}
        {isLoading ? (
          <span
            className="inline-flex min-w-0 items-center justify-center gap-[inherit] opacity-0"
          >
            {children}
          </span>
        ) : (
          children
        )}
        {isLoading ? <span className="sr-only">{loadingLabel}</span> : null}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
