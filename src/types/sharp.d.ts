declare module "sharp" {
  interface Metadata {
    format?: string;
    compression?: "av1" | "hevc";
    width?: number;
    height?: number;
  }

  type ResizeOptions = {
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
    position?: string;
  };

  interface SharpPipeline {
    metadata(): Promise<Metadata>;
    toFormat(format: "jpeg" | "png" | "webp" | "avif"): SharpPipeline;
    resize(width: number, height: number, options?: ResizeOptions): SharpPipeline;
    rotate(): SharpPipeline;
    toBuffer(): Promise<Buffer>;
    webp(options?: { quality?: number }): SharpPipeline;
  }

  function sharp(
    input: Buffer,
    options?: { failOn?: "none" | "truncated" | "error" | "warning"; limitInputPixels?: number },
  ): SharpPipeline;

  function sharp(input: { create: { width: number; height: number; channels: number; background: { r: number; g: number; b: number; alpha: number } } }): SharpPipeline;

  export type { Metadata };
  export default sharp;
}
