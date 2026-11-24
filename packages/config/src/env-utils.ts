import { ZodError, ZodTypeAny, z } from 'zod';

/**
 * Parses `source` (normally `process.env`) against `schema` and either
 * returns the fully-typed, validated result or throws a single,
 * human-readable error listing every problem found. This is the
 * fail-fast behavior required by the Phase 3B foundation: a service
 * must refuse to start rather than run with a missing or malformed
 * required setting.
 *
 * This function never logs or includes raw env values in its error
 * message beyond what Zod's own issue messages include (which describe
 * *shape*, e.g. "Required" or "Invalid url", not the value itself) —
 * so a misconfigured secret does not get echoed into logs.
 *
 * Typed over the schema itself (`S extends ZodTypeAny`) rather than a
 * `ZodSchema<T>` parameter, so the return type is the schema's real
 * *output* type — including defaults applied — not an input/output
 * type forced to unify, which is what a bare `ZodSchema<T>` parameter
 * does and which breaks any schema using `.default()`.
 */
export function loadEnv<S extends ZodTypeAny>(
  schema: S,
  source: Record<string, string | undefined>,
  appLabel: string
): z.infer<S> {
  const result = schema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  throw new Error(formatEnvError(result.error, appLabel));
}

function formatEnvError(error: ZodError, appLabel: string): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `  - ${path}: ${issue.message}`;
  });
  return [
    `[${appLabel}] Invalid or incomplete environment configuration. Refusing to start.`,
    ...lines,
    '',
    `Fix: copy .env.example to .env in apps/${appLabel} (or set these in your deployment environment) and provide real values for every item above.`,
  ].join('\n');
}
