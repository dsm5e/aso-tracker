/// <reference types="vite/client" />

/** Vite loads CSS as a side-effect module. Keep this explicit because the
 * project intentionally enables `noUncheckedSideEffectImports`. */
declare module "*.css";
