ImageToVector — local Vectorizer.AI API integration

Requirements
- Node.js 20.6 or newer
- A Vectorizer.AI API ID and API Secret. Rotate the key exposed in the earlier screenshots before use.

Run locally
1. Copy .env.example to .env.
2. Put the rotated API ID and Secret in .env. Do not put them in dist/app.js or any browser code.
3. Start the local-only server with: node --env-file=.env server.mjs
4. Open http://localhost:4174/.

This integration calls Vectorizer.AI with mode=test. Test calls are free and watermarked. It does not request image retention. Selecting an output format submits the image again to request that format. The server binds to 127.0.0.1 so it is only reachable from this computer.

Online preview
- This project includes a Vercel serverless endpoint at /api/vectorize and serves the static site from dist/.
- Set VECTORIZER_API_ID and VECTORIZER_API_SECRET as encrypted server-side environment variables in Vercel. Never add them to browser code or commit a .env file.
- The online endpoint accepts image uploads up to 4 MB and keeps Vectorizer.AI test mode enabled. Test results are watermarked.
- The endpoint applies a basic per-IP rate limit. Add persistent abuse controls and review provider billing/terms before enabling paid production mode.
