export function convertSrtToVtt(srtContent: string): string {
  if (!srtContent) return "WEBVTT\n\n";

  // Strip BOM and normalize line breaks
  let cleaned = srtContent.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // If it's already WebVTT, return trimmed
  if (/^WEBVTT/i.test(cleaned.trimStart())) {
    return cleaned.trimStart();
  }

  // Convert SRT timestamp commas to periods: 00:01:23,456 --> 00:01:25,789
  // Also handle single-digit hours: 0:01:23,456 -> 00:01:23.456
  cleaned = cleaned.replace(
    /(\d{1,2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{3})/g,
    (_, start, startMs, end, endMs) => {
      const paddedStart = start.length === 7 ? `0${start}` : start;
      const paddedEnd = end.length === 7 ? `0${end}` : end;
      return `${paddedStart}.${startMs} --> ${paddedEnd}.${endMs}`;
    },
  );

  return `WEBVTT\n\n${cleaned.trim()}\n`;
}

function formatCentisecondsToVtt(assTimestamp: string): string {
  // ASS timestamp is H:MM:SS.cs (e.g. 0:01:23.45 or 00:01:23.45)
  const parts = assTimestamp.trim().split(":");
  if (parts.length !== 3) return "00:00:00.000";

  const hours = parts[0].padStart(2, "0");
  const minutes = parts[1].padStart(2, "0");
  const secondsWithCs = parts[2].split(".");
  const seconds = (secondsWithCs[0] || "00").padStart(2, "0");
  const cs = (secondsWithCs[1] || "00").padEnd(3, "0").slice(0, 3);

  return `${hours}:${minutes}:${seconds}.${cs}`;
}

export function convertAssToVtt(assContent: string): string {
  if (!assContent) return "WEBVTT\n\n";

  const normalized = assContent.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  let inEvents = false;
  let formatColumns: string[] = [];
  let startIndex = -1;
  let endIndex = -1;
  let textIndex = -1;

  const cues: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^\[Events\]/i.test(line)) {
      inEvents = true;
      continue;
    }

    if (inEvents && /^\[.*\]/.test(line)) {
      // Left events section
      inEvents = false;
      continue;
    }

    if (inEvents && /^Format:/i.test(line)) {
      const formatStr = line.replace(/^Format:\s*/i, "");
      formatColumns = formatStr.split(",").map((c) => c.trim().toLowerCase());
      startIndex = formatColumns.indexOf("start");
      endIndex = formatColumns.indexOf("end");
      textIndex = formatColumns.indexOf("text");
      continue;
    }

    if (inEvents && /^Dialogue:/i.test(line)) {
      // Fallback indices if Format line wasn't parsed
      const startCol = startIndex !== -1 ? startIndex : 1;
      const endCol = endIndex !== -1 ? endIndex : 2;
      const totalCols = formatColumns.length > 0 ? formatColumns.length : 10;

      const prefixRemoved = line.replace(/^Dialogue:\s*/i, "");
      // Split into at most totalCols fields so the last field (Text) retains internal commas
      const fields: string[] = [];
      let cursor = 0;
      for (let i = 0; i < totalCols - 1; i += 1) {
        const nextComma = prefixRemoved.indexOf(",", cursor);
        if (nextComma === -1) break;
        fields.push(prefixRemoved.slice(cursor, nextComma));
        cursor = nextComma + 1;
      }
      fields.push(prefixRemoved.slice(cursor));

      const startTime = fields[startCol]?.trim();
      const endTime = fields[endCol]?.trim();
      const rawText = fields[textIndex !== -1 ? textIndex : fields.length - 1] ?? "";

      if (!startTime || !endTime) continue;

      const vttStart = formatCentisecondsToVtt(startTime);
      const vttEnd = formatCentisecondsToVtt(endTime);

      // Clean up ASS styling
      let cleanedText = rawText
        // Replace \N and \n with newlines
        .replace(/\\N/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\h/g, " ")
        // Convert basic override tags
        .replace(/\{\\b1\}/gi, "<b>")
        .replace(/\{\\b0\}/gi, "</b>")
        .replace(/\{\\i1\}/gi, "<i>")
        .replace(/\{\\i0\}/gi, "</i>")
        .replace(/\{\\u1\}/gi, "<u>")
        .replace(/\{\\u0\}/gi, "</u>")
        // Strip all other style overrides like {\pos(x,y)}, {\c&H...}, etc.
        .replace(/\{[^}]*\}/g, "")
        .trim();

      if (cleanedText) {
        cues.push(`${vttStart} --> ${vttEnd}\n${cleanedText}`);
      }
    }
  }

  if (cues.length === 0) {
    return "WEBVTT\n\n";
  }

  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function ensureWebVtt(content: string, formatHint?: "vtt" | "srt" | "ass"): string {
  const trimmed = content.trimStart();
  if (/^WEBVTT/i.test(trimmed)) {
    return content;
  }

  if (formatHint === "ass" || /\[Script Info\]|\[Events\]/i.test(content)) {
    return convertAssToVtt(content);
  }

  return convertSrtToVtt(content);
}
