import sharp from 'sharp';

// Re-encode generated cards for QQ only; keep original-size text and diagrams.
export async function cardForQQ(image) {
  if (image.length < 512 * 1024 || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return image;
  const jpeg = await sharp(image).flatten({background:'#0b1020'})
    .jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
  return jpeg.length < image.length ? jpeg : image;
}
