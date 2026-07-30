import { toPng } from "html-to-image";

// Rasterize a DOM node (the calendar + legend) to a PNG and trigger a download. Client-side only.
export async function exportNodeToPng(node: HTMLElement, filename: string): Promise<void> {
  // Fill behind the capture with the current theme's page background so a dark-mode export reads as
  // dark (not dark content on a white card). Falls back to white if the variable can't be resolved.
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff";
  // pixelRatio 3 → a ~3700px-wide, print-sharp PNG (the layout is ~1240px CSS wide).
  const dataUrl = await toPng(node, {
    backgroundColor: bg,
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
