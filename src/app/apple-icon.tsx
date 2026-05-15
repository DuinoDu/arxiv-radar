import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// 对应主图标按 180 视口等比缩放，iOS 主屏不需要预留 maskable 安全区，
// 因此图形相对更舒展一些。
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#09090b"/>
  <g fill="none" stroke="#fafafa" stroke-width="6" stroke-linecap="round">
    <circle cx="90" cy="90" r="64"/>
    <circle cx="90" cy="90" r="42"/>
    <circle cx="90" cy="90" r="20"/>
    <line x1="90" y1="90" x2="135" y2="45"/>
  </g>
  <circle cx="90" cy="90" r="6.5" fill="#fafafa"/>
</svg>
`.trim();

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#09090b",
        }}
      >
        <img
          width={size.width}
          height={size.height}
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
          alt=""
        />
      </div>
    ),
    { ...size },
  );
}
