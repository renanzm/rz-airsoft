/* Prepara fotos para envio: corrige a orientação, reduz e comprime em JPEG. */
import { tr } from "../core/i18n.js";
const MAX_SIDE = 1600;
const QUALITY = 0.84;

async function decode(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* alguns formatos só abrem via <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function prepareImage(file) {
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error(tr("Formato de imagem não suportado pelo navegador (tente JPG ou PNG)."));
  }
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  source.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) throw new Error(tr("Não foi possível processar a imagem."));
  return blob;
}

/** data:image/... (relatórios antigos) → Blob, para migrar as fotos. */
export function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
  if (!match) throw new Error(tr("Foto antiga em formato desconhecido."));
  const type = match[1] || "application/octet-stream";
  const payload = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i += 1) bytes[i] = payload.charCodeAt(i);
  return new Blob([bytes], { type });
}
