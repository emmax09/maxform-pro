import { describe, expect, it } from "vitest";

import { appointmentNotificationTemplate } from "./appointments-data";

const appointment = (status: string, startsAt = "2026-08-08T12:00:00.000Z") => ({
  status,
  starts_at: startsAt,
});

describe("appointment notification selection", () => {
  it("sends a confirmation for a newly confirmed appointment", () => {
    expect(appointmentNotificationTemplate(undefined, appointment("confirmed")))
      .toBe("appointment_confirmed");
  });

  it("sends cancellation only on the transition into cancelled", () => {
    expect(appointmentNotificationTemplate(
      appointment("confirmed"),
      appointment("cancelled"),
    )).toBe("appointment_cancelled");
    expect(appointmentNotificationTemplate(
      appointment("cancelled"),
      appointment("cancelled"),
    )).toBeNull();
  });

  it("sends a reschedule when the start time changes", () => {
    expect(appointmentNotificationTemplate(
      appointment("confirmed"),
      appointment("confirmed", "2026-08-09T12:00:00.000Z"),
    )).toBe("appointment_rescheduled");
  });

  it("does not resend for an unrelated update", () => {
    expect(appointmentNotificationTemplate(
      appointment("confirmed"),
      appointment("confirmed"),
    )).toBeNull();
  });
});
