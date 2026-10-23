import { describe, expect, it } from "vitest";

import {
  campaignBlockBoxStyle,
  campaignContainerStyle,
  campaignElementStyle,
  campaignBlockStyle,
  campaignBlockTextStyle,
  campaignElementFill,
  resolveCampaignVideo,
} from "./campaign-blocks";

describe("element fill versus block background", () => {
  it("keeps a button's own colour off the band behind it", () => {
    const button = {
      ...createCampaignBlock("button"),
      design: { elementBackground: "#16A34A" },
    };
    // The element fill is what the button paints with.
    expect(campaignElementFill(button, "#635BFF")).toBe("#16A34A");
    // The block wrapper stays unpainted, so the strip does not turn green too.
    expect(campaignBlockStyle(button).backgroundColor).toBeUndefined();
  });

  it("paints only the band when the block background is what was set", () => {
    const button = {
      ...createCampaignBlock("button"),
      design: { container: { backgroundColor: "#F1F5F9" } },
    };
    expect(campaignContainerStyle(button).backgroundColor).toBe("#F1F5F9");
    // With no element fill chosen, the button still follows the campaign accent.
    expect(campaignElementFill(button, "#635BFF")).toBe("#635BFF");
  });

  it("lets both surfaces be set independently", () => {
    const button = {
      ...createCampaignBlock("button"),
      design: {
        elementBackground: "#16A34A",
        container: { backgroundColor: "#F1F5F9" },
      },
    };
    expect(campaignElementFill(button, "#635BFF")).toBe("#16A34A");
    expect(campaignContainerStyle(button).backgroundColor).toBe("#F1F5F9");
  });

  it("falls back to the campaign accent for an unusable colour", () => {
    const button = {
      ...createCampaignBlock("button"),
      design: { elementBackground: "not-a-colour" },
    };
    expect(campaignElementFill(button, "#635BFF")).toBe("#635BFF");
  });
});

describe("design styles reach the element that renders them", () => {
  const styled = {
    ...createCampaignBlock("heading"),
    design: {
      fontSize: 60,
      textColor: "#EA580C",
      fontWeight: 700 as const,
      lineHeight: 1.1,
      letterSpacing: 2,
      textTransform: "uppercase" as const,
      fontFamily: "Georgia, serif",
      borderRadius: 10,
      container: {
        padding: { top: 8, right: 12, bottom: 8, left: 12 },
        backgroundColor: "#F1F5F9",
        borderRadius: 6,
      },
    },
  };

  it("puts typography and colour on the text node, not on a wrapper", () => {
    // A wrapper cannot carry these: the renderer sets its own size and colour
    // as classes on the text element, and a class beats an inherited value.
    const text = campaignBlockTextStyle(styled);
    expect(text.fontSize).toBe("60px");
    expect(text.color).toBe("#EA580C");
    expect(text.fontWeight).toBe("700");
    expect(text.lineHeight).toBe("1.1");
    expect(text.letterSpacing).toBe("2px");
    expect(text.textTransform).toBe("uppercase");
    expect(text.fontFamily).toBe("Georgia, serif");
  });

  it("keeps box styling out of the text style, so it lands on the wrapper", () => {
    const text = campaignBlockTextStyle(styled);
    expect(text.padding).toBeUndefined();
    expect(text.backgroundColor).toBeUndefined();
    expect(text.borderRadius).toBeUndefined();

    const box = campaignBlockBoxStyle(styled);
    expect(box.padding).toBe("8px 12px 8px 12px");
    expect(box.backgroundColor).toBe("#F1F5F9");
    // The container's own radius, not the element's.
    expect(box.borderRadius).toBe("6px");
  });

  it("keeps typography out of the box style, so a wrapper cannot swallow it", () => {
    const box = campaignBlockBoxStyle(styled);
    expect(box.fontSize).toBeUndefined();
    expect(box.color).toBeUndefined();
  });

  it("still composes both halves for the exported HTML", () => {
    // The export puts everything on one element, so it needs the union.
    const combined = campaignBlockStyle(styled);
    expect(combined.fontSize).toBe("60px");
    expect(combined.padding).toBe("8px 12px 8px 12px");
  });

  it("emits nothing for a block nobody has styled", () => {
    const plain = createCampaignBlock("heading");
    expect(Object.keys(campaignBlockTextStyle(plain))).toHaveLength(0);
    expect(Object.keys(campaignBlockBoxStyle(plain))).toHaveLength(0);
  });
});

describe("container and element are separate style layers", () => {
  const button = {
    ...createCampaignBlock("button"),
    design: {
      // Element: the button's own outline and fill.
      borderWidth: 2,
      borderColor: "#16A34A",
      borderRadius: 24,
      elementBackground: "#16A34A",
      // Container: the strip the button sits on.
      container: {
        backgroundColor: "#F1F5F9",
        padding: { top: 24, right: 16, bottom: 24, left: 16 },
        borderWidth: 1,
        borderColor: "#E2E8F0",
        borderRadius: 8,
      },
    },
  };

  it("puts the element's border on the element", () => {
    // This is the reported bug: a button border drew around the whole block.
    const element = campaignElementStyle(button);
    expect(element.borderWidth).toBe("2px");
    expect(element.borderColor).toBe("#16A34A");
    expect(element.borderRadius).toBe("24px");
  });

  it("keeps the element's border off the container", () => {
    const container = campaignContainerStyle(button);
    // The container has its own, different border — not the button's.
    expect(container.borderWidth).toBe("1px");
    expect(container.borderColor).toBe("#E2E8F0");
    expect(container.borderRadius).toBe("8px");
  });

  it("keeps container padding and background off the element", () => {
    const element = campaignElementStyle(button);
    expect(element.padding).toBeUndefined();
    expect(element.backgroundColor).toBeUndefined();

    const container = campaignContainerStyle(button);
    expect(container.padding).toBe("24px 16px 24px 16px");
    expect(container.backgroundColor).toBe("#F1F5F9");
  });

  it("lets the two layers hold conflicting values without either winning", () => {
    // Both set a radius; each keeps its own rather than one overwriting the
    // other, which is the whole point of separating them.
    expect(campaignElementStyle(button).borderRadius).toBe("24px");
    expect(campaignContainerStyle(button).borderRadius).toBe("8px");
  });

  it("emits nothing for either layer on an untouched block", () => {
    const plain = createCampaignBlock("button");
    expect(Object.keys(campaignElementStyle(plain))).toHaveLength(0);
    expect(Object.keys(campaignContainerStyle(plain))).toHaveLength(0);
  });

  it("puts the element's own inner padding on the element, not the block", () => {
    const padded = {
      ...createCampaignBlock("button"),
      design: { elementPadding: { top: 14, right: 28, bottom: 14, left: 28 } },
    };
    expect(campaignElementStyle(padded).padding).toBe("14px 28px 14px 28px");
    expect(campaignContainerStyle(padded).padding).toBeUndefined();
  });

  it("scopes element size to the element", () => {
    const sized = {
      ...createCampaignBlock("image"),
      design: { width: 320, height: 200, objectFit: "contain" as const },
    };
    const element = campaignElementStyle(sized);
    expect(element.width).toBe("320px");
    expect(element.height).toBe("200px");
    expect(element.objectFit).toBe("contain");
    expect(campaignContainerStyle(sized).width).toBeUndefined();
  });
});

describe("responsive values", () => {
  const block = {
    ...createCampaignBlock("heading"),
    design: {
      fontSize: 40,
      lineHeight: 1.2,
      textColor: "#111111",
      tablet: { fontSize: 32 },
      mobile: { fontSize: 24 },
    },
  };

  it("renders the desktop value when no override applies", () => {
    expect(campaignBlockTextStyle(block, "desktop").fontSize).toBe("40px");
  });

  it("uses each screen's own override", () => {
    expect(campaignBlockTextStyle(block, "tablet").fontSize).toBe("32px");
    expect(campaignBlockTextStyle(block, "mobile").fontSize).toBe("24px");
  });

  it("inherits anything a narrower screen did not override", () => {
    // Only fontSize varies; colour and line height come from desktop.
    const mobile = campaignBlockTextStyle(block, "mobile");
    expect(mobile.color).toBe("#111111");
    expect(mobile.lineHeight).toBe("1.2");
  });

  it("lets mobile fall through to tablet when it states nothing", () => {
    const tabletOnly = {
      ...createCampaignBlock("heading"),
      design: { fontSize: 40, tablet: { fontSize: 30 } },
    };
    expect(campaignBlockTextStyle(tabletOnly, "mobile").fontSize).toBe("30px");
  });

  it("leaves a block with no responsive values identical everywhere", () => {
    const plain = {
      ...createCampaignBlock("heading"),
      design: { fontSize: 40 },
    };
    expect(campaignBlockTextStyle(plain, "mobile")).toEqual(
      campaignBlockTextStyle(plain, "desktop"),
    );
  });
});

describe("background and effects", () => {
  it("renders a gradient over the solid colour", () => {
    const block = {
      ...createCampaignBlock("hero"),
      design: {
        container: {
          backgroundColor: "#FFFFFF",
          gradient: { from: "#635BFF", to: "#FFFFFF", angle: 90 },
        },
      },
    };
    const style = campaignBlockBoxStyle(block);
    expect(style.backgroundImage).toContain("linear-gradient(90deg");
    // The colour stays as the fallback for clients that drop gradients.
    expect(style.backgroundColor).toBe("#FFFFFF");
  });

  it("layers a background image and keeps its sizing", () => {
    const block = {
      ...createCampaignBlock("hero"),
      design: {
        container: {
          backgroundImage: "https://cdn.test/bg.jpg",
          backgroundSize: "contain" as const,
          backgroundPosition: "top" as const,
        },
      },
    };
    const style = campaignBlockBoxStyle(block);
    expect(style.backgroundImage).toContain("https://cdn.test/bg.jpg");
    expect(style.backgroundSize).toBe("contain");
    expect(style.backgroundPosition).toBe("top");
  });

  it("converts opacity to a fraction, and omits it at full", () => {
    // Each layer carries its own opacity, so a faded element does not fade the
    // band behind it.
    const half = {
      ...createCampaignBlock("text"),
      design: { container: { opacity: 40 } },
    };
    expect(campaignContainerStyle(half).opacity).toBe("0.4");
    const element = {
      ...createCampaignBlock("text"),
      design: { opacity: 40 },
    };
    expect(campaignElementStyle(element).opacity).toBe("0.4");
    expect(campaignContainerStyle(element).opacity).toBeUndefined();

    const full = {
      ...createCampaignBlock("text"),
      design: { container: { opacity: 100 } },
    };
    expect(campaignContainerStyle(full).opacity).toBeUndefined();
  });

  it("maps each shadow-sm step to a real box-shadow, and none to nothing", () => {
    for (const shadow of ["sm", "md", "lg"] as const) {
      const block = {
        ...createCampaignBlock("text"),
        design: { container: { shadow } },
      };
      expect(campaignContainerStyle(block).boxShadow).toContain("rgba");
    }
    const none = {
      ...createCampaignBlock("text"),
      design: { container: { shadow: "none" as const } },
    };
    expect(campaignContainerStyle(none).boxShadow).toBeUndefined();
  });
});

describe("video URL detection", () => {
  it("recognises every shape a YouTube link comes in", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      const video = resolveCampaignVideo(url);
      expect(video?.provider).toBe("youtube");
      expect(video?.id).toBe("dQw4w9WgXcQ");
      expect(video?.embedUrl).toBe(
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
      );
    }
  });

  it("derives a thumbnail from a YouTube link, so a poster is never needed", () => {
    const video = resolveCampaignVideo("https://youtu.be/dQw4w9WgXcQ");
    expect(video?.thumbnail).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  it("recognises Vimeo links", () => {
    const video = resolveCampaignVideo("https://vimeo.com/824804225");
    expect(video?.provider).toBe("vimeo");
    expect(video?.embedUrl).toBe("https://player.vimeo.com/video/824804225");
  });

  it("recognises direct video files, hosted or uploaded", () => {
    expect(resolveCampaignVideo("https://cdn.test/promo.mp4")?.provider).toBe(
      "file",
    );
    expect(resolveCampaignVideo("https://cdn.test/a.webm?v=2")?.provider).toBe(
      "file",
    );
    expect(resolveCampaignVideo("data:video/mp4;base64,AAAA")?.provider).toBe(
      "file",
    );
  });

  it("returns nothing for a link that is not a video", () => {
    // An image URL previously rendered as a broken video frame.
    expect(resolveCampaignVideo("https://cdn.test/photo.png")).toBeNull();
    expect(resolveCampaignVideo("https://example.com")).toBeNull();
    expect(resolveCampaignVideo("")).toBeNull();
    expect(resolveCampaignVideo(undefined)).toBeNull();
  });
});

describe("block alignment", () => {
  it("carries all four standard alignments into the rendered style", () => {
    for (const align of ["left", "center", "right", "justify"] as const) {
      const block = {
        ...createCampaignBlock("text"),
        design: { textAlign: align },
      };
      expect(campaignBlockStyle(block).textAlign).toBe(align);
    }
  });
});

import {
  campaignBlocksPayload,
  campaignDesignFromBlocks,
  campaignHasComplianceFooter,
  campaignPlainText,
  campaignSpamReport,
  composeCampaignHtml,
  countdownRemaining,
  createCampaignBlock,
  emptyCampaignDesign,
  type CampaignDesign,
} from "./campaign-blocks";

const designWith = (
  types: Parameters<typeof createCampaignBlock>[0][],
): CampaignDesign => ({
  ...emptyCampaignDesign(),
  blocks: types.map((type) => createCampaignBlock(type)),
});

describe("campaign block composition", () => {
  it("round-trips a design through the stored envelope", () => {
    const design = designWith(["heading", "text", "button"]);
    design.accent = "#112233";
    design.footerText = "Sent by Acme";
    design.authoringMode = "builder";

    const restored = campaignDesignFromBlocks(campaignBlocksPayload(design));

    expect(restored.legacyHtml).toBe("");
    expect(restored.design.accent).toBe("#112233");
    expect(restored.design.footerText).toBe("Sent by Acme");
    expect(restored.design.authoringMode).toBe("builder");
    expect(restored.design.blocks.map((block) => block.type)).toEqual([
      "heading",
      "text",
      "button",
    ]);
  });

  it("keeps a pre-block campaign's HTML instead of discarding it", () => {
    const restored = campaignDesignFromBlocks([
      { type: "campaign_design", version: 1, legacyHtml: "<p>Old body</p>" },
    ]);

    expect(restored.legacyHtml).toBe("<p>Old body</p>");
    expect(restored.design.blocks).toEqual([]);
  });

  it("drops buttons whose link is not a secure address", () => {
    const design = designWith(["button"]);
    design.blocks[0] = {
      ...design.blocks[0],
      content: "Click me",
      href: "javascript:alert(1)",
    };

    const html = composeCampaignHtml(design);

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Click me");
  });

  it("escapes text so block content cannot inject markup", () => {
    const design = designWith(["heading"]);
    design.blocks[0] = {
      ...design.blocks[0],
      content: '<script>alert("x")</script>',
    };

    const html = composeCampaignHtml(design);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the product grid in rows matching the column count", () => {
    const design = designWith(["product_grid"]);
    design.blocks[0] = {
      ...design.blocks[0],
      columns: 2,
      items: [
        { id: "a", title: "Alpha", price: "$10", imageSrc: "", href: "" },
        { id: "b", title: "Beta", price: "$20", imageSrc: "", href: "" },
        { id: "c", title: "Gamma", price: "$30", imageSrc: "", href: "" },
      ],
    };

    // The grid is the only table carrying this margin, so it can be isolated
    // from the surrounding email shell.
    const grid = composeCampaignHtml(design).match(
      /<table[^>]*style="margin:0 0 12px">([\s\S]*?)<\/table>/,
    )?.[1];

    // Three items at two columns is two rows: two cells then one.
    expect(grid?.match(/<tr>/g)).toHaveLength(2);
    expect(grid?.match(/<td /g)).toHaveLength(3);
    expect(grid).toContain("Alpha");
    expect(grid).toContain("Gamma");
  });

  it("points the countdown at the server-rendered image endpoint", () => {
    const design = designWith(["countdown"]);

    const html = composeCampaignHtml(design);

    expect(html).toContain("/api/campaigns/countdown");
    expect(html).toContain("alt=\"Time remaining in this offer\"");
  });

  it("uses a YouTube thumbnail as the email-safe video poster", () => {
    const design = designWith(["video"]);
    design.blocks[0] = {
      ...design.blocks[0],
      href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      posterSrc: "",
    };

    const html = composeCampaignHtml(design);

    expect(html).toContain(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(html).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(html).toContain("Watch on YouTube");
    expect(html).toContain("&#9654;");
    expect(html).not.toContain("<iframe");
  });

  it("summarises every block type as plain text", () => {
    const design = designWith(["hero", "testimonial", "divider", "spacer"]);

    const text = campaignPlainText(design);

    expect(text).toContain("Summer sale is live");
    expect(text).toContain("only tool our team never argues about");
    expect(text).not.toContain("undefined");
  });
});

describe("compliance footer gate", () => {
  it("does not count a footer block with no address", () => {
    expect(campaignHasComplianceFooter(designWith(["compliance_footer"]))).toBe(
      false,
    );
  });

  it("counts a footer block once an address is filled in", () => {
    const design = designWith(["compliance_footer"]);
    design.blocks[0] = {
      ...design.blocks[0],
      mailingAddress: "1 Example Street, Lagos",
    };

    expect(campaignHasComplianceFooter(design)).toBe(true);
  });
});

describe("spam report", () => {
  const compliant = () => {
    const design = designWith(["text", "compliance_footer"]);
    design.blocks[0] = {
      ...design.blocks[0],
      content: Array.from({ length: 60 }, () => "word").join(" "),
    };
    design.blocks[1] = {
      ...design.blocks[1],
      mailingAddress: "1 Example Street",
    };
    return design;
  };

  it("passes a plain, compliant message", () => {
    const report = campaignSpamReport({
      subject: "Your March order summary is ready",
      previewText: "A short recap of the month",
      design: compliant(),
    });

    expect(report.rating).toBe("good");
    expect(report.findings).toEqual([]);
  });

  it("flags a missing compliance footer as a blocking finding", () => {
    const report = campaignSpamReport({
      subject: "A normal subject line for testing",
      previewText: "Preheader",
      design: designWith(["text"]),
    });

    const finding = report.findings.find((entry) => entry.id === "compliance");
    expect(finding?.severity).toBe("high");
    expect(finding?.message).toContain("blocks sending");
  });

  it("flags shouting subjects, spam phrasing, and exclamation runs", () => {
    const report = campaignSpamReport({
      subject: "ACT NOW FREE MONEY GUARANTEED!!!",
      previewText: "",
      design: compliant(),
    });

    const ids = report.findings.map((finding) => finding.id);
    expect(ids).toContain("subject-caps");
    expect(ids).toContain("phrases");
    expect(ids).toContain("exclamations");
    expect(report.rating).toBe("poor");
  });

  it("flags an image-heavy body with almost no copy", () => {
    const design = designWith(["image", "compliance_footer"]);
    design.blocks[0] = {
      ...design.blocks[0],
      src: "https://example.com/banner.png",
    };
    design.blocks[1] = {
      ...design.blocks[1],
      mailingAddress: "1 Example Street",
    };

    const report = campaignSpamReport({
      subject: "Our new spring collection has landed",
      previewText: "Have a look",
      design,
    });

    expect(report.findings.map((finding) => finding.id)).toContain(
      "image-ratio",
    );
  });

  it("caps the score at 100 however many problems pile up", () => {
    const report = campaignSpamReport({
      subject: "FREE MONEY GUARANTEED ACT NOW BUY NOW CLICK HERE URGENT!!!!!!",
      previewText: "",
      design: designWith(["image", "button"]),
    });

    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.score).toBeGreaterThan(45);
  });
});

describe("countdown remaining", () => {
  it("reports nothing for an unparseable deadline", () => {
    expect(countdownRemaining("not a date")).toBeNull();
  });

  it("marks a past deadline rather than showing negative time", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(countdownRemaining(past)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      past: true,
    });
  });

  it("splits future time into days, hours, and minutes", () => {
    const future = new Date(
      Date.now() + (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 30_000),
    ).toISOString();

    expect(countdownRemaining(future)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      past: false,
    });
  });
});
