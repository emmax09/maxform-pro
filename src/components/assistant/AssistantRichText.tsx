import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const INLINE_TOKEN =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|!?\[[^\]]+\]\([^\s)]+\))/g;

const tableCells = (line: string) => {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
};

const isTableDivider = (line: string) => {
  const cells = tableCells(line);
  return (
    cells.length >= 2 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")))
  );
};

const isTableStart = (lines: string[], index: number) =>
  Boolean(lines[index]?.includes("|")) && isTableDivider(lines[index + 1] || "");

const isBlockStart = (lines: string[], index: number) => {
  const line = lines[index] || "";
  return (
    /^\s*```/.test(line) ||
    /^\s*#{1,6}\s+/.test(line) ||
    /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*(?:---+|___+|\*\s*\*\s*\*)\s*$/.test(line) ||
    isTableStart(lines, index)
  );
};

const safeHref = (value: string) => {
  const href = value.trim();
  return /^(?:https?:|mailto:)/i.test(href) ? href : null;
};

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    const index = match.index ?? cursor;
    if (index > cursor) nodes.push(value.slice(cursor, index));

    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${index}`}
          className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("![")) {
      // Do not fetch arbitrary model-provided images. Keep the useful alt text.
      nodes.push(token.slice(2, token.indexOf("](")));
    } else if (token.startsWith("[")) {
      const closeLabel = token.indexOf("](");
      const label = token.slice(1, closeLabel);
      const href = safeHref(token.slice(closeLabel + 2, -1));
      nodes.push(
        href ? (
          <a
            key={`${keyPrefix}-link-${index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary"
          >
            {renderInline(label, `${keyPrefix}-link-label-${index}`)}
          </a>
        ) : (
          label
        ),
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-foreground">
          {renderInline(token.slice(2, -2), `${keyPrefix}-strong-${index}`)}
        </strong>,
      );
    } else if (token.startsWith("~~")) {
      nodes.push(
        <del key={`${keyPrefix}-del-${index}`} className="text-muted-foreground">
          {renderInline(token.slice(2, -2), `${keyPrefix}-del-${index}`)}
        </del>,
      );
    } else {
      nodes.push(
        <em key={`${keyPrefix}-em-${index}`} className="italic">
          {renderInline(token.slice(1, -1), `${keyPrefix}-em-${index}`)}
        </em>,
      );
    }
    cursor = index + token.length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

const inline = (value: string, key: string) => renderInline(value, key);

/**
 * Small, safe Markdown presentation for model output.
 *
 * This deliberately renders a narrow Markdown subset instead of injecting
 * model output as HTML. It covers the structures MaxAI uses in answers—plain
 * paragraphs, emphasis, lists, tables, links, quotes, and code—while keeping
 * arbitrary HTML and URLs inert.
 */
export function AssistantRichText({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index] || "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] || "")) {
        codeLines.push(lines[index] || "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre
          key={`block-${blockKey++}`}
          className="overflow-x-auto rounded-xl bg-slate-950 px-3.5 py-3 text-[11.5px] leading-relaxed text-slate-100 shadow-inner dark:bg-slate-950"
        >
          <code data-language={language || undefined}>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const Heading = (`h${Math.min(level, 3)}` as "h1" | "h2" | "h3");
      blocks.push(
        <Heading
          key={`block-${blockKey++}`}
          className={cn(
            "font-semibold tracking-[-0.015em] text-foreground",
            level === 1 ? "text-[16px]" : level === 2 ? "text-[14px]" : "text-[13px]",
          )}
        >
          {inline(heading[2], `heading-${blockKey}`)}
        </Heading>,
      );
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]?.trim() && lines[index].includes("|")) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={`block-${blockKey++}`} className="max-w-full overflow-x-auto rounded-xl border border-border/80">
          <table className="min-w-full border-collapse text-left text-[11.5px] leading-relaxed">
            <thead className="bg-muted/70 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                {headers.map((header, headerIndex) => (
                  <th key={`header-${headerIndex}`} className="whitespace-nowrap px-3 py-2 align-top">
                    {inline(header, `header-${blockKey}-${headerIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="border-t border-border/70">
                  {headers.map((_, columnIndex) => (
                    <td key={`cell-${rowIndex}-${columnIndex}`} className="min-w-[120px] px-3 py-2 align-top text-foreground/90">
                      {inline(row[columnIndex] || "", `cell-${blockKey}-${rowIndex}-${columnIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index]?.match(
          orderedList ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/,
        );
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const List = orderedList ? "ol" : "ul";
      blocks.push(
        <List
          key={`block-${blockKey++}`}
          className={cn(
            "space-y-1.5 pl-5 text-[13px] leading-[1.6] text-foreground/90",
            orderedList ? "list-decimal" : "list-disc",
          )}
        >
          {items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>{inline(item, `item-${blockKey}-${itemIndex}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] || "")) {
        quoteLines.push((lines[index] || "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`block-${blockKey++}`}
          className="border-l-2 border-primary/35 pl-3 text-[12.5px] italic leading-relaxed text-muted-foreground"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <Fragment key={`quote-${quoteIndex}`}>
              {quoteIndex ? <br /> : null}
              {inline(quoteLine, `quote-${blockKey}-${quoteIndex}`)}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*(?:---+|___+|\*\s*\*\s*\*)\s*$/.test(line)) {
      blocks.push(<hr key={`block-${blockKey++}`} className="border-border/80" />);
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index]?.trim()) {
      if (paragraph.length && isBlockStart(lines, index)) break;
      paragraph.push(lines[index] || "");
      index += 1;
    }
    blocks.push(
      <p key={`block-${blockKey++}`} className="text-[13px] leading-[1.65] text-foreground/90">
        {paragraph.map((paragraphLine, lineIndex) => (
          <Fragment key={`paragraph-${lineIndex}`}>
            {lineIndex ? <br /> : null}
            {inline(paragraphLine, `paragraph-${blockKey}-${lineIndex}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={cn("min-w-0 space-y-3", className)}>{blocks}</div>;
}

