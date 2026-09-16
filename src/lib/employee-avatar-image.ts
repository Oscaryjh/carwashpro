import sharp from "sharp";

export async function processEmployeeAvatarImage(input: Buffer) {
  return sharp(input, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  } as NonNullable<Parameters<typeof sharp>[1]>)
    .rotate()
    .resize(512, 512, { fit: "cover", position: "attention" })
    .webp({ quality: 84 })
    .toBuffer();
}
