import { buildLabelHtml, ean13Bits, ean13Svg, isEan13 } from "./barcodeLabel";

test("EAN-13 check digits and bar patterns follow the standard", () => {
  expect(isEan13("4006381333931")).toBe(true);
  expect(isEan13("4006381333932")).toBe(false);
  const bits = ean13Bits("4006381333931");
  expect(bits).toHaveLength(95);
  expect(bits.startsWith("101")).toBe(true);
  expect(bits.slice(45, 50)).toBe("01010");
  // First digit 4 => parity LGLLGG; second digit 0 in L code.
  expect(bits.slice(3, 10)).toBe("0001101");
  expect(bits.slice(10, 17)).toBe("0100111"); // 0 in G code
});

test("labels draw EAN-13 codes as bars, other codes as text, and escape names", () => {
  expect(ean13Svg("4006381333931")).toContain("<rect");
  expect(ean13Svg("ABC-123")).toBeNull();
  const html = buildLabelHtml({ name: "<Cookie>", price: "₹40", code: "ABC-123", copies: 2 });
  expect(html).toContain("&lt;Cookie&gt;");
  expect(html.match(/class="label"/g)).toHaveLength(2);
  expect(html).toContain('<div class="code">ABC-123</div>');
});
