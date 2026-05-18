/**
 * Transaction landing helpers: Jito bundles, NextBlock, Helius Sender, Astralane Iris, Zeroslot.
 *
 * @example Helius Sender (tip + send)
 * ```ts
 * import { sendInstructionsViaHeliusSender, confirmTransactionSignature } from "./utils/tx-submitters";
 * import { solConnection, MAIN_KP } from "./config";
 * const sig = await sendInstructionsViaHeliusSender(MAIN_KP, ixs, blockhash);
 * await confirmTransactionSignature(solConnection, sig);
 * ```
 */
export * from "./dispatch";
export type { SubmitResult, ConfirmOptions } from "./types";
