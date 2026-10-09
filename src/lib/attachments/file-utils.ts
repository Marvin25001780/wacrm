// ============================================================
// Utilidades para Adjuntos (migration 035).
// Puras y testeables — sin dependencias de React ni del cliente.
// ============================================================

export type AttachmentKind =
  | 'image'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'other';

/** 25 MB — debe coincidir con el file_size_limit del bucket (migration 035). */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Clasifica un adjunto por su MIME (con el nombre como respaldo, ya
 * que algunos navegadores no envían `type`).
 */
export function attachmentKind(
  mimeType?: string | null,
  fileName?: string | null,
): AttachmentKind {
  const mime = (mimeType ?? '').toLowerCase();
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';

  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return 'image';
  }
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    ['xls', 'xlsx', 'csv'].includes(ext)
  ) {
    return 'spreadsheet';
  }
  if (
    mime.includes('presentation') ||
    mime.includes('powerpoint') ||
    ['ppt', 'pptx'].includes(ext)
  ) {
    return 'presentation';
  }
  if (
    mime.includes('word') ||
    mime === 'text/plain' ||
    ['doc', 'docx', 'txt', 'rtf'].includes(ext)
  ) {
    return 'document';
  }
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('compressed') ||
    ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)
  ) {
    return 'archive';
  }
  return 'other';
}

/** Formatea bytes a una cadena legible (KB / MB / GB). */
export function formatFileSize(bytes?: number | null): string {
  if (bytes == null || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
