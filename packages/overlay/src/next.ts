// ============================================================
//  @thientran01/muse/next  —  Next.js App Router backend (Web adapter)
// ------------------------------------------------------------
//  Mount in app/api/muse/[...muse]/route.ts (nodejs runtime, dev-gated):
//    const router = createMuseWebRouter(createMuseContext(process.env, process.cwd()))
//    export async function GET(req: Request)  { return router(req) }
//    export async function POST(req: Request) { return router(req) }
// ============================================================
export { createMuseWebRouter, runHandlerWeb } from '../../../server/webAdapter'
export { createMuseContext, type MuseContext } from '../../../server/museCore'
