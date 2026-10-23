import { ArrowUpRight, ChevronDown, ChevronUp, Clock3, MapPin } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import type {
  EventRecord,
  EventSectionKey,
} from "@/components/events/event-types";
import { cn } from "@/lib/utils";

const emptyCopy: Record<EventSectionKey, string> = {
  about: "Event details are coming soon.",
  agenda: "The agenda will be published here.",
  speakers: "Speaker details will be announced here.",
  sponsors: "Partners and sponsors will be announced here.",
  faq: "Answers to common questions will be published here.",
  venue: "Venue details will be published here.",
};

const externalUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

export function EventPublicSections({
  event,
  compact = false,
}: {
  event: EventRecord;
  compact?: boolean;
}) {
  const content = event.sectionContent;
  const [openFaqId, setOpenFaqId] = useState<string | null>(
    () => content.faq[0]?.id || null,
  );
  useEffect(() => {
    setOpenFaqId((current) => {
      if (current && content.faq.some((item) => item.id === current)) {
        return current;
      }
      return content.faq[0]?.id || null;
    });
  }, [content.faq]);
  const enabled = (section: EventSectionKey) =>
    event.publicSections.includes(section);
  const sectionClass = cn(
    "border-t border-(--event-border)",
    compact ? "mt-8 pt-7" : "mt-12 pt-9",
  );
  const headingClass = compact
    ? "text-[18px] font-semibold"
    : "text-[24px] font-semibold";
  const headingStyle = {
    fontFamily: event.branding.headingFontFamily,
    fontWeight: event.branding.headingWeight,
  };
  const bodyCopyClass =
    event.branding.bodyFontSize === "small"
      ? "text-[13px] leading-7"
      : event.branding.bodyFontSize === "large"
        ? "text-[17px] leading-8"
        : "text-[15px] leading-8";
  const themeStyle = {
    "--event-accent": event.branding.accentColor,
    "--event-border": event.branding.borderColor,
    "--event-muted": event.branding.mutedTextColor,
    "--event-surface": event.branding.surfaceColor,
    color: event.branding.textColor,
    fontFamily: event.branding.fontFamily,
  } as CSSProperties;

  return (
    <div style={themeStyle}>
      {enabled("about") && (
        <section>
          <h2 className={headingClass} style={headingStyle}>
            {content.about.heading || "About this event"}
          </h2>
          <p
            className={cn(
              "mt-4 whitespace-pre-wrap text-(--event-muted)",
              compact ? "text-[13px] leading-7" : bodyCopyClass,
            )}
          >
            {content.about.body || event.description || emptyCopy.about}
          </p>
        </section>
      )}

      {enabled("agenda") && (
        <section className={enabled("about") ? sectionClass : undefined}>
          <h2 className={headingClass} style={headingStyle}>Agenda</h2>
          {content.agenda.length ? (
            <div className="mt-5 divide-y divide-(--event-border) border-y border-(--event-border)">
              {content.agenda.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "grid gap-2 py-4",
                    compact
                      ? "sm:grid-cols-[88px_minmax(0,1fr)]"
                      : "sm:grid-cols-[120px_minmax(0,1fr)]",
                  )}
                >
                  <p className="flex items-center gap-2 text-[12px] font-medium">
                    <Clock3 className="h-3.5 w-3.5 text-(--event-muted)" />
                    {item.time || "Time TBA"}
                  </p>
                  <div>
                    <h3 className="text-[14px] font-semibold">
                      {item.title || "Session details coming soon"}
                    </h3>
                    {item.description && (
                      <p className="mt-1 text-[12px] leading-6 text-(--event-muted)">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-(--event-muted)">
              {emptyCopy.agenda}
            </p>
          )}
        </section>
      )}

      {enabled("speakers") && (
        <section
          className={
            enabled("about") || enabled("agenda") ? sectionClass : undefined
          }
        >
          <h2 className={headingClass} style={headingStyle}>Speakers</h2>
          {content.speakers.length ? (
            <div
              className={cn(
                "mt-5 grid gap-4",
                compact ? "sm:grid-cols-2" : "sm:grid-cols-2",
              )}
            >
              {content.speakers.map((speaker) => (
                <article
                  key={speaker.id}
                  className="overflow-hidden border border-(--event-border) bg-(--event-surface)"
                  style={{ borderRadius: event.branding.cornerRadius }}
                >
                  {speaker.imageUrl && (
                    <img
                      src={speaker.imageUrl}
                      alt=""
                      className="aspect-4/3 w-full object-cover"
                    />
                  )}
                  <div className="p-4">
                    <h3 className="text-[14px] font-semibold">
                      {speaker.name || "Speaker"}
                    </h3>
                    {speaker.role && (
                      <p className="mt-1 text-[11px] font-medium text-(--event-accent)">
                        {speaker.role}
                      </p>
                    )}
                    {speaker.bio && (
                      <p className="mt-3 text-[12px] leading-6 text-(--event-muted)">
                        {speaker.bio}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-(--event-muted)">
              {emptyCopy.speakers}
            </p>
          )}
        </section>
      )}

      {enabled("sponsors") && (
        <section
          className={
            enabled("about") || enabled("agenda") || enabled("speakers")
              ? sectionClass
              : undefined
          }
        >
          <h2 className={headingClass} style={headingStyle}>Sponsors</h2>
          {content.sponsors.length ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {content.sponsors.map((sponsor) => {
                const href = externalUrl(sponsor.website);
                const contentNode = (
                  <>
                    <span className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
                      <span
                        className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden border border-(--event-border) bg-white p-2.5"
                        style={{ borderRadius: event.branding.cornerRadius }}
                      >
                        {sponsor.logoUrl ? (
                          <img
                            src={sponsor.logoUrl}
                            alt={sponsor.name ? `${sponsor.name} logo` : ""}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-[12px] font-semibold text-(--event-muted)">
                            {sponsor.name?.slice(0, 2).toUpperCase() || "SP"}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block wrap-break-word text-[14px] font-semibold leading-5">
                          {sponsor.name || "Sponsor"}
                        </span>
                        {href && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-(--event-accent)">
                            Visit sponsor
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </span>
                    </span>
                    {sponsor.description && (
                      <span className="mt-4 block whitespace-pre-wrap text-[12px] leading-6 text-(--event-muted)">
                        {sponsor.description}
                      </span>
                    )}
                  </>
                );
                return href ? (
                  <a
                    key={sponsor.id}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="block h-full min-w-0 border border-(--event-border) bg-(--event-surface) p-4 transition duration-200 hover:-translate-y-0.5 hover:border-(--event-accent) hover:shadow-xs"
                    style={{ borderRadius: event.branding.cornerRadius }}
                  >
                    {contentNode}
                  </a>
                ) : (
                  <div
                    key={sponsor.id}
                    className="h-full min-w-0 border border-(--event-border) bg-(--event-surface) p-4"
                    style={{ borderRadius: event.branding.cornerRadius }}
                  >
                    {contentNode}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-(--event-muted)">
              {emptyCopy.sponsors}
            </p>
          )}
        </section>
      )}

      {enabled("faq") && (
        <section
          className={
            enabled("about") ||
            enabled("agenda") ||
            enabled("speakers") ||
            enabled("sponsors")
              ? sectionClass
              : undefined
          }
        >
          <h2 className={headingClass} style={headingStyle}>
            Frequently asked questions
          </h2>
          {content.faq.length ? (
            <div className="mt-5 overflow-hidden border border-(--event-border) bg-(--event-surface)" style={{ borderRadius: event.branding.cornerRadius }}>
              {content.faq.map((item, index) => {
                const open = openFaqId === item.id;
                return (
                  <div
                    key={item.id}
                    className="border-b border-(--event-border) last:border-b-0"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-(--event-accent)/5"
                      onClick={() => setOpenFaqId(open ? null : item.id)}
                      aria-expanded={open}
                    >
                      <span className="text-[13px] font-semibold">
                        {item.question || `Question ${index + 1}`}
                      </span>
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center border border-(--event-border) text-(--event-accent)"
                        style={{ borderRadius: event.branding.cornerRadius }}
                      >
                        {open ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </span>
                    </button>
                    <div
                      className={cn(
                        "grid transition-all duration-300 ease-out",
                        open
                          ? "grid-rows-[1fr] opacity-100"
                          : "grid-rows-[0fr] opacity-0",
                      )}
                    >
                      <div className="overflow-hidden">
                        <p className="px-4 pb-4 whitespace-pre-wrap text-[12px] leading-6 text-(--event-muted)">
                          {item.answer || "An answer will be added soon."}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-(--event-muted)">
              {emptyCopy.faq}
            </p>
          )}
        </section>
      )}

      {enabled("venue") && (
        <section
          className={
            event.publicSections.some((section) => section !== "venue")
              ? sectionClass
              : undefined
          }
        >
          <h2 className={headingClass} style={headingStyle}>
            Venue &amp; arrival
          </h2>
          {content.venue.name ||
          event.venueName ||
          content.venue.address ||
          event.address ||
          content.venue.directions ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-[36px_minmax(0,1fr)]">
              <div
                className="grid h-9 w-9 place-items-center"
                style={{
                  backgroundColor: `${event.branding.accentColor}1A`,
                  borderRadius: event.branding.cornerRadius,
                  color: event.branding.accentColor,
                }}
              >
                <MapPin className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold">
                  {content.venue.name || event.venueName || "Event venue"}
                </h3>
                <p className="mt-1 text-[12px] text-(--event-muted)">
                  {content.venue.address ||
                    event.address ||
                    "Address to be announced"}
                </p>
                {content.venue.directions && (
                  <p className="mt-3 whitespace-pre-wrap text-[12px] leading-6 text-(--event-muted)">
                    {content.venue.directions}
                  </p>
                )}
                {content.venue.mapUrl && (
                  <a
                    href={content.venue.mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-medium text-(--event-accent) hover:underline"
                  >
                    Open map
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-(--event-muted)">
              {emptyCopy.venue}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
