/**
 * Los errores de PostgREST no son instancias de `Error`: son objetos
 * planos `{ message, code, details, hint }`. Si dejamos que lleguen a
 * `toErrorResponse`, el usuario solo ve "Internal server error" y no
 * hay forma de saber qué pasó. En los flujos de importación (uso
 * interno, solo admin) mostramos el mensaje real.
 */
export function importErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return fallback;
}
