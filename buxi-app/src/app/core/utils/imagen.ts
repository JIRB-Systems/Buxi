// La foto de perfil se recorta al cuadrado del centro y se achica antes de
// subirla: una foto de teléfono pesa varios MB y en la app se ve de 52 px.
// createImageBitmap respeta la orientación EXIF, así que no queda acostada.
export async function fotoCuadrada(archivo: File, lado = 256): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(archivo.type)) {
    throw new Error('La foto tiene que ser JPG, PNG o WebP.');
  }
  const img = await createImageBitmap(archivo);
  try {
    const corte = Math.min(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = lado;
    canvas.height = lado;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo procesar la foto.');
    ctx.drawImage(img, (img.width - corte) / 2, (img.height - corte) / 2, corte, corte, 0, 0, lado, lado);
    return await new Promise<Blob>((ok, mal) =>
      canvas.toBlob(b => (b ? ok(b) : mal(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.85),
    );
  } finally {
    img.close();
  }
}
