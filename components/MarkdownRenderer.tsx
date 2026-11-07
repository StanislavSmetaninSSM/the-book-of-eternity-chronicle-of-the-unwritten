import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  inline?: boolean;
}

// Configure marked to handle newlines as <br> tags and enable GitHub Flavored Markdown
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Chat history re-renders often (streaming, speech state, hover toolbars) and message
// text rarely changes, so parsed+sanitized HTML is memoized across renders. The cache is
// bounded so a long session cannot grow it without limit.
const MARKDOWN_CACHE_LIMIT = 400;
const markdownCache = new Map<string, string>();

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, character => HTML_ESCAPES[character]);

function sanitizeHtml(html: string): string {
  // During a server-side render there is no DOM, so DOMPurify is only its factory
  // function. Escape the markup instead of throwing.
  const sanitizer = (DOMPurify as unknown as { sanitize?: (value: string) => string })?.sanitize;
  if (typeof sanitizer !== 'function') return escapeHtml(html);
  return sanitizer.call(DOMPurify, html);
}

function renderMarkdownToSafeHtml(content: string, inline: boolean): string {
  const cacheKey = `${inline ? 'i' : 'b'}|${content}`;
  const cached = markdownCache.get(cacheKey);
  if (cached !== undefined) {
    // Refresh insertion order so the entry counts as recently used.
    markdownCache.delete(cacheKey);
    markdownCache.set(cacheKey, cached);
    return cached;
  }

  let html: string;
  try {
    const parsed = inline ? marked.parseInline(content) : marked.parse(content);
    html = sanitizeHtml(typeof parsed === 'string' ? parsed : content);
  } catch (error) {
    console.error("Error processing content:", error);
    // Fallback to sanitizing the original content as plain text
    html = sanitizeHtml(content);
  }

  markdownCache.set(cacheKey, html);
  if (markdownCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldestKey = markdownCache.keys().next().value;
    if (oldestKey !== undefined) markdownCache.delete(oldestKey);
  }
  return html;
}

function MarkdownRenderer({ content, className = '', inline = false }: MarkdownRendererProps): React.ReactNode {
  const sanitizedHtml = useMemo(
    () => (typeof content === 'string' ? renderMarkdownToSafeHtml(content, inline) : ''),
    [content, inline],
  );

  const WrapperComponent = inline ? 'span' : 'div';
  const wrapperClassName = inline
    ? className
    : `prose prose-invert max-w-none prose-p:my-2 prose-headings:my-3 ${className}`;

  return (
    <WrapperComponent
      className={wrapperClassName}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}

export default React.memo(MarkdownRenderer);
