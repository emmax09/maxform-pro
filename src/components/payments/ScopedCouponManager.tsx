import { useEffect, useMemo, useRef, useState } from "react";
import { BadgePercent, Loader2, Pencil, Plus } from "lucide-react";

import {
  type PaymentCoupon,
  type PaymentCouponInput,
  type PaymentCouponTargetType,
} from "@/components/payments/payment-types";
import { PricingInput } from "@/components/shared/PricingInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  listPaymentWorkspace,
  savePaymentCoupon,
  setPaymentCouponActive,
} from "@/lib/payments";
import { formatCurrency } from "@/lib/regional-options";

type ScopedCouponTarget = {
  currency: string;
  id: string;
  name: string;
  type: PaymentCouponTargetType;
};

const emptyCoupon = (): PaymentCouponInput => ({
  active: true,
  appliesTo: [],
  code: "",
  currency: null,
  description: "",
  discountType: "percentage",
  discountValue: 10,
  endsAt: "",
  maximumDiscount: null,
  minimumAmount: 0,
  name: "",
  redemptionLimit: null,
  redemptionLimitPerCustomer: null,
  redemptionLimitPerIdentity: null,
  startsAt: "",
  eligibleProductIds: [],
  excludedProductIds: [],
});

export function ScopedCouponManager({
  canCreate = true,
  enabled,
  fixedEligibleProductIds = [],
  hideToggle = false,
  onEnabledChange,
  scopeLabel: scopeLabelProp,
  target,
  productOptions = [],
  userId,
}: {
  canCreate?: boolean;
  enabled: boolean;
  /** When set, every coupon created here is restricted to exactly these products. */
  fixedEligibleProductIds?: string[];
  /** Allows a parent panel to own the single checkout-level enable switch. */
  hideToggle?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  scopeLabel?: string;
  target: ScopedCouponTarget;
  productOptions?: Array<{ id: string; name: string }>;
  userId: string;
}) {
  const [coupons, setCoupons] = useState<PaymentCoupon[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<PaymentCouponInput>(() =>
    emptyCoupon(),
  );
  const [initialDraft, setInitialDraft] = useState<PaymentCouponInput>(() =>
    emptyCoupon(),
  );
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const closeAllowedRef = useRef(false);
  const fixedProductScope = useMemo(
    () => [...new Set(fixedEligibleProductIds)],
    [fixedEligibleProductIds],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void listPaymentWorkspace(userId)
      .then((workspace) => {
        if (!active) return;
        setCoupons(workspace.coupons);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Coupons could not be loaded right now.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, target.id, target.type, userId]);

  const scopedCoupons = useMemo(
    () =>
      coupons.filter((coupon) => {
        if (
          coupon.directTarget?.id !== target.id ||
          coupon.directTarget.type !== target.type
        ) {
          return false;
        }
        if (!fixedProductScope.length) return true;
        const eligibleProductIds = coupon.eligibleProductIds || [];
        return (
          eligibleProductIds.length === fixedProductScope.length &&
          fixedProductScope.every((id) => eligibleProductIds.includes(id))
        );
      }),
    [coupons, fixedProductScope, target.id, target.type],
  );

  const openCreate = () => {
    setError("");
    const nextDraft = emptyCoupon();
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setConfirmCloseOpen(false);
    closeAllowedRef.current = false;
    setDialogOpen(true);
  };

  const openEdit = (coupon: PaymentCoupon) => {
    setError("");
    const nextDraft = {
      id: coupon.id,
      active: coupon.active,
      appliesTo: coupon.appliesTo,
      code: coupon.code,
      currency: coupon.currency,
      description: coupon.description || "",
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      endsAt: coupon.endsAt.slice(0, 16),
      maximumDiscount: coupon.maximumDiscount,
      minimumAmount: coupon.minimumAmount,
      name: coupon.name,
      redemptionLimit: coupon.redemptionLimit,
      redemptionLimitPerCustomer: coupon.redemptionLimitPerCustomer,
      redemptionLimitPerIdentity: coupon.redemptionLimitPerIdentity,
      startsAt: coupon.startsAt.slice(0, 16),
      eligibleProductIds: coupon.eligibleProductIds || [],
      excludedProductIds: coupon.excludedProductIds || [],
      directTarget: coupon.directTarget,
    } satisfies PaymentCouponInput;
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setConfirmCloseOpen(false);
    closeAllowedRef.current = false;
    setDialogOpen(true);
  };

  const couponDraftDirty =
    JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const closeDialogImmediately = () => {
    closeAllowedRef.current = true;
    setConfirmCloseOpen(false);
    setDialogOpen(false);
  };
  const requestDialogClose = () => {
    if (saving) return;
    if (couponDraftDirty) {
      setConfirmCloseOpen(true);
      return;
    }
    closeDialogImmediately();
  };
  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDialogOpen(true);
      return;
    }
    if (closeAllowedRef.current) {
      closeAllowedRef.current = false;
      return;
    }
    requestDialogClose();
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const eligibleProductIds = fixedProductScope.length
        ? fixedProductScope
        : draft.eligibleProductIds || [];
      const saved = await savePaymentCoupon(userId, {
        ...draft,
        appliesTo: [{ id: target.id, type: target.type }],
        currency: draft.discountType === "fixed" ? target.currency : null,
        directTarget: { id: target.id, type: target.type },
        eligibleProductIds,
        excludedProductIds: fixedProductScope.length
          ? []
          : draft.excludedProductIds || [],
      });
      setCoupons((current) =>
        draft.id
          ? current.map((coupon) =>
              coupon.id === saved.id ? saved : coupon,
            )
          : [saved, ...current],
      );
      closeDialogImmediately();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The coupon could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleCoupon = async (coupon: PaymentCoupon) => {
    setError("");
    try {
      await setPaymentCouponActive(userId, coupon.id, !coupon.active);
      setCoupons((current) =>
        current.map((item) =>
          item.id === coupon.id ? { ...item, active: !item.active } : item,
        ),
      );
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "The coupon could not be updated.",
      );
    }
  };

  const targetLabel = fixedProductScope.length
    ? "product"
    : target.type === "event"
      ? "event"
      : "form";
  const scopeLabel = scopeLabelProp || target.name;
  const controlId = `scoped-coupon-${target.type}-${target.id}-${
    fixedProductScope.join("-") || "all"
  }`;
  return (
    <section className="border-y border-border">
      {!hideToggle && (
        <div className="flex items-center justify-between gap-6 py-4">
          <div>
            <p className="text-[13px] font-medium">Accept coupons</p>
            <p className="mt-1 max-w-[620px] text-[11px] leading-5 text-muted-foreground">
              Turn on this toggle to accept coupon codes on this {targetLabel}.
              Turn it off to hide the coupon field and reject every coupon code
              for this checkout.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        </div>
      )}

      {enabled && (
        <div className="border-t border-border py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[12px] font-medium">Coupons for {scopeLabel}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                New coupons created here are linked only to this {targetLabel}
                and also appear in Payments → Coupons.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openCreate}
              disabled={!canCreate}
            >
              <Plus className="h-3.5 w-3.5" />
              Add coupon
            </Button>
          </div>
          {!canCreate && (
            <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
              Set a paid price and save it before creating a coupon for this
              checkout.
            </p>
          )}
          {loading ? (
            <div className="flex items-center gap-2 py-5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading linked coupons
            </div>
          ) : scopedCoupons.length ? (
            <div className="mt-5 divide-y divide-border border-y border-border">
              {scopedCoupons.map((coupon) => (
                <div
                  key={coupon.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <BadgePercent className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12px] font-semibold">
                        {coupon.code}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {coupon.discountType === "percentage"
                          ? `${coupon.discountValue}% off`
                          : `${formatCurrency(coupon.discountValue, coupon.currency || target.currency)} off`}
                        {coupon.redemptionLimit
                          ? ` · ${coupon.redemptionCount}/${coupon.redemptionLimit} used`
                          : " · unlimited uses"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(coupon)}
                      aria-label={`Edit ${coupon.code}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Switch
                      checked={coupon.active}
                      onCheckedChange={() => void toggleCoupon(coupon)}
                      aria-label={`${coupon.active ? "Deactivate" : "Activate"} ${coupon.code}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 border-y border-border py-5 text-[11px] text-muted-foreground">
              No coupons have been created for this {targetLabel} here yet.
            </p>
          )}
          {error && <p className="mt-3 text-[11px] text-destructive">{error}</p>}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-w-[620px]">
          <DialogHeader>
            <DialogTitle>
              {draft.id ? "Edit coupon" : "Add coupon"} for {scopeLabel}
            </DialogTitle>
            <DialogDescription>
              {fixedProductScope.length
                ? `This coupon is exclusively available for ${scopeLabel} within this form checkout.`
                : `This coupon is automatically and exclusively linked to this ${targetLabel}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${controlId}-code`}>Coupon code</Label>
              <Input
                id={`${controlId}-code`}
                value={draft.code}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    code: event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9_-]/g, ""),
                  })
                }
                className="font-mono"
                placeholder="WELCOME20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${controlId}-name`}>Internal name</Label>
              <Input
                id={`${controlId}-name`}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Welcome offer"
              />
            </div>
            <div className="space-y-2">
              <Label>Discount type</Label>
              <Select
                value={draft.discountType}
                onValueChange={(discountType: PaymentCoupon["discountType"]) =>
                  setDraft({
                    ...draft,
                    discountType,
                    currency: discountType === "fixed" ? target.currency : null,
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <PricingInput
              id={`${controlId}-value`}
              label="Discount"
              kind={draft.discountType === "percentage" ? "percentage" : "currency"}
              currency={target.currency}
              max={draft.discountType === "percentage" ? 100 : undefined}
              min={0.01}
              value={draft.discountValue}
              onValueChange={(discountValue) => setDraft({ ...draft, discountValue })}
            />
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${controlId}-description`}>
                Description (optional)
              </Label>
              <Textarea
                id={`${controlId}-description`}
                value={draft.description || ""}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                rows={2}
                placeholder="A short note shown to your team in Payments."
              />
            </div>
            {fixedProductScope.length > 0 && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Product scope</Label>
                <p className="border border-border bg-muted/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                  This coupon applies only to <span className="font-medium text-foreground">{scopeLabel}</span>.
                  The product scope is locked so it cannot accidentally become
                  a form-wide discount.
                </p>
              </div>
            )}
            {!fixedProductScope.length && productOptions.length > 0 && (
              <div className="space-y-2 sm:col-span-2">
                <div>
                  <Label>Eligible products (optional)</Label>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    Select one product to make this a product-specific coupon,
                    or leave all eligible products unchecked to allow it across
                    this form.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {productOptions.map((product) => {
                    const selected = (draft.eligibleProductIds || []).includes(
                      product.id,
                    );
                    return (
                      <label
                        key={product.id}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px]"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setDraft({
                              ...draft,
                              eligibleProductIds: selected
                                ? (draft.eligibleProductIds || []).filter(
                                    (id) => id !== product.id,
                                  )
                                : [
                                    ...(draft.eligibleProductIds || []),
                                    product.id,
                                  ],
                              excludedProductIds: (draft.excludedProductIds || []).filter(
                                (id) => id !== product.id,
                              ),
                            })
                          }
                        />
                        <span className="truncate">{product.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {!fixedProductScope.length && productOptions.length > 0 && (
              <div className="space-y-2 sm:col-span-2">
                <div>
                  <Label>Excluded products (optional)</Label>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    Excluded products can never use this coupon, even when the
                    coupon is otherwise available on the form.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {productOptions.map((product) => {
                    const selected = (draft.excludedProductIds || []).includes(
                      product.id,
                    );
                    return (
                      <label
                        key={`excluded-${product.id}`}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px]"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setDraft({
                              ...draft,
                              excludedProductIds: selected
                                ? (draft.excludedProductIds || []).filter(
                                    (id) => id !== product.id,
                                  )
                                : [
                                    ...(draft.excludedProductIds || []),
                                    product.id,
                                  ],
                              eligibleProductIds: (draft.eligibleProductIds || []).filter(
                                (id) => id !== product.id,
                              ),
                            })
                          }
                        />
                        <span className="truncate">{product.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            {draft.discountType === "percentage" && (
              <PricingInput
                id={`${controlId}-maximum`}
                label="Maximum discount (optional)"
                currency={target.currency}
                min={0}
                value={draft.maximumDiscount || 0}
                onValueChange={(maximumDiscount) =>
                  setDraft({
                    ...draft,
                    maximumDiscount: maximumDiscount || null,
                  })
                }
              />
            )}
            <div className="space-y-2">
              <Label htmlFor={`${controlId}-limit`}>Total use limit</Label>
              <Input
                id={`${controlId}-limit`}
                type="number"
                min="1"
                value={draft.redemptionLimit ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    redemptionLimit: event.target.value ? Number(event.target.value) : null,
                  })
                }
                placeholder="Unlimited"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${controlId}-customer-limit`}>
                Limit per customer
              </Label>
              <Input
                id={`${controlId}-customer-limit`}
                type="number"
                min="1"
                value={draft.redemptionLimitPerCustomer ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    redemptionLimitPerCustomer: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
                placeholder="Unlimited"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${controlId}-identity-limit`}>
                Limit per IP / device
              </Label>
              <Input
                id={`${controlId}-identity-limit`}
                type="number"
                min="1"
                value={draft.redemptionLimitPerIdentity ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    redemptionLimitPerIdentity: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
                placeholder="Unlimited"
              />
              <p className="text-[10px] leading-4 text-muted-foreground">
                Uses an anonymous device fingerprint and network signal to
                identify repeat uses from the same device or IP address.
              </p>
            </div>
            <PricingInput
              id={`${controlId}-minimum`}
              label="Minimum order (optional)"
              currency={target.currency}
              value={draft.minimumAmount}
              onValueChange={(minimumAmount) => setDraft({ ...draft, minimumAmount })}
            />
            <div className="space-y-2">
              <Label htmlFor={`${controlId}-start`}>Starts (optional)</Label>
              <Input
                id={`${controlId}-start`}
                type="datetime-local"
                value={draft.startsAt}
                onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${controlId}-end`}>Expires (optional)</Label>
              <Input
                id={`${controlId}-end`}
                type="datetime-local"
                value={draft.endsAt}
                onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
              />
            </div>
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={requestDialogClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving || !draft.code.trim() || !draft.name.trim() || draft.discountValue <= 0}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {draft.id ? "Save changes" : "Create coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmCloseOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !saving) setConfirmCloseOpen(false);
        }}
      >
        <DialogContent className="max-w-[430px]">
          <DialogHeader>
            <DialogTitle>Save your coupon changes?</DialogTitle>
            <DialogDescription>
              This coupon has changes that have not been saved yet. Keep
              editing, discard them, or save before closing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setConfirmCloseOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={closeDialogImmediately}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              disabled={saving || !draft.code.trim() || !draft.name.trim() || draft.discountValue <= 0}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save and close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
