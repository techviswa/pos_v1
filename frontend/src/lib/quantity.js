export const formatQuantity = (value, unit = "") => {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "Not available";
  const text = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(Number(value));
  return unit ? `${text} ${unit}` : text;
};
