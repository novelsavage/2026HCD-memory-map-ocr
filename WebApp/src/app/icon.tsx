import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// 透過背景にオレンジの Bitcount で "HCD" を描いたファビコン。
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  const fontData = await readFile(join(process.cwd(), "src/app/bitcount.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          color: "#e86f43",
          fontFamily: "Bitcount",
          fontSize: 30,
          letterSpacing: -2
        }}
      >
        HCD
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Bitcount", data: fontData, style: "normal", weight: 400 }]
    }
  );
}
