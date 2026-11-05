/** Склеить кадр видео (с учётом object-fit: cover и зеркала) и WebGL-канвас в один PNG. */
export async function composePhoto(
  video: HTMLVideoElement,
  glCanvas: HTMLCanvasElement,
  mirrored: boolean,
): Promise<Blob> {
  const width = glCanvas.width;
  const height = glCanvas.height;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw > 0 && vh > 0) {
    const scale = Math.max(width / vw, height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;
    ctx.save();
    if (mirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, dx, dy, dw, dh);
    ctx.restore();
  }

  ctx.drawImage(glCanvas, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * На телефонах открываем системное меню «Поделиться» (там есть «Сохранить изображение»),
 * на десктопе просто скачиваем файл.
 */
export async function savePhoto(blob: Blob): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const fileName = `ar-photo-${timestamp()}.png`;
  const isTouch = window.matchMedia('(pointer: coarse)').matches;

  if (isTouch && typeof navigator.canShare === 'function') {
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'AR-фото' });
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
        // иначе падаем на скачивание
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
