export async function exportPng(svg: SVGSVGElement): Promise<void> {
  const source = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
  const sourceUrl = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('PNG_FAILED')); image.src = sourceUrl; });
    const canvas = document.createElement('canvas');
    canvas.width = svg.viewBox.baseVal.width * 2;
    canvas.height = svg.viewBox.baseVal.height * 2;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG_FAILED');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG_FAILED')), 'image/png'));
    const url = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = url; link.download = 'session-shape.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally { URL.revokeObjectURL(sourceUrl); }
}
