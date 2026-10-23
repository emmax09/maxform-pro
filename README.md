# Maxform Pro

MaxForm brings forms, events, ticketing, payments, email campaigns, customer management, and automation into one workspace.

## Stack

- React 18, TypeScript, and Vite
- Tailwind CSS, shadcn/ui, and Radix UI
- PostgreSQL through Neon’s serverless driver
- API handlers in `api/` and shared server logic in `server/`
- SQL migrations in `migrations/`

## Run locally

Requirements: Node.js 22 or later and npm.

Tailwind CSS v4 targets Safari 16.4+, Chrome 111+, and Firefox 128+.

```sh
git clone https://github.com/emmax09/maxform-pro.git
cd maxform-pro
npm ci
cp .env.example .env
npm run dev
```

Set the required service credentials in `.env` before using features that need a database or external integrations. `.env` is ignored by Git; keep credentials out of commits and issues.

## Project commands

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

The repository includes Vercel configuration in `vercel.json`.

## License

No license file has been added yet.
