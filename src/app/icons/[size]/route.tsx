import { ImageResponse } from "next/og";

// PWA icon: the same "CL" wordmark used across the product on the brand
// green, rendered on demand. Only 192 and 512 are served.
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = size === "512" ? 512 : size === "192" ? 192 : null;
  if (!px) return new Response("Not found", { status: 404 });
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#163a2c",
          color: "#ffffff",
          fontSize: px * 0.42,
          fontWeight: 700,
          letterSpacing: px * 0.02,
        }}
      >
        CL
      </div>
    ),
    { width: px, height: px }
  );
}
