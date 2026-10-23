import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CampaignCountdown } from "./CampaignCountdown";
import { formatCampaignCountdown } from "./campaign-countdown";

describe("CampaignCountdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats hours, minutes, and seconds as a live clock", () => {
    expect(formatCampaignCountdown(0)).toBe("00:00:00");
    expect(formatCampaignCountdown(75)).toBe("00:01:15");
    expect(formatCampaignCountdown(90_061)).toBe("1d 01:01:01");
  });

  it("counts down every second and reaches due now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));

    const onDue = vi.fn();
    render(
      <CampaignCountdown
        scheduledAt="2026-08-04T00:00:03.000Z"
        onDue={onDue}
      />,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("00:00:03");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.getByRole("timer")).toHaveTextContent("00:00:00");
    expect(screen.getByText("Due now")).toBeInTheDocument();
    expect(onDue).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onDue).toHaveBeenCalledTimes(1);
  });
});
