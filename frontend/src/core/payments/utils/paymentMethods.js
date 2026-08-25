export const getPaymentMethodFlags = (paymentMethods = []) => ({
  Cash: paymentMethods.includes("Cash"),
  UPI: paymentMethods.includes("UPI"),
  Card: paymentMethods.includes("Card"),
});

export const setPaymentMethodEnabled = (paymentMethods = [], method, enabled) => {
  const next = enabled
    ? [...new Set([...paymentMethods, method])]
    : paymentMethods.filter((item) => item !== method);
  return next.length ? next : ["Cash"];
};
