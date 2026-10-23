import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormBuilder } from "@/components/forms/FormBuilder";
import {
  defaultFormSettings,
  type FormRecord,
} from "@/components/forms/form-types";

const fixture = (): FormRecord => ({
  id: "form-builder-test",
  slug: "form-builder-test",
  projectId: null,
  title: "Builder test",
  description: "Builder fixture",
  fields: [
    {
      id: "field-one",
      type: "shortText",
      label: "First field",
      width: "full",
      config: {
        blockStyle: {
          fontFamily: "Arial",
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.8,
          inputBackgroundColor: "#101010",
        },
      },
    },
    {
      id: "field-two",
      type: "email",
      label: "Second field",
      width: "full",
    },
  ],
  settings: defaultFormSettings(),
  status: "draft",
  createdBy: "user-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  responseCount: 0,
});

const renderBuilder = (form: FormRecord, onChange = vi.fn()) => {
  render(
    <FormBuilder
      form={form}
      onChange={onChange}
      onPreview={vi.fn()}
      onRestoreVersion={vi.fn()}
      onSaveDraft={vi.fn()}
      saveState="saved"
    />,
  );
  return onChange;
};

describe("FormBuilder history and field styling", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("copies the selected block style to every field with a loading state", async () => {
    const form = fixture();
    const onChange = renderBuilder(form);

    vi.useFakeTimers();
    try {
      fireEvent.click(
        screen.getByRole("button", { name: "Apply to all fields" }),
      );
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        screen.getByRole("button", { name: "Applying" }),
      ).toBeDisabled();
      expect(onChange).toHaveBeenCalledTimes(1);

      const nextForm = onChange.mock.calls[0][0] as FormRecord;
      expect(nextForm.fields[1].config?.blockStyle).toEqual(
        form.fields[0].config?.blockStyle,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(
        screen.getByRole("button", { name: "Apply to all fields" }),
      ).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports undo and redo for field changes", () => {
    const ControlledBuilder = () => {
      const [form, setForm] = useState(fixture);
      return (
        <FormBuilder
          form={form}
          onChange={setForm}
          onPreview={vi.fn()}
          onRestoreVersion={vi.fn()}
          onSaveDraft={vi.fn()}
          saveState="saved"
        />
      );
    };
    render(<ControlledBuilder />);

    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Changed field" },
    });

    const undo = screen.getByRole("button", { name: "Undo last change" });
    const redo = screen.getByRole("button", { name: "Redo last change" });
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();

    fireEvent.click(undo);
    expect(screen.getByLabelText("Label")).toHaveValue("First field");
    expect(redo).toBeEnabled();

    fireEvent.click(redo);
    expect(screen.getByLabelText("Label")).toHaveValue("Changed field");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByLabelText("Label")).toHaveValue("First field");

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    expect(screen.getByLabelText("Label")).toHaveValue("Changed field");
  });
});
