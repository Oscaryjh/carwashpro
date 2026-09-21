declare module "sharp" {
  type ResizeOptions = {
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
    position?: string;
  };

  type CreateOptions = {
    create: {
      width: number;
      height: number;
      channels: 3 | 4;
      background: {
        r: number;
        g: number;
        b: number;
        alpha?: number;
      };
    };
  };

  type SharpOptions = {
    failOn?: "none" | "truncated" | "error" | "warning";
    limitInputPixels?: number | boolean;
  };

  interface SharpPipeline {
    metadata(): Promise<{
      format?: string;
      width?: number;
      height?: number;
      compression?: string;
    }>;
    resize(width: number, height: number, options?: ResizeOptions): SharpPipeline;
    rotate(): SharpPipeline;
    toFormat(format: "jpeg" | "png" | "webp" | "avif"): SharpPipeline;
    toBuffer(): Promise<Buffer>;
    webp(options?: { quality?: number }): SharpPipeline;
  }

  function sharp(
    input: Buffer | CreateOptions,
    options?: SharpOptions,
  ): SharpPipeline;

  export default sharp;
}
