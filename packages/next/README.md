# @passback/next

Passback lets you point at something wrong in your running app and have your
coding agent fix it. This package puts the Passback widget into your Next.js app
and handles the marks you make.

## Install

```sh
npm i -D @passback/next
```

Or run `npx passback init --apply`, which writes the three files below for you.
A bare `npx passback init` only shows what it would write.

Requires Next 15.3 to 16 and Node 22 or later. App Router only: your project
needs an `app` folder. The Pages Router is not supported.

## Use

Three pieces.

1. The route file `app/api/passback/[[...path]]/route.ts` re-exports `GET` and
   `POST`:

   ```ts
   export { GET, POST } from '@passback/next/route';
   ```

2. `withPassback(...)` wraps your Next config:

   ```ts
   // next.config.ts
   import { withPassback } from '@passback/next';

   export default withPassback({});
   ```

3. `<Passback />` goes in `<head>` of the root layout:

   ```tsx
   // app/layout.tsx
   import { Passback } from '@passback/next';

   export default function RootLayout({ children }: { children: React.ReactNode }) {
     return (
       <html lang="en">
         <head>
           <Passback />
         </head>
         <body>{children}</body>
       </html>
     );
   }
   ```

## Modes

`mode` is `'agent'`, `'relay'` or `'off'`.

- `'agent'`: comments go to your coding agent through `next dev`. No account,
  no `siteKey` and no `endpoint`. Marks are saved in `.passback/inbox/`.
- `'relay'`: comments go through the hosted Passback relay to your tracker, from
  a deployed build. Needs `siteKey` and `endpoint`. `screenshots` is on by
  default in relay mode.
- `'off'`: leaves the widget out.

```tsx
<Passback
  mode={process.env.NODE_ENV === 'production' ? 'relay' : 'agent'}
  siteKey="…"
  endpoint="…"
/>
```

The look settings are shared with the Vite plugin: `theme`, `main`,
`secondary`, `corner`, `launcher` and `hotkey`. See the
[`@passback/vite-plugin` README](https://www.npmjs.com/package/@passback/vite-plugin)
for what each one takes.

## Development only

- The file and line of a component: `withPassback` adds them under `next dev`
  only.
- The local inbox: marks in `.passback/inbox/` exist on the dev server only.

## License

MIT
