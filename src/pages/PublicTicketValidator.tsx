import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Camera,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useParams } from "react-router-dom";

import type {
  PublicTicketValidatorInfo,
  TicketValidationResult,
} from "@/components/events/event-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getPublicTicketValidator,
  validatePublicTicket,
} from "@/lib/events";
import { publicThemeVariables, readableColorOn } from "@/lib/public-theme";
import { cn } from "@/lib/utils";

export default function PublicTicketValidator() {
  const { maskedId = "" } = useParams();
  const [info, setInfo] = useState<PublicTicketValidatorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [code, setCode] = useState("");
  const [station, setStation] = useState("Main entrance");
  const [result, setResult] = useState<TicketValidationResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void getPublicTicketValidator(maskedId)
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((error) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "This validator link is unavailable.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [maskedId]);

  const stopCamera = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const validate = useCallback(
    async (ticketCode: string) => {
      const normalized = ticketCode.trim();
      if (!normalized || scanning) return;
      setScanning(true);
      setResult(null);
      try {
        const response = await validatePublicTicket({
          maskedId,
          station: station.trim() || "Main entrance",
          ticketCode: normalized,
        });
        setResult(response);
        setCode("");
      } catch (error) {
        setResult({
          result: "invalid_signature",
          message:
            error instanceof Error
              ? error.message
              : "This ticket could not be validated.",
        });
      } finally {
        setScanning(false);
      }
    },
    [maskedId, scanning, station],
  );

  const startCamera = async () => {
    const BarcodeDetectorConstructor = (
      window as unknown as {
        BarcodeDetector?: new (input: { formats: string[] }) => {
          detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
        };
      }
    ).BarcodeDetector;
    if (!BarcodeDetectorConstructor) {
      setResult({
        result: "invalid_signature",
        message: "Camera scanning is not supported here. Enter the ticket number instead.",
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new BarcodeDetectorConstructor({
        formats: ["qr_code", "code_128"],
      });
      setCameraOn(true);
      timerRef.current = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        void detector.detect(video).then((codes) => {
          const value = codes[0]?.rawValue;
          if (!value) return;
          stopCamera();
          void validate(value);
        });
      }, 500);
    } catch {
      stopCamera();
      setResult({
        result: "invalid_signature",
        message: "Camera access was denied. Check browser permissions or enter the code manually.",
      });
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-zinc-100 px-5 text-zinc-950">
        <div className="text-center" role="status">
          <Loader2
            className="mx-auto h-7 w-7 animate-spin"
            style={{ color: "var(--brand, #F93D0A)" }}
          />
          <p className="mt-3 text-sm text-zinc-600">Opening secure validator</p>
        </div>
      </main>
    );
  }

  if (!info || loadError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-zinc-100 px-5 text-zinc-950">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-xs">
          <LockKeyhole className="mx-auto h-8 w-8 text-zinc-500" />
          <h1 className="mt-5 text-xl font-semibold">Validator link unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            {loadError || "Ask the event organizer for the current validator link."}
          </p>
        </div>
      </main>
    );
  }

  const accepted = result?.result === "valid" || result?.result === "manual_override";
  const brandColor = info.brandColor || "#F93D0A";
  const brandForeground = readableColorOn(brandColor);
  const pageTheme = {
    ...publicThemeVariables({
      accent: brandColor,
      background: "#F4F4F5",
      border: "#E4E4E7",
      foreground: "#18181B",
      muted: "#71717A",
      radius: "0.875rem",
      surface: "#FFFFFF",
    }),
    backgroundImage: `radial-gradient(circle at 50% 0%, ${brandColor}18, transparent 34rem)`,
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void validate(code);
  };

  return (
    <main
      className="min-h-dvh bg-zinc-100 px-4 py-8 text-zinc-950 sm:px-6 sm:py-12"
      style={pageTheme}
    >
      <div className="mx-auto max-w-4xl">
        <header className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xs">
          <div className="h-1.5 w-full" style={{ backgroundColor: brandColor }} />
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-center gap-4">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/5"
                style={{ backgroundColor: info.logoUrl ? "#FFFFFF" : brandColor }}
              >
                {info.logoUrl ? (
                  <img
                    src={info.logoUrl}
                    alt={`${info.workspaceName} logo`}
                    className="h-full w-full object-contain p-1.5"
                  />
                ) : (
                  <ShieldCheck
                    className="h-7 w-7"
                    style={{ color: brandForeground }}
                  />
                )}
              </div>
              <div className="min-w-0">
                <div
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]"
                  style={{ color: brandColor }}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Authorized check-in
                </div>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                  Ticket validator
                </h1>
                <p className="mt-1 truncate text-sm font-medium text-zinc-600">
                  {info.workspaceName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-600 sm:self-auto">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Live validation
            </div>
          </div>
        </header>

        <div className="mt-7 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Keep this page private</p>
            <p className="mt-1 text-xs leading-5 text-amber-900/80">
              This link grants check-in access without a dashboard login. Do not share it with attendees or third parties.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Scan ticket</h2>
                <p className="mt-1 text-xs text-zinc-500">QR code or Code 128</p>
              </div>
              <Camera className="h-5 w-5" style={{ color: brandColor }} />
            </div>
            <div className="relative mt-5 aspect-video overflow-hidden rounded-xl bg-zinc-950">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400">
                  <QrCode className="h-10 w-10" />
                  <span className="mt-3 text-xs">Camera is off</span>
                </div>
              )}
              {cameraOn && <div className="pointer-events-none absolute inset-[17%] rounded-lg border-2 border-white/80" />}
            </div>
            <Button
              type="button"
              className="mt-4 w-full bg-zinc-950 text-white hover:bg-zinc-800"
              variant={cameraOn ? "outline" : "default"}
              onClick={() => (cameraOn ? stopCamera() : void startCamera())}
            >
              <Camera className="h-4 w-4" />
              {cameraOn ? "Stop camera" : "Start camera"}
            </Button>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs sm:p-6">
            <h2 className="font-semibold">Enter ticket code</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Invalid codes are rejected and are never added to check-in records.
            </p>
            <form className="mt-5 space-y-4" onSubmit={submit}>
              <div>
                <Label htmlFor="public-validator-station" className="text-zinc-700">Station</Label>
                <Input
                  id="public-validator-station"
                  value={station}
                  onChange={(event) => setStation(event.target.value)}
                  className="mt-2 border-zinc-300 bg-white text-zinc-950"
                  maxLength={80}
                />
              </div>
              <div>
                <Label htmlFor="public-validator-code" className="text-zinc-700">Ticket number or QR code</Label>
                <Input
                  id="public-validator-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="mt-2 h-12 border-zinc-300 bg-white font-mono text-zinc-950"
                  placeholder="TKT-... or mfe1..."
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                className="h-11 w-full hover:opacity-90"
                style={{
                  backgroundColor: brandColor,
                  color: brandForeground,
                }}
                disabled={!code.trim() || scanning}
              >
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {scanning ? "Validating" : "Validate and check in"}
              </Button>
            </form>
          </section>
        </div>

        {result && (
          <section
            aria-live="polite"
            className={cn(
              "mt-5 flex gap-4 rounded-2xl border bg-white p-5 shadow-xs",
              accepted ? "border-emerald-300" : "border-red-300",
            )}
          >
            {accepted ? (
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
            )}
            <div className="min-w-0">
              <p className={cn("font-semibold", accepted ? "text-emerald-800" : "text-red-800")}>
                {result.message}
              </p>
              {result.attendeeName && <p className="mt-2 text-sm font-medium">{result.attendeeName}</p>}
              <p className="mt-1 text-xs text-zinc-600">
                {[result.eventTitle, result.ticketTypeName, result.ticketNumber]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
