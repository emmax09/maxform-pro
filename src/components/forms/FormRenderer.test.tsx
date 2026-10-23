import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FormRenderer } from "@/components/forms/FormRenderer";
import {
  defaultFormSettings,
  formFieldTypes,
  type FormAnswerValue,
  type FormField,
  type FormFieldType,
  type FormRecord,
} from "@/components/forms/form-types";

const responseTypes: FormFieldType[] = [...formFieldTypes];

const field = (
  type: FormFieldType,
  patch: Partial<FormField> = {},
): FormField => ({
  id: `field-${type}`,
  type,
  label: `${type} field`,
  options: [
    "dropdown",
    "multiSelect",
    "radio",
    "checkboxes",
    "ranking",
    "appointment",
    "imageChoice",
    "product",
    "matrix",
  ].includes(type)
    ? ["Option 1", "Option 2", "Option 3"]
    : undefined,
  config:
    type === "matrix"
      ? { matrixRows: ["Row 1", "Row 2"] }
      : type === "multipleFiles"
        ? { maxFiles: 5 }
        : undefined,
  width: "full",
  ...patch,
});

const fixture = (fields: FormField[]): FormRecord => ({
  id: "form-renderer-test",
  slug: "renderer-test",
  projectId: null,
  title: "Block test",
  description: "A public form fixture",
  fields,
  settings: defaultFormSettings(),
  status: "published",
  createdBy: "user-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  responseCount: 0,
});

describe("FormRenderer blocks", () => {
  beforeEach(() => {
    window.localStorage.clear();
    const context = {
      beginPath: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      stroke: vi.fn(),
      fillStyle: "",
      lineCap: "",
      lineJoin: "",
      lineWidth: 1,
      strokeStyle: "",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AAAA",
    );
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
      bottom: 160,
      height: 160,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  it.each(responseTypes)("renders the %s block", (type) => {
    expect(() =>
      render(<FormRenderer form={fixture([field(type)])} preview />),
    ).not.toThrow();
  });

  it("shows a fixed registration price before the final submit action", () => {
    render(
      <FormRenderer
        checkoutSummary={{
          amount: 45,
          currency: "USD",
          label: "Registration price",
        }}
        form={fixture([field("shortText")])}
      />,
    );

    const summary = screen.getByText("Registration price");
    const amount = screen.getByText(/45\.00/);
    const submit = screen.getByRole("button", {
      name: /continue to payment/i,
    });
    expect(summary).toBeInTheDocument();
    expect(amount).toBeInTheDocument();
    expect(
      summary.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses a payment-aware final action for paid forms and product blocks", () => {
    const paidForm = fixture([field("shortText")]);
    paidForm.settings.payment.enabled = true;
    const { rerender } = render(<FormRenderer form={paidForm} />);

    expect(
      screen.getByRole("button", { name: /continue to payment/i }),
    ).toBeInTheDocument();

    const productForm = fixture([field("product")]);
    rerender(<FormRenderer form={productForm} />);
    expect(
      screen.getByRole("button", { name: /continue to payment/i }),
    ).toBeInTheDocument();
  });

  it("uses the confirmation tab override for the final action label", () => {
    const form = fixture([field("shortText")]);
    form.settings.confirmation.submitButtonLabel = "Send application";
    render(<FormRenderer form={form} />);

    expect(
      screen.getByRole("button", { name: "Send application" }),
    ).toBeInTheDocument();
  });

  it("keeps the final action disabled until required fields are complete", () => {
    const form = fixture([
      field("shortText", { id: "required-name", label: "Full name", required: true }),
    ]);
    render(<FormRenderer form={form} onSubmit={vi.fn()} />);

    const submit = screen.getByRole("button", {
      name: "Complete required fields",
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Full name/i), {
      target: { value: "Ada Lovelace" },
    });

    expect(
      screen.getByRole("button", { name: "Submit" }),
    ).toBeEnabled();
  });

  it("hides coupon fields until this checkout explicitly accepts coupons", () => {
    const form = fixture([field("coupon")]);
    const { rerender } = render(<FormRenderer form={form} />);

    expect(screen.queryByLabelText("coupon field")).not.toBeInTheDocument();

    rerender(<FormRenderer form={form} couponsEnabled />);

    expect(screen.getByLabelText("coupon field")).toBeInTheDocument();
  });

  it("uses the themed dropdown control for select-based fields", () => {
    render(
      <FormRenderer
        form={fixture([field("dropdown"), field("appointment")])}
        preview
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "dropdown field" }).tagName,
    ).toBe("BUTTON");
    expect(
      screen.getByRole("combobox", { name: "appointment field" }).tagName,
    ).toBe("BUTTON");
  });

  it("keeps field typography and control styling scoped to each block", () => {
    render(
      <FormRenderer
        form={fixture([
          field("shortText", {
            id: "styled-field",
            label: "Styled field",
            config: {
              blockStyle: {
                fontFamily: "Arial",
                fontSize: 20,
                fontWeight: 700,
                lineHeight: 1.8,
                inputBackgroundColor: "#101010",
                placeholderColor: "#abcdef",
              },
            },
          }),
          field("shortText", { id: "plain-field", label: "Plain field" }),
        ])}
        preview
      />,
    );

    const styledBlock = screen
      .getByLabelText("Styled field")
      .closest(".maxform-field");
    const plainBlock = screen
      .getByLabelText("Plain field")
      .closest(".maxform-field");
    expect(styledBlock).not.toBeNull();
    expect(plainBlock).not.toBeNull();

    const styledStyle = styledBlock?.getAttribute("style") || "";
    const plainStyle = plainBlock?.getAttribute("style") || "";
    expect(styledStyle).toContain("--form-field-font-family: Arial");
    expect(styledStyle).toContain("--form-field-font-size: 20px");
    expect(styledStyle).toContain("--form-field-font-weight: 700");
    expect(styledStyle).toContain("--form-field-line-height: 1.8");
    expect(styledStyle).toContain("--form-field-input-bg: #101010");
    expect(styledStyle).toContain("--form-field-placeholder: #abcdef");
    expect(plainStyle).not.toContain("Arial");
    expect(plainStyle).not.toContain("#101010");
  });

  it("uses the shared rolling action state while submitting", () => {
    render(
      <FormRenderer
        form={fixture([field("shortText")])}
        submitting
      />,
    );

    const submit = screen.getByRole("button", { name: /submit/i });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(
      submit.querySelector("[data-button-loading-indicator]"),
    ).toBeInTheDocument();
  });

  it("requires a ticket selection and submits a quantity within its event limits", async () => {
    const onSubmit = vi.fn();
    const ticketField = field("dropdown", {
      id: "ticket-selection",
      label: "Choose your ticket",
      options: ["General admission", "VIP"],
      required: true,
      config: {
        ticketLimits: {
          "General admission": {
            currency: "NGN",
            max: 4,
            min: 1,
            price: 5000,
            remaining: 12,
          },
          VIP: {
            currency: "NGN",
            max: 2,
            min: 1,
            price: 15000,
            remaining: 0,
          },
        },
      },
    });
    const { container } = render(
      <FormRenderer
        form={fixture([
          field("shortText", {
            id: "full-name",
            label: "Full name",
            required: true,
          }),
          ticketField,
        ])}
        onSubmit={onSubmit}
      />,
    );

    const blockedSubmit = screen.getByRole("button", {
      name: /select a ticket to continue/i,
    });
    expect(blockedSubmit).toBeDisabled();
    expect(screen.getByRole("button", { name: /vip/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Full name/i), {
      target: { value: "Checkout Buyer" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /general admission/i }),
    );
    const quantity = screen.getByRole("spinbutton");
    expect(quantity).toHaveAttribute("max", "4");
    fireEvent.change(quantity, { target: { value: "3" } });

    const continueButton = screen.getByRole("button", {
      name: /continue to checkout/i,
    });
    expect(continueButton).toBeEnabled();
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(String(onSubmit.mock.calls[0][0]["ticket-selection"])),
    ).toEqual({ name: "General admission", quantity: 3 });
  });

  it("previews an uploaded image and includes it in the submitted answers", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <FormRenderer
        form={fixture([
          field("file", {
            config: { acceptedFileTypes: "images", maxFileSizeMb: 2 },
            required: true,
          }),
        ])}
        onSubmit={onSubmit}
      />,
    );
    const upload = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const image = new File(["image-content"], "profile.png", {
      type: "image/png",
    });

    fireEvent.change(upload, { target: { files: [image] } });

    expect(
      await screen.findByAltText("Preview of profile.png"),
    ).toBeInTheDocument();
    expect(screen.getByText("profile.png")).toBeInTheDocument();
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const answers = onSubmit.mock.calls[0][0] as Record<
      string,
      FormAnswerValue
    >;
    expect(answers["field-file"]).toMatchObject({
      kind: "file",
      fileName: "profile.png",
      mimeType: "image/png",
    });
  });

  it("captures a drawn signature and can clear it", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <FormRenderer
        form={fixture([field("signature", { required: true })])}
        onSubmit={onSubmit}
      />,
    );
    const canvas = screen.getByLabelText("signature field signature pad");

    fireEvent.pointerDown(canvas, { clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 140, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 85, pointerId: 1 });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]["field-signature"]).toEqual({
      kind: "signature",
      dataUrl: "data:image/png;base64,AAAA",
      height: 240,
      width: 900,
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.getByLabelText("signature field captured value"),
    ).toHaveValue("");
  });

  it("reorders ranking choices and evaluates calculated fields", () => {
    const onSubmit = vi.fn();
    const form = fixture([
      field("ranking", {
        id: "priority",
        label: "Priority",
        options: ["Quality", "Speed", "Price"],
      }),
      field("number", {
        id: "quantity",
        label: "Quantity",
      }),
      field("number", {
        id: "unit-price",
        label: "Unit price",
      }),
      field("calculated", {
        id: "total",
        label: "Total",
        formula: "{quantity} * {unit price}",
      }),
    ]);
    const { container } = render(
      <FormRenderer form={form} onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getByLabelText("Move Speed up"));
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Unit price"), {
      target: { value: "12.5" },
    });
    expect(screen.getByLabelText("Total calculated value")).toHaveValue("37.5");

    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      priority: ["Speed", "Quality", "Price"],
      quantity: 3,
      "unit-price": 12.5,
      total: 37.5,
    });
  });

  it("collects matrix, address, and location answers as structured data", () => {
    const onSubmit = vi.fn();
    const form = fixture([
      field("matrix", {
        id: "service-matrix",
        label: "Service matrix",
        options: ["Poor", "Good"],
        config: { matrixRows: ["Speed", "Quality"] },
        required: true,
      }),
      field("address", { id: "address", label: "Address", required: true }),
      field("location", { id: "location", label: "Location", required: true }),
    ]);
    const { container } = render(<FormRenderer form={form} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByLabelText("Speed: Good"));
    fireEvent.click(screen.getByLabelText("Quality: Poor"));
    fireEvent.change(screen.getByLabelText("Address Street address"), {
      target: { value: "1 Marina Road" },
    });
    fireEvent.change(screen.getByLabelText("Address City"), {
      target: { value: "Lagos" },
    });
    fireEvent.change(screen.getByLabelText("Address Country"), {
      target: { value: "Nigeria" },
    });
    fireEvent.change(screen.getByLabelText("Location latitude"), {
      target: { value: "6.455" },
    });
    fireEvent.change(screen.getByLabelText("Location longitude"), {
      target: { value: "3.384" },
    });
    fireEvent.submit(container.querySelector("form")!);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        "service-matrix": { Speed: "Good", Quality: "Poor" },
        address: expect.objectContaining({
          street: "1 Marina Road",
          city: "Lagos",
          country: "Nigeria",
        }),
        location: { latitude: "6.455", longitude: "3.384" },
      }),
    );
  });

  it("builds a multi-product cart with variants and quantities", () => {
    const onSubmit = vi.fn();
    const commerceField = field("product", {
      id: "products",
      label: "Choose products",
      required: true,
      options: undefined,
      config: {
        productIds: ["product-shirt", "product-mug"],
        allowMultipleProducts: true,
        showProductQuantity: true,
        minProductQuantity: 1,
        maxProductQuantity: 5,
        catalogProducts: [
          {
            id: "product-shirt",
            name: "T-shirt",
            description: "Premium cotton",
            sku: "SHIRT",
            price: 20,
            currency: "USD",
            requiresShipping: true,
            availableQuantity: null,
            allowBackorder: false,
            variants: [
              {
                id: "variant-black",
                name: "Black / Large",
                sku: "SHIRT-BLK-L",
                price: 24,
                optionValues: { Color: "Black", Size: "Large" },
                availableQuantity: 3,
                allowBackorder: false,
              },
            ],
          },
          {
            id: "product-mug",
            name: "Mug",
            description: "Ceramic mug",
            sku: "MUG",
            price: 12,
            currency: "USD",
            requiresShipping: true,
            availableQuantity: 8,
            allowBackorder: false,
            variants: [],
          },
        ],
      },
    });
    const { container } = render(
      <FormRenderer form={fixture([commerceField])} onSubmit={onSubmit} />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Add to order" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Increase T-shirt quantity" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to order" })[0]);
    fireEvent.submit(container.querySelector("form")!);

    expect(onSubmit).toHaveBeenCalledWith({
      products: [
        { productId: "product-shirt", variantId: "variant-black", quantity: 2 },
        { productId: "product-mug", quantity: 1 },
      ],
    });
  });
});
