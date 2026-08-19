declare module "sharp" {
  type ResizeOptions = {
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
    position?: string;
  };

  interface SharpPipeline {
    resize(width: number, height: number, options?: ResizeOptions): SharpPipeline;
    rotate(): SharpPipeline;
    toBuffer(): Promise<Buffer>;
    webp(options?: { quality?: number }): SharpPipeline;
  }

  function sharp(
    input: Buffer,
    options?: { failOn?: "none" | "truncated" | "error" | "warning" },
  ): SharpPipeline;

  export default sharp;
}
