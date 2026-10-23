import type { SchedulingToolProvider } from "@/lib/appointments";

/**
 * Provider marks.
 *
 * Drawn inline in each vendor's own brand colours rather than fetched, so the
 * integrations grid renders offline, needs no image host, and stays crisp at
 * every size. Each mark is the vendor's identity used to label their own
 * integration card — nothing here implies endorsement.
 */
type MarkProps = { className?: string };

function GoogleCalendarMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Google Calendar">
      <path fill="#FFF" d="M36 12H12v24h24z" />
      <path fill="#1A73E8" d="M36 48 48 36H36z" />
      <path fill="#EA4335" d="M48 12H36V0h8a4 4 0 0 1 4 4z" />
      <path fill="#4285F4" d="M36 0H4a4 4 0 0 0-4 4v8h36z" />
      <path fill="#188038" d="M0 36h12v12H4a4 4 0 0 1-4-4z" />
      <path fill="#FBBC04" d="M0 12h12v24H0z" />
      <path fill="#34A853" d="M36 48H4a4 4 0 0 1-4-4v-8h36z" />
      <path fill="#4285F4" d="M48 12v24H36V12z" />
      <text
        x="24"
        y="31"
        textAnchor="middle"
        fontFamily="Arial,Helvetica,sans-serif"
        fontSize="15"
        fontWeight="700"
        fill="#1A73E8"
      >
        31
      </text>
    </svg>
  );
}

function OutlookMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Outlook">
      <path fill="#0364B8" d="M46 13.4V34a2 2 0 0 1-2 2H21V10h23a2 2 0 0 1 2 2z" />
      <path fill="#0078D4" d="M46 13.4 33.5 21 21 13.4V10h25z" />
      <path fill="#28A8EA" d="M21 21h25v8H21z" />
      <path fill="#14447D" d="M21 29h25v5a2 2 0 0 1-2 2H21z" />
      <path fill="#0078D4" d="M2 8.8 21 6v36L2 39.2z" />
      <path
        fill="#FFF"
        d="M11.6 17.9c-3.1 0-5.1 2.5-5.1 6.1s2 6.1 5.1 6.1 5.1-2.5 5.1-6.1-2-6.1-5.1-6.1zm0 9.9c-1.6 0-2.6-1.5-2.6-3.8s1-3.8 2.6-3.8 2.6 1.5 2.6 3.8-1 3.8-2.6 3.8z"
      />
    </svg>
  );
}

function ZoomMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Zoom">
      <circle cx="24" cy="24" r="24" fill="#2D8CFF" />
      <path
        fill="#FFF"
        d="M13 18.6c0-1 .8-1.8 1.8-1.8h11.4c1.9 0 3.4 1.5 3.4 3.4v9.2c0 1-.8 1.8-1.8 1.8H16.4a3.4 3.4 0 0 1-3.4-3.4zm18.6 3.1 4.6-3.3c.6-.4 1.4 0 1.4.7v9.8c0 .7-.8 1.1-1.4.7l-4.6-3.3z"
      />
    </svg>
  );
}

function GoogleMeetMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Google Meet">
      <path fill="#00832D" d="M12 12h16v10l-4 2-4 2v8H12z" />
      <path fill="#0066DA" d="M4 16a4 4 0 0 1 4-4h4v24H8a4 4 0 0 1-4-4z" />
      <path fill="#E94235" d="M28 34v-8l8 6v4a2 2 0 0 1-2 2H12v-4z" />
      <path fill="#2684FC" d="M28 12v10l8-6v-2a2 2 0 0 0-2-2z" />
      <path fill="#FFBA00" d="M36 16 44 10v28l-8-6z" />
      <path fill="#00AC47" d="M28 22v4l8 6V16z" />
    </svg>
  );
}

function TeamsMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Microsoft Teams">
      <circle cx="34" cy="12" r="5" fill="#5059C9" />
      <path fill="#5059C9" d="M36 19h6a2 2 0 0 1 2 2v9a7 7 0 0 1-7 7h-1z" />
      <circle cx="22" cy="11" r="6.5" fill="#7B83EB" />
      <path fill="#7B83EB" d="M13 19h18a2 2 0 0 1 2 2v11a11 11 0 0 1-22 0V21a2 2 0 0 1 2-2z" />
      <rect x="3" y="13" width="22" height="22" rx="2.5" fill="#4B53BC" />
      <path
        fill="#FFF"
        d="M9 18h10v2.6h-3.6V31h-2.9V20.6H9z"
      />
    </svg>
  );
}

function CalendlyMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Calendly">
      <circle cx="24" cy="24" r="24" fill="#006BFF" />
      <path
        fill="#FFF"
        d="M32.4 28.6c-.5 0-1 .2-1.3.6-1.5 1.8-3.7 2.8-6 2.8-4.4 0-8-3.6-8-8s3.6-8 8-8c2.3 0 4.5 1 6 2.8.5.6 1.4.8 2.1.4.8-.4 1.1-1.4.7-2.2l-.2-.3c-2.1-2.6-5.3-4.1-8.6-4.1-6.2 0-11.2 5-11.2 11.2s5 11.2 11.2 11.2c3.3 0 6.5-1.5 8.6-4.1.6-.7.4-1.7-.3-2.2-.3-.1-.6-.2-1-.1z"
      />
      <circle cx="34.5" cy="24" r="2.6" fill="#FFF" />
    </svg>
  );
}

function CalComMark({ className }: MarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Cal.com">
      <rect width="48" height="48" rx="10" fill="#111827" />
      <path
        fill="#FFF"
        d="M17.6 30.9c-4 0-6.9-2.9-6.9-6.9s2.8-6.9 6.9-6.9c2.2 0 4 .8 5.2 2.3l-2.4 2c-.7-.9-1.7-1.3-2.8-1.3-2.1 0-3.6 1.6-3.6 3.9s1.5 3.9 3.6 3.9c1.1 0 2.1-.5 2.8-1.3l2.4 2c-1.2 1.5-3 2.3-5.2 2.3z"
      />
      <circle cx="27.5" cy="29.2" r="1.9" fill="#FFF" />
      <path
        fill="#FFF"
        d="M33.6 30.6V17.4h3.1v13.2z"
      />
    </svg>
  );
}

const marks: Record<SchedulingToolProvider, (props: MarkProps) => JSX.Element> = {
  google_calendar: GoogleCalendarMark,
  outlook: OutlookMark,
  zoom: ZoomMark,
  google_meet: GoogleMeetMark,
  teams: TeamsMark,
  calendly: CalendlyMark,
  cal_com: CalComMark,
};

export function ProviderLogo({
  provider,
  className = "h-8 w-8",
}: {
  provider: SchedulingToolProvider;
  className?: string;
}) {
  const Mark = marks[provider];
  if (!Mark) return null;
  return <Mark className={className} />;
}
