import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QrFoodInformation } from "./QrFoodInformation";
import { normalizeQrDetails } from "./QrProductDetails";

test("missing allergen details never claim an item is allergy-free", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div"), root = createRoot(element);
  try {
    await act(async () => root.render(<QrFoodInformation item={{}} />));
    expect(element.textContent).toContain("not confirmed");
    await act(async () => root.render(<QrFoodInformation item={{ allergens_reviewed: true }} />));
    expect(element.textContent).toContain("Please confirm with staff");
    expect(element.textContent).not.toContain("allergy-free");
  } finally { await act(async () => root.unmount()); }
});
test("owner allergen fields normalize comma-separated values without discarding QR schedules", () => {
  const result = normalizeQrDetails({ allergens: [" Milk", "Milk", ""], may_contain: [" Nuts "], schedule: [{ start: "10:00" }] });
  expect(result.allergens).toEqual(["Milk"]);
  expect(result.may_contain).toEqual(["Nuts"]);
  expect(result.schedule).toEqual([{ start: "10:00" }]);
});
