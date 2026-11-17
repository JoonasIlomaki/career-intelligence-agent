function decodeEntitiesPass(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    bull: "•",
    middot: "·",
    hellip: "...",
    euro: "€",
    laquo: "«",
    raquo: "»",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    deg: "°",
    times: "×",
    auml: "ä",
    Auml: "Ä",
    ouml: "ö",
    Ouml: "Ö",
    aring: "å",
    Aring: "Å",
  };

  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z0-9]+);/g, (full, entity) => {
    if (entity === "#39" || entity === "apos") return "'";
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : full;
    }
    if (entity.startsWith("#")) {
      const code = parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : full;
    }
    return named[entity] ?? full;
  });
}

/**
 * Converts HTML (including HTML-entity-encoded markup such as Greenhouse's `content` field)
 * into clean, safe plain text without executing or preserving scripts/markup.
 */
export function sanitizeExternalHtmlToPlainText(rawInput: string): string {
  if (!rawInput || typeof rawInput !== "string") return "";

  let text = rawInput;

  // Greenhouse encodes HTML tags as &lt;p&gt;, &lt;ul&gt;, etc.
  // Decode once upfront if entity-encoded tags exist, then immediately strip dangerous elements & tags.
  if (/&lt;[a-z!/]/i.test(text)) {
    text = decodeEntitiesPass(text);
  }

  // Strip comments and non-visible / executable tags completely
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(
    /<(script|style|noscript|template|svg|iframe|object|embed|form|input|textarea|select|button)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );
  // Also strip self-closing or unclosed dangerous tags
  text = text.replace(
    /<(script|style|noscript|template|svg|iframe|object|embed|meta|link|base)\b[^>]*\/?>/gi,
    " "
  );

  // Remove pure inline formatting tags cleanly
  text = text.replace(
    /<\/?(span|strong|em|b|i|u|s|mark|small|abbr|code|a)\b[^>]*>/gi,
    ""
  );

  // Preserve readable structure for lists, breaks, paragraphs, headings
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li\b[^>]*>/gi, "\n- ");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<\/dt>/gi, ":\n");
  text = text.replace(/<\/dd>/gi, "\n\n");
  text = text.replace(/<\/th>/gi, ": ");
  text = text.replace(/<\/td>/gi, " ");
  text = text.replace(
    /<\/(p|div|section|article|h[1-6]|tr|blockquote|dl|ul|ol|table|figcaption)>/gi,
    "\n\n"
  );
  text = text.replace(
    /<(h[1-6]|p|div|section|article|blockquote|dt|dd|tr)\b[^>]*>/gi,
    "\n"
  );

  // Remove any remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode any remaining text entities cleanly and remove control chars
  text = decodeEntitiesPass(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[<>]/g, (ch) => (ch === "<" ? "‹" : "›"));

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim());

  const collapsed: string[] = [];
  let blankStreak = 0;
  for (const line of lines) {
    if (!line) {
      blankStreak++;
      if (blankStreak <= 1 && collapsed.length > 0) {
        collapsed.push("");
      }
      continue;
    }
    blankStreak = 0;
    collapsed.push(line);
  }

  return collapsed.join("\n").trim();
}
