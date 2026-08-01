/**
 * Pulls `i18next-http-middleware`'s global Express augmentation into the `tsconfig.test.json`
 * program (JR-13-01).
 *
 * The augmentation is a `declare global { namespace Express { interface Request extends
 * I18NextRequest {} } }` inside the package's own `index.d.ts`, so it only applies to a program in
 * which something imports that package. The production build gets it for free because
 * `src/api/server.ts` imports the middleware. `tsconfig.test.json` deliberately includes only
 * `src/**\/*.test.ts` and `tests/**\/*.ts` plus whatever those import, so `server.ts` is absent --
 * and the moment a test imports an Express controller, every `req.t(...)` in that controller becomes
 * `TS2339: Property 't' does not exist on type 'Request'`.
 *
 * That is what happened when `tests/integration/predefined-roles.int.test.ts` began importing
 * `api/controllers/iam.controller.ts` in order to drive the real `createDefaultRoles` bootstrap:
 * ten pre-existing errors in production code appeared, none of them a defect in that code. This
 * file is the narrow fix -- a type-only import with no runtime effect, in the harness rather than in
 * `tsconfig.test.json`'s `types` array (which would only work for a package that ships an ambient
 * declaration, and this one does not).
 *
 * See finding F23 in docs/dev/journaling/09-befunde-bestandscode.md for the general shape of the
 * problem: the two tsconfigs disagree about which global augmentations are in scope, so
 * `pnpm --filter @open-archiver/backend test:types` can fail on production code that
 * `pnpm --filter @open-archiver/backend build` accepts.
 */
import 'i18next-http-middleware';
