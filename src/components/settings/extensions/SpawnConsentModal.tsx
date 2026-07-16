import { useState } from "react";
import Modal from "../Modal";
import SpawnDangerNotice from "./SpawnDangerNotice";

interface Props {
  title: string;
  /** The allowlisted commands the extension may launch (permissions.spawn). */
  commands: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Blocking spawn-consent gate for the paths that don't go through the install
 * dialog: enabling a hand-dropped/dev extension, and re-approving a grown spawn
 * allowlist. Confirm stays disabled until the mandatory acknowledgement is
 * ticked, matching the install flow so the sandbox-break warning is enforced
 * uniformly. `acked` is local state, fresh on every mount.
 */
export default function SpawnConsentModal({ title, commands, confirmLabel, onConfirm, onCancel }: Props) {
  const [ack, setAck] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={470}
      footer={
        <>
          <button className="settings-btn-secondary" onClick={onCancel}>Cancel</button>
          <button
            className="settings-btn-danger"
            onClick={onConfirm}
            disabled={!ack}
            title={!ack ? "Acknowledge the warning above to continue" : undefined}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <SpawnDangerNotice commands={commands} acked={ack} onAckChange={setAck} />
    </Modal>
  );
}
