import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';

const turndown = new TurndownService();

/**
 * Sanitize HTML and convert to Markdown
 * @param html Raw HTML string
 * @returns Sanitized Markdown string
 */
export function sanitizeHtmlToMarkdown(html: string): string {
  const cleanHtml = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
    // You can further restrict or allow tags/attributes as needed
  });
  return turndown.turndown(cleanHtml);
} 