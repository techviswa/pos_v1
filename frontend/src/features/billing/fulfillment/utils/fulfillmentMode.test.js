import { applyFulfillmentMode, buildFulfillmentPayload, buildScheduledDateTime, hydrateOrderMeta, validateFulfillment } from "./fulfillmentMode";

const customer = { customer_name: "Customer", customer_phone: "9876543210" };

test("checkout never sends another mode's handover fields", () => {
  expect(buildFulfillmentPayload({ fulfillment_mode: "DELIVERY", delivery_address: " Main Street ", table_id: "old", token_number: "001", pickup_date: "2030-01-01" })).toMatchObject({ service_mode: "DELIVERY", delivery_address: "Main Street", table_id: null, token_number: null, pickup_slot: null });
});

test("switching service clears incompatible table, pickup and delivery details", () => {
  const result = applyFulfillmentMode({ ...customer, table_id: "t1", reservation_id: "r1", pickup_date: "2030-01-01", delivery_address: "Main Street" }, "TOKEN", "005");
  expect(result).toMatchObject({ table_id: "", reservation_id: "", pickup_date: "", delivery_address: "", token_number: "005", order_type: "Takeaway" });
});

test("pickup rejects impossible dates and past schedules", () => {
  expect(buildScheduledDateTime("2030-02-31", "07:30", "PM")).toBeNull();
  expect(validateFulfillment({ ...customer, fulfillment_mode: "PICKUP", pickup_date: "2020-01-01", pickup_time: "07:30", pickup_meridiem: "PM" }).pickup_slot).toBeTruthy();
});

test("reopened pickup retains its local calendar date and time", () => {
  const slot = new Date(2030, 0, 2, 0, 30).toISOString();
  const meta = hydrateOrderMeta({ service_mode: "PICKUP", pickup_slot: slot });
  expect(meta.pickup_date).toBe("2030-01-02");
  expect(buildScheduledDateTime(meta.pickup_date, meta.pickup_time, meta.pickup_meridiem)).toBe(slot);
});

test("each mode requires its handover details", () => {
  expect(validateFulfillment({ ...customer, fulfillment_mode: "TABLE" }).table_id).toBeTruthy();
  expect(validateFulfillment({ ...customer, fulfillment_mode: "TOKEN", token_number: "abc" }).token_number).toBeTruthy();
  expect(validateFulfillment({ ...customer, fulfillment_mode: "DELIVERY" }).delivery_address).toBeTruthy();
  expect(validateFulfillment({ ...customer, fulfillment_mode: "DELIVERY", delivery_address: "Main Street" })).toEqual({});
  expect(hydrateOrderMeta({ service_mode: "DELIVERY", delivery_address: "Main Street" }).delivery_address).toBe("Main Street");
});
