/**
 * Injection token for the machine recovery key provider.
 *
 * The application wires {@link readMachineRecoveryKey} here. Nothing reads a
 * key from configuration or the environment, so a software key can only be
 * supplied by a test that constructs the coordinator itself and never by a
 * production deployment.
 */
export const RECOVERY_KEY_PROVIDER = Symbol.for("BREEV_RECOVERY_KEY_PROVIDER");
