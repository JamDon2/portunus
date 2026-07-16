interface Props {
  /** The allowlisted commands the extension may launch (permissions.spawn). */
  commands: string[];
  acked: boolean;
  onAckChange: (v: boolean) => void;
}

// Frontend mirror of the backend SPAWN_INTERPRETERS denylist (manifest.rs).
// Best-effort only: it lets the consent UI escalate its warning when a spawn
// command can run arbitrary code. Kept in sync by hand - drift only weakens a
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

function CommandList({ commands }: { commands: string[] }) {
  return (
    <>
      {commands.map((c, i) => (
        <span key={c}>{i > 0 ? ", " : ""}<code>{c}</code></span>
      ))}
    </>
  );
}

/**
 * THE spawn-permission consent surface: the red danger box naming the exact
 * binaries, an escalated warning when any of them is a shell/interpreter, and
 * the mandatory "I understand" checkbox. Shared by every path that can enable a
 * spawn extension (install dialog, enable toggle, reconsent) so the hard gate
 * can't be bypassed by one path forgetting it.
 */
export default function SpawnDangerNotice({ commands, acked, onAckChange }: Props) {
  if (commands.length === 0) return null;
  const interpreters = commands.filter(c => INTERPRETERS.has(basename(c)));
  return (
    <div className="settings-ext-danger">
      <div className="settings-ext-danger-title">⚠ Runs programs outside the sandbox</div>
      This extension can launch programs on your computer: <CommandList commands={commands} />.
      Extensions are normally sandboxed and cannot touch your system — this one asks to break out
      of that sandbox, so it runs with your full account access. Only continue if you trust the
      source.
      {interpreters.length > 0 && (
        <div className="settings-ext-danger-escalate">
          <CommandList commands={interpreters} />{" "}
          {interpreters.length === 1 ? "is a command interpreter — it can" : "are command interpreters — they can"} run
          {" "}<strong>any</strong> program, not just itself, so this grants effectively unrestricted access.
        </div>
      )}
      <label className="settings-ext-danger-ack">
        <input type="checkbox" checked={acked} onChange={e => onAckChange(e.target.checked)} />
        I understand this extension can run programs outside the sandbox.
      </label>
    </div>
  );
}
