import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const loadTypeScript = createRequire(import.meta.url);
const ts = loadTypeScript(process.env.ENGLISHCD_TYPESCRIPT || "typescript");
const directory = path.dirname(fileURLToPath(import.meta.url));

// Native ports are replaced before loading any application module. No real
// service, SecureStore, model, browser or persisted query client is involved.
export function load(entry, overrides = {}, globals = {}) {
  const modules = new Map();
  function read(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    }).outputText;
    const requireModule = (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.startsWith("."))
        return read(path.resolve(path.dirname(filename), name + ".ts"));
      throw new Error("Unexpected external module: " + name);
    };
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        require: requireModule,
        URL,
        Error,
        AbortController,
        setTimeout,
        clearTimeout,
        ...globals,
      },
      { filename },
    );
    return module.exports;
  }
  return read(path.join(directory, entry + ".ts"));
}
