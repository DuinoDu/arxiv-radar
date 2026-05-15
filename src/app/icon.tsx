import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// 极简雷达图标：3 个同心圆 + 一条扫描线 + 中心点
// maskable safe zone: 图形整体收在半径 ~190 内 (≈ 512 * 0.74)
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#09090b"/>
  <g fill="none" stroke="#fafafa" stroke-width="16" stroke-linecap="round">
    <circle cx="256" cy="256" r="170"/>
    <circle cx="256" cy="256" r="110"/>
    <circle cx="256" cy="256" r="50"/>
    <line x1="256" y1="256" x2="376" y2="136"/>
  </g>
  <circle cx="256" cy="256" r="18" fill="#fafafa"/>
</svg>
`.trim();

export default function Icon() {
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
