import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0078d4 0%, #00a4ef 100%)",
          color: "white",
          fontSize: 130,
          fontWeight: 700,
          letterSpacing: -6,
        }}
      >
        ☁
      </div>
    ),
    { ...size },
  );
}
