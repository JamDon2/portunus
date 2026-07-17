import './command';
import './files';
import './apps';
import './calc';
import './dict';
import './extension';
import './marketplace';

// Provider modules register into the shared `plugins[]` registry via top-level
// side effects (registerProvider). Under Vite HMR an edited provider module
// re-executes and re-registers, so the registry accumulates stale duplicates -
// e.g. one marketplace row sprouting N identical "Uninstall" actions. These
// modules export no components, so an edit bubbles up to this common importer;
// accepting it here and forcing a full reload rebuilds the registry clean
// instead of hot-patching duplicate registrations into place.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
