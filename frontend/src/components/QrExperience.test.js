import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { QrGuestFeedback } from "./QrGuestFeedback";
import { QrOffers, currentQrOffers } from "./QrOffers";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../lib/qrUrls", () => ({ resolveQrApiBaseUrl: () => "http://api" }));
jest.mock("../lib/pos", () => ({ formatCurrency: (value) => `Rs ${value}` }));
let root, element;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; element = document.createElement("div"); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); });
const data = (payload) => ({ data: { data: payload } });
const setValue = async (node, value) => act(async () => {
  const prototype = node.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
  node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
});
test("offers include only discounted available items and group the real saving", async () => {
  const items = [
    { id: "a", price: 75, list_price: 100, price_rule: { id: "lunch", name: "Lunch" } },
    { id: "b", price: 140, list_price: 200, price_rule: { id: "lunch", name: "Lunch" } },
    { id: "sold-out", price: 10, list_price: 100, price_rule: { id: "fake", name: "Sold out" }, qr_availability: { available: false } },
    { id: "full-price", price: 50, list_price: 50, price_rule: { id: "none" } },
  ];
  expect(currentQrOffers(items)).toEqual([{ id: "lunch", name: "Lunch", items: 2, saving: 60 }]);
  const toggle = jest.fn();
  await act(async () => root.render(<QrOffers items={items} offersOnly={false} onToggle={toggle} />));
  expect(element.textContent).toContain("Lunch: save up to Rs 60 on 2 items");
  expect(element.textContent).not.toContain("Sold out");
  await act(async () => element.querySelector("button").click());
  expect(toggle).toHaveBeenCalledTimes(1);
});
test("feedback stays closed until payment; submitted reviews show an acknowledgement", async () => {
  axios.get.mockResolvedValue(data({ eligible: false, already_submitted: false, message: "Feedback opens after the final bill is paid." }));
  await act(async () => root.render(<QrGuestFeedback trackingToken="order" />));
  expect(element.querySelector("form")).toBeNull();
  expect(element.textContent).toContain("after the final bill is paid");
});
test("feedback retains text after a failed submit and sends optional scores/topics on retry", async () => {
  axios.get.mockResolvedValue(data({ eligible: true, already_submitted: false, topics: ["speed", "food"] }));
  axios.post.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(data({ submitted: true }));
  await act(async () => root.render(<QrGuestFeedback trackingToken="order" />));
  const selects = element.querySelectorAll("select");
  await setValue(selects[0], "2"); await setValue(selects[1], "4"); await setValue(selects[2], "1");
  await setValue(element.querySelector("textarea"), "Good meal; long wait.");
  await act(async () => element.querySelector('input[type="checkbox"]').click());
  await act(async () => element.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(element.textContent).toContain("Your text is still here");
  expect(element.querySelector("textarea").value).toBe("Good meal; long wait.");
  await act(async () => element.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(axios.post.mock.calls.at(-1)[1]).toEqual({ rating: 2, food_rating: 4, service_rating: 1, topics: ["speed"], comment: "Good meal; long wait." });
  expect(element.querySelector("form")).toBeNull();
  expect(element.textContent).toContain("feedback has been received");
});
