// Vite's `?url` import: the worklet's file URL. Declared by its exact name so this
// works whether or not `vite/client`'s own `*?url` pattern is picked up.
declare module '@soundtouchjs/audio-worklet/processor?url' {
  const url: string;
  export default url;
}
