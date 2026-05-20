import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  let token: string | null = null;

  if (process.env.SKIP_AUTH !== "true") {
    const { getToken } = await auth();
    token = await getToken();

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${GATEWAY_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[api/chat] gateway unreachable:", err);
    return NextResponse.json({ error: "Gateway unreachable" }, { status: 502 });
  }

  const text = await upstream.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("[api/chat] non-JSON from gateway:", text.slice(0, 200));
    return NextResponse.json({ error: "Gateway returned invalid response" }, { status: 502 });
  }

  return NextResponse.json(data, { status: upstream.status });
}
