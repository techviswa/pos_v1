import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

export const LocalQrCode = ({ value, label = "Table QR code", filename = "table-qr.png", size = 220 }) => {
  const [image, setImage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setImage("");
    setError(false);
    QRCode.toDataURL(value, { width: 660, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((data) => { if (active) setImage(data); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [value]);
  if (error) return <p role="alert">Unable to draw this QR code. Refresh to try again.</p>;
  if (!image) return <p role="status">Preparing QR image...</p>;
  return <div style={{ display: "grid", justifyItems: "center", gap: 12 }}>
    <img alt={label} src={image} width={size} height={size} style={{ maxWidth: "100%", height: "auto", background: "white" }} />
    <a className="cf-btn cf-btn--secondary cf-btn--small" href={image} download={filename}>Download QR image</a>
  </div>;
};
