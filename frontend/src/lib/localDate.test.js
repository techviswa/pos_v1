import { localDateKey } from "./localDate";
test("uses the local calendar day, not the UTC one", () => {
  const lateNight = new Date(2026, 10, 26, 1, 30); // 1:30 am local on 26 Nov
  expect(localDateKey(lateNight)).toBe("2026-11-26");
  expect(localDateKey("not a date")).toBe("");
});
