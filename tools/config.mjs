// Where things live. Every path the tools need is derived here, so the repo
// runs from wherever it is cloned.
//
//   SAT_XIEHANZI_DIR   checkout of https://github.com/franco-g-s/xiehanzi, built
//                      with `npm run build`. It supplies the Supernote .note
//                      writer/reader, the Supernote Cloud client, and the
//                      rendering dependencies (playwright, image-js, fast-png).
//                      Default: a sibling directory named `xiehanzi`.
//   SAT_SUPERNOTE_SESSION  Supernote Cloud session file written by
//                      `xiehanzi login`. Default: <xiehanzi>/.supernote-session.json
//   SAT_REPLACED_DIR   where push --replace keeps the copy it moves aside.
//                      Default: out/replaced (gitignored)
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
export const XIEHANZI = resolve(process.env.SAT_XIEHANZI_DIR || join(ROOT, '..', 'xiehanzi'));
export const X = join(XIEHANZI, 'dist');
export const XMOD = (p) => join(XIEHANZI, 'node_modules', p);
export const SUPERNOTE_SESSION = process.env.SAT_SUPERNOTE_SESSION || join(XIEHANZI, '.supernote-session.json');
export const REPLACED_DIR = process.env.SAT_REPLACED_DIR || join(ROOT, 'out', 'replaced');
