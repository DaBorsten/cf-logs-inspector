/** Ambient declarations for assets imported by the renderer (Vite handles them at build time). */
declare module '*.css';
declare module '*.svg' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
