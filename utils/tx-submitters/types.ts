import type { Commitment, Connection } from "@solana/web3.js";

export type SubmitResult =
  | { ok: true; signature: string }
  | { ok: false; error: string };

export interface ConfirmOptions {
  commitment?: Commitment;
  timeoutMs?: number;
}

/** Wait until RPC reports the signature processed (or timeout). */
export async function confirmTransactionSignature(
  connection: Connection,
  signature: string,
  opts: ConfirmOptions = {}
): Promise<SubmitResult> {
  const commitment = opts.commitment ?? "confirmed";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const start = Date.now();
  for (;;) {
    const { value: statuses } = await connection.getSignatureStatuses([signature]);
    const st = statuses[0];
    if (st) {
      if (st.err) {
        return { ok: false, error: JSON.stringify(st.err) };
      }
      const conf = st.confirmationStatus;
      if (
        commitment === "processed" ||
        (commitment === "confirmed" &&
          (conf === "confirmed" || conf === "finalized")) ||
        (commitment === "finalized" && conf === "finalized")
      ) {
        return { ok: true, signature };
      }
    }
    if (Date.now() - start > timeoutMs) {
      return { ok: false, error: "confirm timeout" };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}
