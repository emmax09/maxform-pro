import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  LockKeyhole,
  PlugZap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const CONNECTION_RESULT_MESSAGE = "maxform:connection-result";

type ConnectionPhase =
  | "ready"
  | "preparing"
  | "waiting"
  | "connected"
  | "error";

type SecureConnectionDialogProps = {
  description?: string;
  logoUrl?: string | null;
  name: string;
  onConnected: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  prepareConnection: () => Promise<string>;
};

const popupFeatures = () => {
  const width = 620;
  const height = 760;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  return [
    "popup=yes",
    "resizable=yes",
    "scrollbars=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
  ].join(",");
};

export function SecureConnectionDialog({
  description,
  logoUrl,
  name,
  onConnected,
  onOpenChange,
  open,
  prepareConnection,
}: SecureConnectionDialogProps) {
  const popupRef = useRef<Window | null>(null);
  const [phase, setPhase] = useState<ConnectionPhase>("ready");
  const [message, setMessage] = useState("");

  const closePopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
  }, []);

  useEffect(() => {
    if (open) {
      setPhase("ready");
      setMessage("");
      return;
    }
    closePopup();
  }, [closePopup, open]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== popupRef.current ||
        !event.data ||
        event.data.type !== CONNECTION_RESULT_MESSAGE
      ) {
        return;
      }

      popupRef.current = null;
      if (event.data.status === "connected") {
        setPhase("connected");
        setMessage(`${name} is ready to use.`);
        try {
          await onConnected();
        } catch {
          setPhase("error");
          setMessage("The account connected, but the workspace could not refresh.");
        }
        return;
      }

      setPhase("error");
      setMessage(
        event.data.status === "cancelled"
          ? "Connection cancelled. Nothing was changed."
          : "This account could not be connected. Please try again.",
      );
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [name, onConnected]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const timer = window.setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        window.clearInterval(timer);
        setPhase("error");
        setMessage("The connection window was closed before setup finished.");
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  const connect = async () => {
    setPhase("preparing");
    setMessage("");
    const popup = window.open("", "maxform-secure-connection", popupFeatures());
    if (!popup) {
      setPhase("error");
      setMessage("Allow pop-ups for MaxForm, then try connecting again.");
      return;
    }
    popupRef.current = popup;
    popup.document.title = `Connect ${name}`;
    popup.document.body.innerHTML =
      '<main style="font-family:system-ui;padding:40px;color:#18181b"><p>Opening secure connection...</p></main>';

    try {
      const authorizationUrl = await prepareConnection();
      if (popup.closed) {
        throw new Error("Connection window closed");
      }
      popup.location.replace(authorizationUrl);
      popup.focus();
      setPhase("waiting");
      setMessage(`Finish connecting ${name} in the secure window.`);
    } catch {
      closePopup();
      setPhase("error");
      setMessage("This connection is unavailable right now. Please try again later.");
    }
  };

  const busy = phase === "preparing" || phase === "waiting";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closePopup();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-2">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              ) : (
                <PlugZap className="h-5 w-5 text-neutral-800" />
              )}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <LockKeyhole className="h-3.5 w-3.5" />
              Secure connection
            </span>
          </div>
          <DialogTitle>Connect {name}</DialogTitle>
          <DialogDescription>
            {description ||
              `Authorize MaxForm to use your ${name} account for workspace automations.`}
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 border-y border-border py-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {phase === "connected" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
            </span>
            <div>
              <p className="text-[13px] font-medium">
                {phase === "connected"
                  ? "Connection complete"
                  : busy
                    ? "Waiting for authorization"
                    : phase === "error"
                      ? "Connection not completed"
                      : "Continue in a secure window"}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {message ||
                  "Your dashboard stays open while the provider handles sign-in and consent."}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {phase === "connected" ? "Close" : "Cancel"}
          </Button>
          {phase !== "connected" && (
            <Button type="button" onClick={connect} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              {phase === "error" ? "Try again" : `Continue to ${name}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
