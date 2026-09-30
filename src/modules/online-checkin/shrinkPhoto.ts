/* ══════════════════════════════════════════════════════════════════
   A PHONE'S PHOTO, MADE SMALL BEFORE IT IS SENT (D27-210)

   A camera's photo is 3 to 8 MB and carries where it was taken. Redrawn
   here at 1600 px on its long side it is a few hundred KB, upright (the
   browser applies the camera's own rotation as it draws), and carries
   nothing but the picture.

   Best effort, not a guard: a browser that cannot do it sends the file as
   it is, and the SERVER still refuses anything over 4 MB or not a JPEG or
   PNG, and strips a JPEG's location itself (api/src/routes/idPhotos.ts).
   ══════════════════════════════════════════════════════════════════ */

const LONG_SIDE = 1600;

export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const picture = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, LONG_SIDE / Math.max(picture.width, picture.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(picture.width * scale);
    canvas.height = Math.round(picture.height * scale);
    canvas.getContext("2d")!.drawImage(picture, 0, 0, canvas.width, canvas.height);
    picture.close();
    const small = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    return small ?? file;
  } catch {
    return file;
  }
}
