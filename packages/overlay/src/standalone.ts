// ============================================================
//  @thientran01/muse/standalone  —  framework-agnostic Node http backend
// ------------------------------------------------------------
//  For hosts whose bundler can't serve the backend in-process (some webpack
//  setups, Parcel, …). Run it as a separate process alongside your dev server:
//    import { startStandaloneServer } from '@thientran01/muse/standalone'
//    startStandaloneServer({ root: process.cwd() }) // binds 127.0.0.1:4747
//  Then point the overlay at it: configureMuse({ apiBase: 'http://localhost:4747' }).
// ============================================================
export { startStandaloneServer, type StandaloneOptions } from '../../../server/standaloneServer'
