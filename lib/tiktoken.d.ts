//lib/tiktoken.d.ts

declare module 'js-tiktoken' {
    export function encodingForModel (model: string): Encoder;
    export interface Encoder {
      encode(text: string): number[];
      free(): void;
    }
  }
