import ky, { NetworkError, TimeoutError } from "ky"
import { z } from "zod"
import { demoApiResponse } from "../../../lib/demo-api"

const apiOriginSchema = z.url()
const forwardedHeaders = [
  "accept",
  "authorization",
  "content-type",
  "idempotency-key",
  "x-csrf-token",
  "x-evidence-challenge",
  "x-subject-key",
] as const

type RouteContext = {
  readonly params: Promise<{ readonly path: readonly string[] }>
}

function upstreamOrigin(): URL {
  const { POLYROUTINE_API_ORIGIN } = process.env
  return new URL(apiOriginSchema.parse(POLYROUTINE_API_ORIGIN ?? "http://127.0.0.1:3001"))
}

function publicOrigin(requestUrl: URL): string {
  const { POLYROUTINE_PUBLIC_ORIGIN } = process.env
  return apiOriginSchema.parse(POLYROUTINE_PUBLIC_ORIGIN ?? requestUrl.origin)
}

async function forward(
  request: Request,
  context: RouteContext,
  method: "DELETE" | "GET" | "PATCH" | "POST",
): Promise<Response> {
  const requestUrl = new URL(request.url)
  const { path } = await context.params
  const demoResponse = demoApiResponse(request, path, method)
  if (demoResponse !== null) return demoResponse
  const upstream = new URL(`/v1/${path.map(encodeURIComponent).join("/")}`, upstreamOrigin())
  upstream.search = requestUrl.search

  const headers = new Headers()
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  headers.set("origin", publicOrigin(requestUrl))

  try {
    const response =
      method === "GET"
        ? await ky(upstream, { headers, method, retry: 0, throwHttpErrors: false, timeout: 10_000 })
        : await ky(upstream, {
            body: await request.arrayBuffer(),
            headers,
            method,
            retry: 0,
            throwHttpErrors: false,
            timeout: 10_000,
          })
    const responseHeaders = new Headers()
    const contentType = response.headers.get("content-type")
    if (contentType !== null) responseHeaders.set("content-type", contentType)
    return new Response(response.body, { headers: responseHeaders, status: response.status })
  } catch (error) {
    if (
      error instanceof NetworkError ||
      error instanceof TimeoutError ||
      error instanceof TypeError
    ) {
      return Response.json({ code: "UPSTREAM_UNAVAILABLE" }, { status: 502 })
    }
    throw error
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return forward(request, context, "GET")
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return forward(request, context, "POST")
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return forward(request, context, "PATCH")
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return forward(request, context, "DELETE")
}
