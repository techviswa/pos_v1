import { preloadRoutePages } from "./routePreload";

test("background module failures settle without rejecting or blocking other pages", async () => {
  const good = jest.fn().mockResolvedValue({ Manager: () => null });
  const failure = new TypeError("Cannot read properties of undefined (reading 'call')");
  const results = await preloadRoutePages([
    { preload: () => Promise.reject(failure) },
    { preload: good },
    { preload: () => { throw failure; } },
  ]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "rejected"]);
  expect(good).toHaveBeenCalledTimes(1);
});

test("a failed prefetch does not prevent a later attempt", async () => {
  const preload = jest.fn().mockRejectedValueOnce(new Error("stale chunk")).mockResolvedValue({});
  expect((await preloadRoutePages([{ preload }]))[0].status).toBe("rejected");
  expect((await preloadRoutePages([{ preload }]))[0].status).toBe("fulfilled");
});
