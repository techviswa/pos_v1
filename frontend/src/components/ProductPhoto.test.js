import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ProductPhoto, readProductPhoto } from "./ProductPhoto";

test("photos render with a useful fallback if the image cannot load", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(<ProductPhoto name="Coffee" source="https://example.com/coffee.jpg" />));
    expect(element.querySelector("img").alt).toBe("Coffee");
    await act(async () => element.querySelector("img").dispatchEvent(new Event("error")));
    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).toContain("No photo");
  } finally { await act(async () => root.unmount()); }
});

test("unsupported and oversized uploads are rejected before decoding", async () => {
  await expect(readProductPhoto(new File(["<svg/>"], "photo.svg", { type: "image/svg+xml" }))).rejects.toThrow("JPG, PNG or WebP");
  await expect(readProductPhoto({ type: "image/jpeg", size: 10000001 })).rejects.toThrow("10 MB");
});
