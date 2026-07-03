# Project notes

- Package manager is `pnpm`, not `npm`
- Server runs on Cloudflare Workers via partykit (partyserver)
- Build command: `npm run build` (Vite for client, esbuild/tsc for worker)
- Dev command: `npm run dev`
- Type check client: `npx tsc --noEmit`
- Type check worker: `npx tsc -p tsconfig.worker.json --noEmit`
