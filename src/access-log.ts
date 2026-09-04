const color = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code: number, value: string) => color ? `\u001b[${code}m${value}\u001b[0m` : value;
const boldPaint = (code: number, value: string) => color ? `\u001b[1;${code}m${value}\u001b[0m` : value;
const timestampPaint = (value: string) => color ? `\u001b[2;37m${value}\u001b[0m` : value;
const clock = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const serviceColors: Record<string, number> = {
  api: 94,
  rqbit: 95,
  web: 36,
};
const methodColor = (method: string) => paint(method === "GET" || method === "HEAD" ? 36 : 35, method);

function writeLine(service: string, label: string, message: string, labelColor: number, error = false): void {
  const serviceLabel = `[${service}]`.padEnd(9);
  const statusLabel = label.padStart(4);
  const output = [
    timestampPaint(clock()),
    boldPaint(serviceColors[service] ?? 37, serviceLabel),
    paint(labelColor, statusLabel),
    message,
  ].join(" ");
  if (error) console.error(output);
  else console.log(output);
}

export function logLine(service: string, message: string, level: "info" | "warn" | "error" = "info"): void {
  const labelColor = level === "error" ? 31 : level === "warn" ? 33 : 36;
  const label = level === "error" ? "ERR" : level.toUpperCase();
  writeLine(service, label, message, labelColor, level === "error");
}

export function accessEnd(
  service: string,
  method: string,
  url: string,
  status: number,
  durationMs: number,
  requestId?: string,
  outcome: "complete" | "aborted" = "complete",
): void {
  const id = requestId ? ` ${paint(90, `req_id=${requestId}`)}` : "";
  const timing = paint(90, `${Math.round(durationMs)}ms`);
  if (outcome === "aborted") {
    writeLine(service, "WARN", `${methodColor(method)} ${url} aborted ${timing}${id}`, 33);
    return;
  }
  writeLine(service, String(status), `${methodColor(method)} ${url} ${timing}${id}`, status >= 500 ? 31 : status >= 400 ? 33 : status >= 300 ? 36 : 32);
}
