import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * Keeps one failing module from taking the whole page with it.
 *
 * Without a boundary, a render error anywhere below unmounts the entire React
 * tree — the tab goes blank and the only clue is in the console. This catches
 * the error, keeps the rest of the dashboard usable, and shows what actually
 * broke so it can be reported rather than guessed at.
 */
type Props = {
  children: ReactNode;
  /** Names the area in the fallback, e.g. "Events". */
  title?: string;
  /** Changing this resets the boundary — pass the active tab to clear on nav. */
  resetKey?: string;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The stack is the only way to find the real cause, so keep it in the
    // console even though the user sees the friendly panel.
    console.error(`[${this.props.title || "Workspace"}] render failed`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-[16px] font-semibold">
            {this.props.title ? `${this.props.title} could not be displayed` : "Something went wrong"}
          </h2>
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
            This section hit an unexpected error. The rest of your workspace is
            still working — you can try again or switch to another section.
          </p>
          <p className="mt-3 wrap-break-word rounded-md bg-background/70 p-2 text-left font-mono text-[10px] leading-4 text-muted-foreground">
            {error.message || String(error)}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button type="button" size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
