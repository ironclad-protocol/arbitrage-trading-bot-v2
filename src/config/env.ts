import "dotenv/config";

export const PRIVATE_KEY = reteriveDotEnv("PRIVATE_KEY");
export const FUNDER_ADDRESS = reteriveDotEnv(
    "FUNDER_ADDRESS",
    "PROXY_WALLET_ADDRESS"
);
export const POLYMARKET_SIGNATURE_TYPE = process.env.POLYMARKET_SIGNATURE_TYPE;

function reteriveDotEnv(...keys: string[]): string {
    const env = keys.map(key => process.env[key]).find(Boolean);
    if (!env) {
        throw new Error(`${keys.join(" or ")} is not set`);
    }
    return env;
}