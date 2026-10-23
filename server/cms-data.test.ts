// @vitest-environment node

import { describe, expect, it } from "vitest";

import { cmsDataTestHelpers } from "./cms-data";

describe("WooCommerce product payloads", () => {
  it("keeps variable parent data separate from variation data", () => {
    const parent = cmsDataTestHelpers.wooProductPayload({
      title: "T-shirt",
      productType: "variable",
      status: "publish",
      price: 0,
      inventoryManaged: false,
      inventoryQuantity: null,
      attributes: [{ id: 4, name: "Color", slug: "color", options: ["Black", "White"], visible: true, variation: true }],
      categoryIds: ["12"],
      images: ["https://cdn.example.com/shirt.jpg"],
      customFields: [{ id: 80, key: "_price_label", value: "Featured", valueType: "string" }],
      deletedCustomFieldIds: [],
      tags: [],
      description: "",
      sku: "",
      compareAtPrice: null,
      vendor: "",
      variants: [{ externalId: "21", attributes: { Color: "Black" }, price: 25 }],
      deletedVariantIds: [],
    });

    expect(parent.type).toBe("variable");
    expect(parent.regular_price).toBeUndefined();
    expect(parent.attributes).toEqual([{ id: 4, name: "Color", slug: "color", position: 0, visible: true, variation: true, options: ["Black", "White"] }]);
    expect(parent.categories).toEqual([{ id: 12 }]);
    expect(parent.images).toEqual([{ src: "https://cdn.example.com/shirt.jpg" }]);
    expect(parent.meta_data).toEqual([{ id: 80, key: "_price_label", value: "Featured" }]);
  });

  it("serializes variation prices, stock, attributes, image and typed custom fields", () => {
    const variation = cmsDataTestHelpers.wooVariationPayload({
      externalId: "21",
      status: "publish",
      sku: "TSHIRT-BLK",
      price: 25,
      compareAtPrice: 30,
      inventoryQuantity: 8,
      inventoryManaged: true,
      imageUrl: "https://cdn.example.com/black.jpg",
      attributes: { Color: "Black" },
      customFields: [{ key: "_supplier_cost", value: "12.5", valueType: "number" }],
      deletedCustomFieldIds: [],
    }, [{ id: 4, name: "Color", slug: "color", options: ["Black"], visible: true, variation: true }]);

    expect(variation).toMatchObject({
      status: "publish",
      sku: "TSHIRT-BLK",
      regular_price: "30.00",
      sale_price: "25.00",
      manage_stock: true,
      stock_quantity: 8,
      image: { src: "https://cdn.example.com/black.jpg" },
      attributes: [{ id: 4, name: "Color", option: "Black" }],
      meta_data: [{ key: "_supplier_cost", value: 12.5 }],
    });
  });

  it("uses WooCommerce metadata IDs to remove fields without touching other fields", () => {
    expect(cmsDataTestHelpers.customFieldUpdatePayload(
      [{ id: 20, key: "keep", value: "yes" }],
      [21],
    )).toEqual([
      { id: 20, key: "keep", value: "yes" },
      { id: 21, value: null },
    ]);
  });

  it("preserves the metadata key when deleting a field by ID", () => {
    const payload = cmsDataTestHelpers.wooProductPayload({
      title: "T-shirt",
      productType: "simple",
      status: "publish",
      price: 25,
      inventoryManaged: false,
      inventoryQuantity: null,
      description: "",
      sku: "",
      compareAtPrice: null,
      vendor: "",
      tags: [],
      deletedCustomFieldIds: [],
      deletedCustomFields: [{ id: 21, key: "_old_field" }],
    });
    expect(payload.meta_data).toEqual([{ id: 21, key: "_old_field", value: null }]);
  });
});
