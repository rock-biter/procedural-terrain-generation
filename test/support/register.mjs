// Loaded with `node --import` before the tests (package.json `test` script).
import { register } from 'node:module'

register('./viteImports.mjs', import.meta.url)
