import { toPng } from "html-to-image";

// Rasterize a DOM node (the calendar + legend) to a PNG and trigger a download. Client-side only.
export async function exportNodeToPng(node: HTMLElement, filename: string): Promise<void> {
  // pixelRatio 3 → a ~3700px-wide, print-sharp PNG (the layout is ~1240px CSS wide).
  const dataUrl = await toPng(node, {
    backgroundColor: "#ffffff",
    pixelRatio: 3,
    cacheBust: true,
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
