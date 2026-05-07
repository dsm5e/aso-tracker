/** Substitutes `{name}` placeholders in `template` with values from `vars`.
 *  Unknown keys are left as-is so the user can spot typos in their template.
 *  Empty values render as the empty string so the prompt doesn't ship literals
 *  like "App theme: {themeHint}" when the user hasn't filled it. */
export function interpolatePrompt(template: string, vars: Record<string, string | undefined | null>): string {
  return template.replace(/\{(\w+)\}/g, (full, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const v = vars[key];
      return v == null ? '' : String(v);
    }
    return full;
  });
}
