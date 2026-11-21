import React, { useEffect, useState } from "react";
import { resolveQrApiBaseUrl } from "../lib/qrUrls";

export const resolveProductPhoto = (source) => source?.startsWith("/api/") ? `${resolveQrApiBaseUrl(process.env.REACT_APP_BACKEND_URL)}${source}` : source || "";

export const ProductPhoto = ({ source, name, size = 88 }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return source && !failed ? <img src={resolveProductPhoto(source)} alt={name} loading="lazy" onError={() => setFailed(true)} width={size} height={size} style={{ objectFit: "cover", borderRadius: 10, flexShrink: 0, maxWidth: "100%" }} /> : <div aria-label={`No photo for ${name}`} style={{ width: size, height: size, display: "grid", placeItems: "center", background: "#f1f5f9", color: "#64748b", borderRadius: 10, fontSize: 12, flexShrink: 0 }}>No photo</div>;
};

export const readProductPhoto = (file) => new Promise((resolve, reject) => {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10000000) return reject(new Error("Choose a JPG, PNG or WebP photo smaller than 10 MB."));
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    try {
      const scale = Math.min(1, 640 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    } catch (error) { reject(error); }
    finally { URL.revokeObjectURL(url); }
  };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo could not be read. Choose another image.")); };
  image.src = url;
});
