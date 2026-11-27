import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/** Loads the original, unmodified js-aruco scripts into an isolated context. */
// biome-ignore lint/suspicious/noExplicitAny: the original library is untyped JavaScript.
export function loadReference(): Record<string, any> {
  const dir = fileURLToPath(new URL("../../reference/js-aruco/src/", import.meta.url));
  const context = vm.createContext({ Math });
  for (const file of ["cv.js", "aruco.js", "svd.js", "posit1.js"]) {
    vm.runInContext(readFileSync(dir + file, "utf8"), context, { filename: file });
  }
  // posit2 redefines POS, so load it in its own context.
  const context2 = vm.createContext({ Math });
  for (const file of ["svd.js", "posit2.js"]) {
    vm.runInContext(readFileSync(dir + file, "utf8"), context2, { filename: file });
  }
  return { CV: context.CV, AR: context.AR, POS: context.POS, POS2: context2.POS };
}
