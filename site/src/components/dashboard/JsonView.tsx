"use client";

function highlight(src: string): string {
  return src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /("(?:\\.|[^"\\])*")\s*:/g,
      '<span class="text-[#79c0ff]">$1</span>:'
    )
    .replace(
      /:\s*("(?:\\.|[^"\\])*")/g,
      ': <span class="text-[#a5d6ff]">$1</span>'
    )
    .replace(
      /:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
      ': <span class="text-[#79c0ff]">$1</span>'
    )
    .replace(
      /:\s*(true|false)/g,
      ': <span class="text-[#ff7b72]">$1</span>'
    )
    .replace(
      /:\s*(null)/g,
      ': <span class="text-text-muted">$1</span>'
    );
}

function format(raw: string, mime: string): string {
  const isJson =
    (mime && mime.includes("json")) || /^\s*[\[{]/.test(raw);
  if (isJson) {
    try {
      return highlight(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {}
  }
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface JsonViewProps {
  text: string | null;
  mime?: string;
}

export default function JsonView({ text, mime = "" }: JsonViewProps) {
  if (!text) {
    return <p className="text-text-muted text-xs">No body content</p>;
  }

  return (
    <pre
      className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-secondary"
      dangerouslySetInnerHTML={{ __html: format(text, mime) }}
    />
  );
}
