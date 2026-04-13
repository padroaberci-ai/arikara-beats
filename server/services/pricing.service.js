const toCents = (amount) => Math.round(Number(amount || 0) * 100);
const fromCents = (amount) => Number((amount / 100).toFixed(2));

const getItemReference = (item, index) =>
  String(item.beatSlug || item.slug || item.beatId || item.beatTitleSnapshot || index || '')
    .trim()
    .toLowerCase();

const sortDiscountTargets = (items = []) =>
  [...items]
    .map((item, index) => ({ ...item, __index: index, __reference: getItemReference(item, index) }))
    .sort((a, b) => {
      const priceDiff = Number(b.__baseUnitCents || 0) - Number(a.__baseUnitCents || 0);
      if (priceDiff !== 0) return priceDiff;

      const referenceDiff = String(a.__reference || '').localeCompare(String(b.__reference || ''));
      if (referenceDiff !== 0) return referenceDiff;

      return a.__index - b.__index;
    });

export function applyCatalogBundleDiscount(items = []) {
  const pricedItems = items.map((item) => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const baseUnitCents = toCents(item.baseUnitPriceSnapshot ?? item.unitPriceSnapshot ?? 0);

    return {
      ...item,
      quantity,
      baseUnitPriceSnapshot: fromCents(baseUnitCents),
      unitPriceSnapshot: fromCents(baseUnitCents),
      discountAmountSnapshot: 0,
      __baseUnitCents: baseUnitCents
    };
  });

  const rankedItems = sortDiscountTargets(pricedItems);
  rankedItems.slice(1).forEach((item) => {
    const discountCents = Math.round(Number(item.__baseUnitCents || 0) * 0.25);
    item.discountAmountSnapshot = fromCents(discountCents);
    item.unitPriceSnapshot = fromCents(Number(item.__baseUnitCents || 0) - discountCents);
  });

  return summarizeBundlePricing(
    rankedItems
      .sort((a, b) => a.__index - b.__index)
      .map(({ __baseUnitCents, __index, __reference, ...item }) => item)
  );
}

export function summarizeBundlePricing(items = []) {
  const normalizedItems = items.map((item) => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const baseUnitCents = toCents(item.baseUnitPriceSnapshot ?? item.unitPriceSnapshot ?? 0);
    const chargedUnitCents = toCents(item.unitPriceSnapshot ?? item.baseUnitPriceSnapshot ?? 0);
    const discountUnitCents = Math.max(0, baseUnitCents - chargedUnitCents);

    return {
      ...item,
      quantity,
      baseUnitPriceSnapshot: fromCents(baseUnitCents),
      unitPriceSnapshot: fromCents(chargedUnitCents),
      discountAmountSnapshot: fromCents(discountUnitCents)
    };
  });

  const baseSubtotalCents = normalizedItems.reduce(
    (sum, item) => sum + toCents(item.baseUnitPriceSnapshot) * item.quantity,
    0
  );
  const totalCents = normalizedItems.reduce(
    (sum, item) => sum + toCents(item.unitPriceSnapshot) * item.quantity,
    0
  );

  return {
    items: normalizedItems,
    baseSubtotal: fromCents(baseSubtotalCents),
    discountTotal: fromCents(Math.max(0, baseSubtotalCents - totalCents)),
    subtotal: fromCents(totalCents),
    total: fromCents(totalCents)
  };
}
