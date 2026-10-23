// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { PricingInput } from "@/components/shared/PricingInput";

function PricingInputHarness() {
  const [value, setValue] = useState(12);
  return (
    <PricingInput
      id="registration-price"
      label="Registration price"
      currency="USD"
      value={value}
      onValueChange={setValue}
    />
  );
}

describe("PricingInput", () => {
  it("displays and commits monetary values with two decimal places", () => {
    render(<PricingInputHarness />);
    const input = screen.getByLabelText("Registration price value");

    expect(input).toHaveValue("12.00");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "15.5" } });
    expect(input).toHaveValue("15.5");
    fireEvent.blur(input);
    expect(input).toHaveValue("15.50");
  });

  it("rejects a third decimal place", () => {
    render(<PricingInputHarness />);
    const input = screen.getByLabelText("Registration price value");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "12.345" } });
    expect(input).toHaveValue("12.00");
  });
});
