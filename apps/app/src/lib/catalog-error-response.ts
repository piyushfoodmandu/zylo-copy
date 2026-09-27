/**
 * Expo resolves an SSR loader before it renders React. Throwing a StatusError
 * produces a JSON body; returning failure data produces a soft HTTP 200. This
 * small document preserves the real 404/503 status for direct requests while
 * client-side loader failures continue into the route ErrorBoundary.
 */
export const catalogErrorResponse = (
  status: 404 | 503,
  title: string,
  description: string
) => new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,follow">
    <title>${title} · Arro</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#fff;color:#0b0a12;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      header{height:68px;border-bottom:1px solid #e9e7ec;display:flex;align-items:center;padding:0 clamp(20px,5vw,64px)}
      .brand{color:#d42b68;font-size:24px;font-weight:750;letter-spacing:-.6px;text-decoration:none}
      main{min-height:calc(100vh - 68px);display:grid;place-items:center;padding:48px 20px}
      section{width:min(620px,100%)}.code{color:#77717e;font-size:13px;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
      h1{margin:10px 0 0;font-size:clamp(30px,5vw,44px);line-height:1.08;letter-spacing:-.035em}p{max-width:540px;margin:14px 0 0;color:#5f5966;font-size:16px;line-height:1.6}
      .action{display:inline-flex;min-height:44px;align-items:center;margin-top:28px;border-radius:999px;background:#0b0a12;color:#fff;padding:0 20px;font-size:15px;font-weight:650;text-decoration:none}
      .action:focus-visible{outline:2px solid #d42b68;outline-offset:3px}
    </style>
  </head>
  <body>
    <header><a class="brand" href="/">Arro</a></header>
    <main><section><div class="code">${status}</div><h1>${title}</h1><p>${description}</p><a class="action" href="/">Back to Discover</a></section></main>
  </body>
</html>`, {
  status,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, follow'
  }
})
