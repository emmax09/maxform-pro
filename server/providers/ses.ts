/** Provider-specific entrypoint kept small so routing stays provider-neutral. */
// Imported as well as re-exported: `export { x } from "..."` forwards the
// binding without introducing it here, so the accessor below referenced a name
// that did not exist in this module's scope.
import { emailProviderAdapters } from "../email-adapters";

export { emailProviderAdapters };
export const sesProvider = () => emailProviderAdapters.ses;
