// Imported as a module (not a name string) so plugin resolution works from any
// workspace package under pnpm's isolated node_modules layout.
import * as astroPlugin from "prettier-plugin-astro";

export default {
  plugins: [astroPlugin],
  overrides: [
    {
      files: "*.astro",
      options: { parser: "astro" },
    },
  ],
};
