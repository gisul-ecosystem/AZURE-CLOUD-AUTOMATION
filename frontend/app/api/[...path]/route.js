export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACKEND_BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000';

const proxy = async (request, context) => {
  const params = await context.params;
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  const targetUrl = new URL(`/api/${path}`, BACKEND_BASE_URL);
  targetUrl.search = new URL(request.url).search;

  console.log({
    event: 'proxy_target',
    targetUrl: targetUrl.toString()
  });

  console.log(
    JSON.stringify({
      event: 'proxy_request_started',
      method: request.method,
      path: `/api/${path}`,
      timestamp: new Date().toISOString()
    })
  );

  return fetch(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: 'half'
  });
};

export async function GET(request, context) {
  return proxy(request, context);
}

export async function POST(request, context) {
  return proxy(request, context);
}

export async function PUT(request, context) {
  return proxy(request, context);
}

export async function PATCH(request, context) {
  return proxy(request, context);
}

export async function DELETE(request, context) {
  return proxy(request, context);
}

export async function OPTIONS(request, context) {
  return proxy(request, context);
}

export async function HEAD(request, context) {
  return proxy(request, context);
}
