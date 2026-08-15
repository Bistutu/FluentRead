import DOMPurify from 'dompurify';

export function sanitizeTranslationHtml(html: string): DocumentFragment {
  return DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true },
  });
}
