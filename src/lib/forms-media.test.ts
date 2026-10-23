import { describe, expect, it } from "vitest";

import {
  defaultFormSettings,
  type FormRecord,
} from "@/components/forms/form-types";
import {
  canonicalizePreparedFormSubmission,
  prepareFormSubmissionAnswers,
} from "@/lib/forms";

const form: FormRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "media-test",
  projectId: null,
  title: "Media test",
  description: "",
  fields: [
    {
      id: "resume",
      type: "file",
      label: "Resume",
      required: true,
      config: { acceptedFileTypes: "pdf", maxFileSizeMb: 2 },
    },
    {
      id: "signature",
      type: "signature",
      label: "Signature",
      required: true,
    },
  ],
  settings: defaultFormSettings(),
  status: "published",
  createdBy: "user-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  responseCount: 0,
};

describe("prepareFormSubmissionAnswers", () => {
  it("moves media payloads out of answer JSON and keeps linked metadata", () => {
    const result = prepareFormSubmissionAnswers(form, {
      resume: {
        kind: "file",
        dataUrl: "data:application/pdf;base64,AAAA",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        size: 3,
      },
      signature: {
        kind: "signature",
        dataUrl: "data:image/png;base64,AAAA",
        width: 900,
        height: 240,
      },
    });

    expect(result.media).toHaveLength(2);
    expect(result.media.map((item) => item.content.type)).toEqual([
      "application/pdf",
      "image/png",
    ]);
    expect(result.media.map((item) => item.content.size)).toEqual([3, 3]);
    expect(result.storedAnswers.resume).toMatchObject({
      kind: "file",
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      size: 3,
    });
    expect(result.storedAnswers.signature).toMatchObject({
      kind: "signature",
      mimeType: "image/png",
    });
    expect(JSON.stringify(result.storedAnswers)).not.toContain("base64");
  });

  it("rejects the wrong file type with a respondent-safe message", () => {
    expect(() =>
      prepareFormSubmissionAnswers(form, {
        resume: {
          kind: "file",
          dataUrl: "data:image/png;base64,AAAA",
          fileName: "photo.png",
          mimeType: "image/png",
          size: 3,
        },
        signature: {
          kind: "signature",
          dataUrl: "data:image/png;base64,AAAA",
          width: 900,
          height: 240,
        },
      }),
    ).toThrow("Choose an accepted file type for Resume.");
  });

  it("recomputes calculated and hidden fields from the saved form schema", () => {
    const sourceOfTruthForm: FormRecord = {
      ...form,
      fields: [
        {
          id: "quantity",
          type: "number",
          label: "Quantity",
          required: true,
          validation: { min: 1, max: 20 },
        },
        {
          id: "source",
          type: "hidden",
          label: "Source",
          defaultValue: "public-form",
        },
        {
          id: "total",
          type: "calculated",
          label: "Total",
          formula: "{quantity} * 12.5",
        },
      ],
    };
    const result = prepareFormSubmissionAnswers(sourceOfTruthForm, {
      quantity: 4,
      source: "tampered",
      total: 9999,
    });

    expect(result.storedAnswers).toEqual({
      quantity: 4,
      source: "public-form",
      total: 50,
    });
  });

  it("enforces conditional required rules and configured choice values", () => {
    const conditionalForm: FormRecord = {
      ...form,
      fields: [
        {
          id: "request-type",
          type: "dropdown",
          label: "Request type",
          options: ["General", "Other"],
          required: true,
        },
        {
          id: "details",
          type: "shortText",
          label: "Other details",
        },
      ],
      settings: {
        ...form.settings,
        logic: [
          {
            id: "require-details",
            sourceFieldId: "request-type",
            operator: "equals",
            value: "Other",
            action: "require",
            targetFieldId: "details",
          },
        ],
      },
    };

    expect(() =>
      prepareFormSubmissionAnswers(conditionalForm, {
        "request-type": "Other",
      }),
    ).toThrow("Answer Other details before submitting.");
    expect(() =>
      prepareFormSubmissionAnswers(conditionalForm, {
        "request-type": "Unknown",
        details: "A value",
      }),
    ).toThrow("Request type contains an unavailable option.");
  });

  it("revalidates prepared public answers and overwrites derived values", () => {
    const protectedForm: FormRecord = {
      ...form,
      fields: [
        { id: "quantity", type: "number", label: "Quantity", required: true, validation: { min: 1, max: 10 } },
        { id: "source", type: "hidden", label: "Source", defaultValue: "public" },
        { id: "total", type: "calculated", label: "Total", formula: "{quantity} * 5" },
      ],
    };

    expect(
      canonicalizePreparedFormSubmission(
        protectedForm,
        { quantity: 2, source: "tampered", total: 999 },
        [],
      ),
    ).toEqual({ quantity: 2, source: "public", total: 10 });
    expect(() =>
      canonicalizePreparedFormSubmission(protectedForm, { quantity: 999 }, []),
    ).toThrow("Quantity must be no more than 10.");
    expect(() => canonicalizePreparedFormSubmission(protectedForm, {}, [])).toThrow(
      "Answer Quantity before submitting.",
    );
  });

  it("canonicalizes structured answers and rejects invalid matrix choices", () => {
    const structuredForm: FormRecord = {
      ...form,
      fields: [
        {
          id: "matrix",
          type: "matrix",
          label: "Satisfaction",
          options: ["Low", "High"],
          config: { matrixRows: ["Speed", "Quality"] },
          required: true,
        },
        { id: "address", type: "address", label: "Address", required: true },
        { id: "location", type: "location", label: "Location", required: true },
      ],
    };
    const result = canonicalizePreparedFormSubmission(
      structuredForm,
      {
        matrix: { Speed: "High", Quality: "Low" },
        address: { street: "1 Marina Road", city: "Lagos", country: "Nigeria", ignored: "removed" },
        location: { latitude: "6.455", longitude: "3.384" },
      },
      [],
    );
    expect(result.address).toEqual({
      street: "1 Marina Road",
      city: "Lagos",
      country: "Nigeria",
    });
    expect(result.location).toEqual({ latitude: 6.455, longitude: 3.384 });
    expect(() =>
      canonicalizePreparedFormSubmission(
        structuredForm,
        {
          matrix: { Speed: "Unknown", Quality: "Low" },
          address: { street: "1 Marina Road", city: "Lagos", country: "Nigeria" },
          location: { latitude: 6.455, longitude: 3.384 },
        },
        [],
      ),
    ).toThrow("Satisfaction must include one available choice for every row.");
  });

  it("canonicalizes catalog cart lines and rejects price or stock tampering", () => {
    const commerceForm: FormRecord = {
      ...form,
      fields: [
        {
          id: "products",
          type: "product",
          label: "Products",
          required: true,
          config: {
            productIds: ["product-shirt"],
            allowMultipleProducts: true,
            minProductQuantity: 1,
            maxProductQuantity: 5,
            catalogProducts: [
              {
                id: "product-shirt",
                name: "T-shirt",
                description: "",
                sku: "SHIRT",
                price: 20,
                currency: "USD",
                requiresShipping: true,
                availableQuantity: null,
                allowBackorder: false,
                variants: [
                  {
                    id: "variant-black",
                    name: "Black",
                    sku: "SHIRT-BLK",
                    price: 24,
                    optionValues: { Color: "Black" },
                    availableQuantity: 3,
                    allowBackorder: false,
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    expect(
      canonicalizePreparedFormSubmission(
        commerceForm,
        {
          products: [
            {
              productId: "product-shirt",
              variantId: "variant-black",
              quantity: 2,
              unitPrice: 0.01,
              name: "Tampered",
            },
          ],
        },
        [],
      ),
    ).toEqual({
      products: [
        { productId: "product-shirt", variantId: "variant-black", quantity: 2 },
      ],
    });
    expect(() =>
      canonicalizePreparedFormSubmission(
        commerceForm,
        { products: [{ productId: "product-shirt", variantId: "variant-black", quantity: 4 }] },
        [],
      ),
    ).toThrow("Products quantity is no longer in stock.");
    expect(() =>
      canonicalizePreparedFormSubmission(
        commerceForm,
        { products: [{ productId: "unknown", quantity: 1 }] },
        [],
      ),
    ).toThrow("Products contains an unavailable or duplicate product.");
  });
});
