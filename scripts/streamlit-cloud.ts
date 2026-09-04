import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Config = {
  baseUrl: string;
  machineId: string;
  csrfToken: string;
  cookie: string;
};

const configPath = resolve(process.env.STREAMLIT_CLOUD_CONFIG ?? ".streamlit-cloud.json");

function config(): Config {
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${configPath}: ${String(error)}`);
  }
  for (const key of ["baseUrl", "machineId", "csrfToken", "cookie"] as const) {
    if (!parsed[key]) throw new Error(`Missing ${key} in ${configPath}`);
  }
  return {
    baseUrl: parsed.baseUrl!.replace(/\/$/, ""),
    machineId: parsed.machineId!,
    csrfToken: parsed.csrfToken!,
    cookie: parsed.cookie!,
  };
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const settings = config();
  const response = await fetch(`${settings.baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      cookie: settings.cookie,
      origin: settings.baseUrl,
      referer: `${settings.baseUrl}/`,
      "x-streamlit-machine-id": settings.machineId,
      ...(init.method && init.method !== "GET" ? { "x-csrf-token": settings.csrfToken } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${text}`);
  if (!text) return { status: response.status };
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function print(value: unknown): void {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function status(): Promise<Record<string, unknown>> {
  return (await request("/api/v2/app/status")) as Record<string, unknown>;
}

async function waitUntilRunning(timeoutSeconds = 180): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const current = await status();
      const summary = JSON.stringify({ status: current.status, platformStatus: current.platformStatus });
      if (summary !== last) console.log(summary);
      last = summary;
      if (current.status === 5 && current.platformStatus === 0) return;
    } catch (error) {
      const summary = String(error);
      if (summary !== last) console.error(summary);
      last = summary;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
  }
  throw new Error(`App did not reach RUNNING within ${timeoutSeconds} seconds`);
}

function printLogPayload(payload: unknown): void {
  if (typeof payload === "string") {
    try {
      printLogPayload(JSON.parse(payload));
    } catch {
      console.log(payload);
    }
    return;
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) printLogPayload(entry);
    return;
  }
  if (payload && typeof payload === "object" && "Text" in payload) {
    console.log(String((payload as { Text: unknown }).Text));
    return;
  }
  print(payload);
}

async function logs(seconds = 30): Promise<void> {
  const settings = config();
  const url = `${settings.baseUrl.replace(/^http/, "ws")}/~/logstream`;
  const Socket = WebSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> },
  ) => WebSocket;
  const socket = new Socket(url, {
    headers: {
      Cookie: settings.cookie,
      Origin: settings.baseUrl,
      "x-streamlit-machine-id": settings.machineId,
    },
  });
  await new Promise<void>((resolveLogs, reject) => {
    const timer = setTimeout(() => socket.close(), seconds * 1000);
    socket.addEventListener("message", (event) => printLogPayload(String(event.data)));
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error("Log WebSocket failed"));
    });
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      resolveLogs();
    });
  });
}

function usage(): never {
  console.error("Usage: bun run cloud <status|context|health|logs [seconds]|reboot [seconds]|wait [seconds]|secrets|secrets-set FILE>");
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  switch (command) {
    case "status":
      print(await status());
      return;
    case "context":
      print(await request("/api/v2/app/context"));
      return;
    case "health":
      print(await request("/healthz"));
      return;
    case "logs":
      await logs(Number(argument ?? 30));
      return;
    case "reboot":
      print(await request("/api/v2/app/restart", { method: "POST" }));
      await new Promise((resolveWait) => setTimeout(resolveWait, 3000));
      await waitUntilRunning(Number(argument ?? 180));
      print(await request("/healthz"));
      return;
    case "wait":
      await waitUntilRunning(Number(argument ?? 180));
      return;
    case "secrets":
      print(await request("/api/v2/app/secrets"));
      return;
    case "secrets-set": {
      if (!argument) usage();
      const secrets = readFileSync(resolve(argument), "utf8");
      print(
        await request("/api/v2/app/secrets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secrets }),
        }),
      );
      return;
    }
    default:
      usage();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
