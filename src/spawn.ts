// Shared spawn-permission helpers for the consent surfaces.
//
// The `spawn` permission is sandbox-breaking: it lets an extension launch OS
// programs. Every path that can enable such an extension (the install dialog,
// the enable toggle, reconsent, and the launcher marketplace preview) must show
// the same danger surface — including the escalation for shells/interpreters,
// whose unrestricted args re-grant arbitrary code execution.
//
// Frontend mirror of the backend SPAWN_INTERPRETERS denylist (manifest.rs).
// Best-effort only: it lets the consent UI escalate its warning when a spawn
// command can run arbitrary code. Kept in sync by hand — drift only weakens a
// hint, it is never a security boundary (the backend gate is the allowlist).
const INTERPRETERS = new Set([
  "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "ash", "busybox",
  "python", "python2", "python3", "perl", "ruby", "node", "deno", "bun", "lua", "php",
  "tclsh", "expect", "Rscript", "groovy",
  "env", "xargs", "find", "awk", "gawk", "mawk", "make", "nohup", "setsid", "nice",
  "timeout", "stdbuf", "watch", "flatpak", "systemd-run",
  "ssh", "sudo", "doas", "pkexec", "nsenter", "chroot", "socat", "nc", "ncat",
]);

function basename(cmd: string): string {
  const parts = cmd.split("/");
  return parts[parts.length - 1] || cmd;
}

/** Subset of `commands` that are shells/interpreters — i.e. that re-grant
 *  arbitrary execution because their args are unrestricted. */
export function interpretersIn(commands: string[]): string[] {
  return commands.filter(c => INTERPRETERS.has(basename(c)));
}
