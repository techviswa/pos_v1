import axios from "axios";
import { fulfillmentService } from "./fulfillment.service";
import { getTabSessionId, setTabSessionId, clearTabSessionId } from "../../../../lib/sessionSlots";

jest.mock("axios", () => ({ get: jest.fn() }));

test("switching accounts cannot reuse a previous business's table cache", async () => {
  axios.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/connection") ? { network: "local", public_frontend_url: "http://192.168.0.14:3002" } : { items: [{ name: getTabSessionId() }] } }));
  try {
    setTabSessionId("business-a-session");
    const a = await fulfillmentService.fetchTableManagement();
    setTabSessionId("business-b-session");
    const b = await fulfillmentService.fetchTableManagement();
    expect(a.tables.items[0].name).toBe("business-a-session");
    expect(b.tables.items[0].name).toBe("business-b-session");
    expect(axios.get).toHaveBeenCalledTimes(6);
  } finally { clearTabSessionId(); }
});
