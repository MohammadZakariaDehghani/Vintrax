/// <reference types="next/image-types/global" />

// Static image imports — `import logo from '../../public/vintrax-logo.png'`.
//
// Next declares these module types in `next-env.d.ts`, which it generates on
// the first build and which .gitignore excludes. That is fine locally, where a
// build has almost always run, and wrong in CI: `pnpm typecheck` runs before
// `pnpm build`, on a fresh checkout, so the file does not exist yet and every
// image import is TS2307.
//
// One committed line, referencing Next's own declarations rather than
// redeclaring the module shape, so `StaticImageData` cannot drift from the
// version of Next actually installed.
