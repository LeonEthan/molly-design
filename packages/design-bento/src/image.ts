/**
 * C2-D edit surface — image 面板（GD-4c Wave C2 ticket #16；浏览器侧薄 DOM；
 * 命令来自 ui/image.ts 纯映射）。replace + 四边裁剪从 patch panels.ts
 * buildImageProps 整体移入项目侧浮动面板（bridge 构造挂载，零 patch 语义）。
 *
 * 选择器契约（verify editor-journey 场景 3 驱动同一构件）：`ed-a1a2-replace-image`
 * 按钮、`ed-a1a2-crop-{l,t,r,b}` 数字输入、`ed-a1a2-crop-apply` 应用按钮——
 * 类名与迁移前的 patch UI 一致，Playwright 按原选择器继续驱动。裁剪当前值读
 * canonical 元素（ctx.element.crop），不读宿主面。
 */
import { sniffStaticV1ImageMime } from "contracts";
import { button, numberInput, row, section, select } from "./primitives.ts";
import {
  CROP_EDGES,
  imageCropCommands,
  imageFitCommands,
  parseCropRatios,
  replaceImageCommands,
} from "../image.ts";
import { currentDoc, hostRegisterAsset, type PanelContext } from "./context.ts";
import type { BentoImageElementV4 } from "contracts";

/**
 * image 文件选择（内容寻址 sha256 → 宿主 registerAsset → key 回调）——
 * image 创建（ui/dom/create-delete）与替换（本面板）共用同一字节处理面。
 */
export function pickImageFile(onAsset: (assetKey: string, dataUri: string) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void (async () => {
      if (file.size > 16 * 1024 * 1024) throw Error('Image exceeds 16 MiB');
      const bytes = await file.arrayBuffer();
      if (!sniffStaticV1ImageMime(new Uint8Array(bytes))) throw Error('Use a PNG, JPEG, or GIF image');
      const bitmap = await createImageBitmap(file);
      try { if (bitmap.width * bitmap.height > 16_777_216) throw Error('Image exceeds 16 megapixels'); }
      finally { bitmap.close(); }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const assetKey = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error("image read failed"));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      if (!hostRegisterAsset(assetKey, dataUri)) throw Error('Image registration failed');
      onAsset(assetKey, dataUri);
    })().catch(error => window.alert(String(error)));
  });
  input.click();
}

/**
 * image 编辑面：Replace image…（setAsset）+ 四边裁剪 l/t/r/b + Apply
 * （setImageCrop；正=inset 负=outset）。裁剪输入是未提交表单值——Apply 才读
 * 当前值构命令（旧面板同 UX；绝不逐格 dispatch）；data-c2a-command 让 mount
 * 焦点守卫在输入期内不重建面板。
 */
export function renderImagePanel(host: HTMLElement, ctx: PanelContext): void {
  const element = ctx.element;
  if (element.kind !== "image") return;
  const image = element as BentoImageElementV4;

  host.appendChild(section("Image"));
  host.appendChild(row("Fit", select(
    ["fill", "contain", "cover"].map((value) => ({ value, label: value })),
    image.fit ?? "contain",
    (value) => ctx.dispatch(imageFitCommands(image.id, value as "fill" | "contain" | "cover")),
    "setImageFit",
  )));
  // Keep the control's accessible/visible label tied to the canonical asset
  // key.  The picker gesture therefore has a real before/after DOM receipt,
  // while the stable class remains compatible with editor-journey.
  const sourceLabel = image.src === undefined ? "unregistered" : image.src.slice(0, 18);
  const replace = button(`Replace image… (${sourceLabel})`, () => {
    pickImageFile((assetKey) => ctx.dispatch(replaceImageCommands(image.id, assetKey)));
  }, "setAsset");
  replace.classList.add("ed-a1a2-replace-image");
  host.appendChild(replace);

  host.appendChild(section("Crop"));
  // crop is optional; blank fields preserve the omitted canonical spelling so
  // an untouched Apply cannot materialize [0, 0, 0, 0].
  const initial: Array<number | undefined> = image.crop === undefined
    ? [undefined, undefined, undefined, undefined]
    : [...image.crop];
  const inputs = CROP_EDGES.map((edge, index) => {
    const input = numberInput(initial[index], () => {
      // 未提交：Apply 才读当前值（裁剪是整写手势，绝不逐格 dispatch）。
    }, {}, "setImageCrop");
    input.classList.add(`ed-a1a2-crop-${edge}`);
    return input;
  });
  CROP_EDGES.forEach((edge, index) => {
    host.appendChild(row(`Crop ${edge}`, inputs[index]!));
  });
  const apply = button("Apply crop", () => {
    const latest = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === image.id);
    if (latest?.kind !== "image") return;
    const rawCrop = inputs.map((input) => input.value);
    if (rawCrop.every((value) => value.trim() === "")) {
      // Blank means optional omission while editing.  Only the explicit Reset
      // action below clears the live crop.
      return;
    }
    const crop = parseCropRatios(rawCrop);
    if (crop === null) return;
    if (latest.crop !== undefined && latest.crop.every((value, index) => value === crop[index])) return;
    ctx.dispatch(imageCropCommands(image.id, crop));
  }, "setImageCrop");
  apply.classList.add("ed-a1a2-crop-apply");
  host.appendChild(apply);
  host.appendChild(button("Reset crop", () => {
    const latest = currentDoc(ctx.bridge).elements.find((candidate) => candidate.id === image.id);
    if (latest?.kind !== "image" || latest.crop === undefined) return;
    ctx.dispatch(imageCropCommands(image.id, null));
  }, "setImageCrop"));
}
