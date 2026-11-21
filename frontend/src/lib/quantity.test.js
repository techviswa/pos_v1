import { formatQuantity } from "./quantity";
import { getApiErrorDetails } from "./apiErrors";
test("display quantities hide float noise without changing missing data into zero", () => {
  expect(formatQuantity(4.970000000000001, "kg")).toBe("4.97 kg");
  expect(formatQuantity(0.025, "kg")).toBe("0.025 kg");
  expect(formatQuantity(null)).toBe("Not available");
});
test("a local parsing error is distinguished from an actual network error", () => {
  expect(getApiErrorDetails(new TypeError("Invalid response")).title).toBe("Screen error");
  expect(getApiErrorDetails({ isAxiosError: true, code: "ERR_NETWORK", message: "Network Error" }).title).toBe("Backend unavailable");
});
