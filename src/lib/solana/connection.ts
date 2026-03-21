import { Connection } from "@solana/web3.js";
import { HELIUS_RPC_URL } from "@/lib/constants";

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(HELIUS_RPC_URL, "confirmed");
  }
  return connection;
}
