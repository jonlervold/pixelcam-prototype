declare module 'gifenc' {
  export interface GIFEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, options: {
      palette: Uint8Array;
      delay: number;
    }): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(): GIFEncoder;
  export function quantize(data: Uint8ClampedArray, maxColors: number): Uint8Array;
  export function applyPalette(data: Uint8ClampedArray, palette: Uint8Array): Uint8Array;
}
