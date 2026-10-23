import { query } from "../src/lib/db";
import { defaultFormSettings } from "../src/components/forms/form-types";

type Row = Record<string, unknown>;

const userId = "f326b6ea-37e9-4e37-805d-437b48b432c1";
const title = "MaxForm Commerce Gallery QA";
const baseSlug = "maxform-commerce-gallery-qa";
const starterKitImage = "/images/form-commerce/maxform-starter-kit.jpg";
const workshopPassImage = "/images/form-commerce/maxform-workshop-pass.jpg";

const productSeeds = [
  {
    name: "MaxForm Starter Kit",
    description: "A complete commerce-ready starter package for the form checkout test.",
    shortDescription: "Starter package with gallery images and variations.",
    sku: "MAXFORM-STARTER-QA",
    price: 25000,
    salePrice: 19900,
    category: "Starter, Featured",
    banner: "QA favourite",
    imageUrl: starterKitImage,
    imageGallery: [starterKitImage],
  },
  {
    name: "MaxForm Workshop Pass",
    description: "A second one-time product for testing multi-product carts and coupon eligibility.",
    shortDescription: "Workshop access pass.",
    sku: "MAXFORM-WORKSHOP-QA",
    price: 15000,
    salePrice: null,
    category: "Workshop",
    banner: "Limited seats",
    imageUrl: workshopPassImage,
    imageGallery: [workshopPassImage],
  },
];

async function ensureProduct(seed: (typeof productSeeds)[number]) {
  const existing = await query<Row>(
    "SELECT id FROM payment_products WHERE user_id = $1 AND source_type = $2 AND name = $3 LIMIT 1",
    [userId, "catalog", seed.name],
  );
  const values = [
    userId,
    seed.name,
    seed.description,
    seed.sku,
    seed.price,
    "NGN",
    "one_time",
    seed.imageUrl,
    JSON.stringify(seed.imageGallery),
    seed.shortDescription,
    seed.salePrice,
    seed.banner,
    seed.category,
    "active",
    1,
    1000,
    false,
    false,
    true,
    false,
    0,
    5,
    false,
    0,
    JSON.stringify(seed.name === productSeeds[0].name ? ["Colour", "Size"] : []),
  ];
  if (existing.rows[0]) {
    const updated = await query<Row>(
      `UPDATE payment_products
       SET description = $1, sku = $2, price = $3, currency = $4,
           billing_type = $5, image_url = $6, image_gallery = $7::jsonb,
           short_description = $8, sale_price = $9, promotional_banner = $10,
           category = $11, product_status = $12, active = TRUE,
           min_quantity = $13, max_quantity = $14, one_per_customer = $15,
           track_inventory = $16, hide_when_sold_out = $17,
           inventory_quantity = $18, low_stock_threshold = $19,
           allow_backorder = $20, weight_grams = $21, options = $22::jsonb,
           updated_at = NOW()
       WHERE id = $23 AND user_id = $24
       RETURNING id`,
      [
        seed.description,
        seed.sku,
        seed.price,
        "NGN",
        "one_time",
        seed.imageUrl,
        JSON.stringify(seed.imageGallery),
        seed.shortDescription,
        seed.salePrice,
        seed.banner,
        seed.category,
        "active",
        1,
        1000,
        false,
        false,
        false,
        0,
        5,
        false,
        0,
        JSON.stringify(seed.name === productSeeds[0].name ? ["Colour", "Size"] : []),
        existing.rows[0].id,
        userId,
      ],
    );
    return String(updated.rows[0].id);
  }
  const inserted = await query<Row>(
    `INSERT INTO payment_products (
       user_id, name, description, sku, price, currency, billing_type,
       source_type, image_url, image_gallery, short_description, sale_price,
       promotional_banner, category, product_status, min_quantity, max_quantity,
       one_per_customer, hide_when_sold_out, active, track_inventory,
       inventory_quantity, low_stock_threshold, allow_backorder, weight_grams,
       options, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13,
       $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26::jsonb,
       NOW(), NOW()
     ) RETURNING id`,
    [
      ...values.slice(0, 7),
      "catalog",
      ...values.slice(7),
    ],
  );
  return String(inserted.rows[0].id);
}

const productSnapshot = (row: Row, variants: Row[]) => ({
  id: String(row.id),
  name: String(row.name),
  description: String(row.description || ""),
  shortDescription: String(row.short_description || ""),
  sku: String(row.sku || ""),
  price: Number(row.price || 0),
  salePrice: row.sale_price == null ? null : Number(row.sale_price),
  currency: String(row.currency || "NGN"),
  imageUrl: String(row.image_url || ""),
  imageGallery: Array.isArray(row.image_gallery) ? row.image_gallery : [],
  promotionalBanner: String(row.promotional_banner || ""),
  category: String(row.category || ""),
  categories: String(row.category || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  status: String(row.product_status || "active"),
  availabilityStartAt: row.availability_start_at || "",
  availabilityEndAt: row.availability_end_at || "",
  minQuantity: Number(row.min_quantity || 1),
  maxQuantity: Number(row.max_quantity || 1000),
  onePerCustomer: Boolean(row.one_per_customer),
  hideWhenSoldOut: Boolean(row.hide_when_sold_out),
  requiresShipping: Boolean(row.requires_shipping),
  trackInventory: Boolean(row.track_inventory),
  availableQuantity: row.track_inventory ? Number(row.inventory_quantity || 0) : null,
  allowBackorder: Boolean(row.allow_backorder),
  variants: variants.map((variant) => ({
    id: String(variant.id),
    name: String(variant.name),
    sku: String(variant.sku || ""),
    price: Number(variant.price || 0),
    salePrice: variant.sale_price == null ? null : Number(variant.sale_price),
    description: String(variant.description || ""),
    optionValues: variant.option_values || {},
    imageUrl: String(variant.image_url || ""),
    availableQuantity: variant.track_inventory ? Number(variant.inventory_quantity || 0) : null,
    allowBackorder: Boolean(variant.allow_backorder),
    weightGrams: Number(variant.weight_grams || 0),
    availabilityStartAt: variant.availability_start_at || "",
    availabilityEndAt: variant.availability_end_at || "",
  })),
});

async function main() {
  const productIds = [];
  for (const seed of productSeeds) {
    productIds.push(await ensureProduct(seed));
  }

  const variantCount = await query<Row>(
    "SELECT COUNT(*)::int AS count FROM payment_product_variants WHERE product_id = $1",
    [productIds[0]],
  );
  if (Number(variantCount.rows[0]?.count || 0) === 0) {
    await query(
      `INSERT INTO payment_product_variants (
         product_id, name, sku, price, sale_price, option_values, image_url,
         track_inventory, inventory_quantity, low_stock_threshold, allow_backorder,
         active, sort_order
       ) VALUES
         ($1, $2, $3, $4, $5, $6::jsonb, $7, FALSE, 0, 5, FALSE, TRUE, 0),
         ($1, $8, $9, $10, $11, $12::jsonb, $13, FALSE, 0, 5, FALSE, TRUE, 1)`,
      [
        productIds[0],
        "Black / Standard",
        "MAXFORM-STARTER-BLK",
        19900,
        17900,
        JSON.stringify({ Colour: "Black", Size: "Standard" }),
        starterKitImage,
        "White / Standard",
        "MAXFORM-STARTER-WHT",
        19900,
        17900,
        JSON.stringify({ Colour: "White", Size: "Standard" }),
        starterKitImage,
      ],
    );
  }

  const productRows = await query<Row>(
    "SELECT * FROM payment_products WHERE id = ANY($1::uuid[]) ORDER BY created_at",
    [productIds],
  );
  const variantRows = await query<Row>(
    "SELECT * FROM payment_product_variants WHERE product_id = ANY($1::uuid[]) AND active = TRUE ORDER BY sort_order",
    [productIds],
  );
  const snapshots = productRows.rows.map((row) =>
    productSnapshot(
      row,
      variantRows.rows.filter((variant) => String(variant.product_id) === String(row.id)),
    ),
  );

  const existingForm = await query<Row>(
    "SELECT id, slug FROM forms WHERE created_by = $1 AND title = $2 LIMIT 1",
    [userId, title],
  );
  let slug = baseSlug;
  if (!existingForm.rows[0]) {
    const usedSlugs = await query<Row>(
      "SELECT slug FROM forms WHERE slug = $1 OR slug LIKE $2",
      [baseSlug, `${baseSlug}-%`],
    );
    const used = new Set(usedSlugs.rows.map((row) => String(row.slug)));
    let suffix = 2;
    while (used.has(slug)) slug = `${baseSlug}-${suffix++}`;
  } else {
    slug = String(existingForm.rows[0].slug);
  }

  const productField = {
    id: "commerce-products",
    type: "product",
    label: "Choose your package",
    helpText: "Select one or more packages. Use MAXFORM-GALLERY20 at checkout for 20% off.",
    required: true,
    options: [],
    width: "full",
    config: {
      productIds,
      catalogProducts: snapshots,
      allowMultipleProducts: true,
      showProductQuantity: true,
      minProductQuantity: 1,
      maxProductQuantity: 10,
      productDisplay: {
        style: "cards",
        columns: 2,
        showOrderSummary: true,
        hideSoldOutProducts: true,
        imageAspectRatio: "landscape",
        selectionStyle: "button",
        cardBorderRadius: 16,
        cardPadding: 16,
      },
    },
  };
  const fields = [
    {
      id: "customer-name",
      type: "shortText",
      label: "Full name",
      placeholder: "Jane Doe",
      required: true,
      options: [],
      width: "full",
    },
    {
      id: "customer-email",
      type: "email",
      label: "Email address",
      placeholder: "jane@example.com",
      required: true,
      options: [],
      width: "full",
    },
    productField,
  ];

  const settings = defaultFormSettings();
  settings.payment = {
    ...settings.payment,
    enabled: true,
    productCommerceEnabled: true,
    mode: "cart",
    provider: "paystack",
    productId: "",
    amount: 0,
    currency: "NGN",
    allowCoupons: true,
  };
  settings.confirmation = {
    ...settings.confirmation,
    title: "Your package is reserved",
    message: "Thanks. Your MaxForm commerce test submission was received.",
  };
  const version = 1;
  const snapshot = {
    fields,
    theme: settings.theme,
    payment: settings.payment,
    version,
    title,
    description: "Published product checkout fixture for gallery, variations, coupons, and payment testing.",
  };
  const versionRecord = {
    id: "commerce-gallery-v1",
    version,
    publishedAt: new Date().toISOString(),
    publishedBy: "MaxForm QA",
    fields,
    title,
    description: snapshot.description,
  };
  settings.version = version;
  settings.versions = [versionRecord];
  settings.liveSnapshot = snapshot;
  settings.hasUnpublishedChanges = false;

  let formId = existingForm.rows[0] ? String(existingForm.rows[0].id) : "";
  if (!formId) {
    const inserted = await query<Row>(
      `INSERT INTO forms (title, slug, description, fields, settings, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW(), NOW()) RETURNING id`,
      [
        title,
        slug,
        snapshot.description,
        JSON.stringify(fields),
        JSON.stringify(settings),
        "published",
        userId,
      ],
    );
    formId = String(inserted.rows[0].id);
  } else {
    await query(
      `UPDATE forms SET slug = $1, description = $2, fields = $3::jsonb,
         settings = $4::jsonb, status = $5, updated_at = NOW()
       WHERE id = $6 AND created_by = $7`,
      [slug, snapshot.description, JSON.stringify(fields), JSON.stringify(settings), "published", formId, userId],
    );
  }

  for (const [position, field] of fields.entries()) {
    await query(
      `INSERT INTO form_fields (
         form_id, field_id, position, field_type, label, placeholder, help_text,
         required, options, default_value, formula, width, validation, config, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13::jsonb, $14::jsonb, NOW())
       ON CONFLICT (form_id, field_id) DO UPDATE SET
         position = EXCLUDED.position, field_type = EXCLUDED.field_type,
         label = EXCLUDED.label, placeholder = EXCLUDED.placeholder,
         help_text = EXCLUDED.help_text, required = EXCLUDED.required,
         options = EXCLUDED.options, width = EXCLUDED.width,
         validation = EXCLUDED.validation, config = EXCLUDED.config,
         updated_at = NOW()`,
      [
        formId,
        field.id,
        position,
        field.type,
        field.label,
        field.placeholder || null,
        field.helpText || null,
        Boolean(field.required),
        JSON.stringify(field.options || []),
        field.defaultValue || null,
        field.formula || null,
        field.width || "full",
        JSON.stringify(field.validation || {}),
        JSON.stringify(field.config || {}),
      ],
    );
  }

  await query(
    `INSERT INTO form_settings (
       form_id, theme, payment, confirmation, notifications, access_control,
       limits_config, schedule, lifecycle, current_version, live_snapshot,
       has_unpublished_changes, archived_from_status, updated_at
     ) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
       $7::jsonb, $8::jsonb, $9, $10, $11::jsonb, FALSE, NULL, NOW())
     ON CONFLICT (form_id) DO UPDATE SET
       theme = EXCLUDED.theme, payment = EXCLUDED.payment,
       confirmation = EXCLUDED.confirmation, notifications = EXCLUDED.notifications,
       access_control = EXCLUDED.access_control, limits_config = EXCLUDED.limits_config,
       schedule = EXCLUDED.schedule, lifecycle = EXCLUDED.lifecycle,
       current_version = EXCLUDED.current_version, live_snapshot = EXCLUDED.live_snapshot,
       has_unpublished_changes = FALSE, archived_from_status = NULL, updated_at = NOW()`,
    [
      formId,
      JSON.stringify(settings.theme),
      JSON.stringify(settings.payment),
      JSON.stringify(settings.confirmation),
      JSON.stringify(settings.notifications),
      JSON.stringify(settings.access),
      JSON.stringify(settings.limits),
      JSON.stringify(settings.schedule),
      "active",
      version,
      JSON.stringify(snapshot),
    ],
  );

  await query(
    `INSERT INTO form_versions (
       form_id, version_id, version_number, published_at, published_by,
       title, description, fields
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (form_id, version_id) DO UPDATE SET
       version_number = EXCLUDED.version_number, published_at = EXCLUDED.published_at,
       published_by = EXCLUDED.published_by, title = EXCLUDED.title,
       description = EXCLUDED.description, fields = EXCLUDED.fields`,
    [
      formId,
      versionRecord.id,
      version,
      versionRecord.publishedAt,
      versionRecord.publishedBy,
      title,
      snapshot.description,
      JSON.stringify(fields),
    ],
  );

  const couponCode = "MAXFORM-GALLERY20";
  const appliesTo = JSON.stringify([{ id: formId, type: "form" }]);
  const eligibleProductIds = JSON.stringify(productIds);
  const directTarget = JSON.stringify({ id: formId, type: "form" });
  const existingCoupon = await query<Row>(
    "SELECT id FROM payment_coupons WHERE user_id = $1 AND UPPER(code) = UPPER($2) LIMIT 1",
    [userId, couponCode],
  );
  if (existingCoupon.rows[0]) {
    await query(
      `UPDATE payment_coupons
       SET name = $1, description = $2, discount_type = $3, discount_value = $4,
           currency = NULL, redemption_limit = $5, minimum_amount = $6,
           maximum_discount = $7, applies_to = $8::jsonb,
           eligible_product_ids = $9::jsonb, excluded_product_ids = '[]'::jsonb,
           direct_target = $10::jsonb, active = TRUE, updated_at = NOW()
       WHERE id = $11 AND user_id = $12`,
      [
        "Gallery QA coupon",
        "20% off both products on the published commerce test form.",
        "percentage",
        20,
        100,
        1000,
        5000,
        appliesTo,
        eligibleProductIds,
        directTarget,
        existingCoupon.rows[0].id,
        userId,
      ],
    );
  } else {
    await query(
      `INSERT INTO payment_coupons (
         user_id, code, name, description, discount_type, discount_value,
         currency, redemption_limit, redemption_count, minimum_amount,
         maximum_discount, applies_to, eligible_product_ids, excluded_product_ids,
         direct_target, starts_at, ends_at, active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 0, $8, $9, $10::jsonb,
         $11::jsonb, '[]'::jsonb, $12::jsonb, NULL, NULL, TRUE, NOW(), NOW())`,
      [
        userId,
        couponCode,
        "Gallery QA coupon",
        "20% off both products on the published commerce test form.",
        "percentage",
        20,
        100,
        1000,
        5000,
        appliesTo,
        eligibleProductIds,
        directTarget,
      ],
    );
  }

  const shortId = await query<Row>("SELECT short_id FROM users WHERE id = $1 LIMIT 1", [userId]);
  console.log(JSON.stringify({
    formId,
    title,
    slug,
    status: "published",
    publicPath: `/forms/${String(shortId.rows[0]?.short_id || userId)}/${slug}`,
    productIds,
    couponCode,
    payment: { enabled: true, provider: "paystack", mode: "cart", coupons: true },
  }, null, 2));
}

await main();
