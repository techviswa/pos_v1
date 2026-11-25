import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { setFeatureOwner } from "./serverFeatures";
import { useBusinessTemplate } from "./useBusinessTemplate";

jest.mock("axios");

const Probe = () => {
  const { isFeatureEnabled } = useBusinessTemplate();
  return <span>{["kot", "tables", "billing"].map((key) => `${key}:${isFeatureEnabled(key) ? "on" : "off"}`).join(" ")}</span>;
};

test("a plan feature the server switched off is not offered; the template decides until the server answers", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div");
  const root = createRoot(element);
  let answer;
  axios.get.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  try {
    await act(async () => root.render(<Probe />));
    expect(element.textContent).toBe("kot:on tables:on billing:on");
    let loading;
    await act(async () => { loading = setFeatureOwner("user-1:business-1"); });
    expect(element.textContent).toBe("kot:on tables:on billing:on");
    await act(async () => { answer({ data: { success: true, data: { items: [{ key: "kot", enabled: false }, { key: "table-management", enabled: true }] } } }); await loading; });
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/features$/), { withCredentials: true });
    expect(element.textContent).toBe("kot:off tables:on billing:on");
    await act(async () => { await setFeatureOwner(""); });
    expect(element.textContent).toBe("kot:on tables:on billing:on");
  } finally { await act(async () => root.unmount()); }
});
