import { apiData } from "./apiData";

test("reads unwrapped and enveloped API responses alike", () => {
  expect(apiData({ data: { id: 1 } })).toEqual({ id: 1 });
  expect(apiData({ data: [1, 2] })).toEqual([1, 2]);
  expect(apiData({ data: { success: true, message: "ok", data: { id: 2 } } })).toEqual({ id: 2 });
  expect(apiData({ data: { success: true, data: null } })).toBeNull();
  expect(apiData(undefined)).toBeUndefined();
});
